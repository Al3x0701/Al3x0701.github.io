/* ==============================================
   CONFIGURACIÓN DE SUPABASE
   Reemplaza los valores con los de tu proyecto
============================================== */
const SUPABASE_URL = 'https://qmoztpqycrlljonobxqm.supabase.co'
const SUPABASE_ANON = 'sb_publishable_lnbeC0MylQnGVt6Jn_d87Q_hbRwMyJD'

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  }
})


/* ==============================================
   ESTADO GLOBAL DE LA APP
============================================== */
let usuarioActual = null   // datos de auth.users
let perfilActual = null   // datos de la tabla usuarios
let tabActiva = {}     // pestaña activa por sección
let datosReuniones = []     // caché de reuniones (consolidados)
let datosVotantes = []     // caché de votantes (consolidados)
let mapaLeaflet = null       // instancia Leaflet (se inicializa una sola vez)
let mapaSeleccion = null     // marcador de selección activo
let mapaCirculos = []        // [{circle, radioBase, key}] para escalar con zoom



/* ==============================================
   ARRANQUE: cuando carga la página
============================================== */
document.addEventListener('DOMContentLoaded', async () => {
  iniciarNavegacion()
  iniciarMenuMovil()
  iniciarMenuConfig()
  iniciarPestanas()
  iniciarFiltrosConsolidado()
  iniciarExportarExcel()

  // Cerrar sesión
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await db.auth.signOut()
  })

  // Carga inicial: getSession() resuelve de inmediato con la sesión en caché
  const { data: { session } } = await db.auth.getSession()
  if (session) {
    await iniciarApp(session.user)
  } else {
    mostrarLogin()
  }

  // Escuchar cambios de sesión posteriores a la carga inicial
  db.auth.onAuthStateChange(async (evento, session) => {
    if (evento === 'SIGNED_IN') await iniciarApp(session.user)
    if (evento === 'SIGNED_OUT') mostrarLogin()
    // TOKEN_REFRESHED: sesión renovada silenciosamente, solo actualizamos el usuario
    if (evento === 'TOKEN_REFRESHED' && session) usuarioActual = session.user
  })
})


/* ==============================================
   AUTENTICACIÓN
============================================== */

// Formulario de login
document.getElementById('form-login').addEventListener('submit', async (e) => {
  e.preventDefault()
  const email = document.getElementById('login-email').value
  const password = document.getElementById('login-password').value
  const btnLogin = document.getElementById('btn-login')
  const errorDiv = document.getElementById('login-error')

  btnLogin.disabled = true
  btnLogin.textContent = 'Entrando...'
  errorDiv.style.display = 'none'

  const { error } = await db.auth.signInWithPassword({ email, password })

  if (error) {
    errorDiv.textContent = 'Correo o contraseña incorrectos.'
    errorDiv.style.display = 'block'
    btnLogin.disabled = false
    btnLogin.textContent = 'Entrar'
  }
})

// Mostrar pantalla de login
function mostrarLogin() {
  document.getElementById('pantalla-login').style.display = 'flex'
  document.getElementById('app').style.display = 'none'
  document.getElementById('login-email').value = ''
  document.getElementById('login-password').value = ''
  // Resetear ojo al cerrar sesión
  const pass = document.getElementById('login-password')
  if (pass) pass.type = 'password'
  document.getElementById('icon-ojo-abierto').style.display = 'block'
  document.getElementById('icon-ojo-cerrado').style.display = 'none'
  const btnLogin = document.getElementById('btn-login')
  btnLogin.disabled = false
  btnLogin.textContent = 'Entrar'
  document.getElementById('login-error').style.display = 'none'
}

function togglePassword() {
  const input = document.getElementById('login-password')
  const abierto = document.getElementById('icon-ojo-abierto')
  const cerrado = document.getElementById('icon-ojo-cerrado')
  if (input.type === 'password') {
    input.type = 'text'
    abierto.style.display = 'none'
    cerrado.style.display = 'block'
  } else {
    input.type = 'password'
    abierto.style.display = 'block'
    cerrado.style.display = 'none'
  }
}

// Iniciar la app después del login
async function iniciarApp(user) {
  usuarioActual = user

  // Obtener perfil desde la tabla usuarios
  const { data: perfil } = await db
    .from('usuarios')
    .select('*')
    .eq('id', user.id)
    .single()

  perfilActual = perfil

  // Mostrar la app y ocultar el login
  document.getElementById('pantalla-login').style.display = 'none'
  document.getElementById('app').style.display = 'flex'

  // Actualizar sidebar con datos del usuario
  actualizarSidebar()

  // Mostrar / ocultar ítems del menú según el rol
  aplicarRol()

  // Cargar el dashboard
  navegarA('dashboard')

  // Pre-cargar usuarios para los selects de referidos
  cargarSelectsReferidos()
}

async function cargarSelectsReferidos() {
  const { data } = await db
    .from('usuarios')
    .select('nombre_completo')
    .eq('activo', true)
    .order('nombre_completo', { ascending: true })

  if (!data?.length) return

  const opciones = data.map(u => `<option value="${u.nombre_completo}">${u.nombre_completo}</option>`).join('')
  const base = '<option value="">— Selecciona —</option>' + opciones

    ;['select-referido-reunion', 'select-referido-votante',
      'modal-referido-reuniones', 'modal-referido-votantes'].forEach(id => {
        const el = document.getElementById(id)
        if (el) el.innerHTML = base
      })

  poblarMultiselectResponsables(data.map(u => u.nombre_completo))
  iniciarModalesExcel()
}

// ── Multiselect Responsables ──
let _responsablesSeleccionados = []

function poblarMultiselectResponsables(usuarios) {
  const contenedor = document.getElementById('responsables-opciones')
  if (!contenedor) return
  contenedor.innerHTML = usuarios.map(u => `
    <label class="multiselect-opcion">
      <input type="checkbox" value="${u}"> ${u}
    </label>`).join('')
  contenedor.querySelectorAll('input[type=checkbox]').forEach(cb => {
    cb.addEventListener('change', () => actualizarResponsables())
  })
}

function actualizarResponsables() {
  const checks = document.querySelectorAll('#responsables-opciones input[type=checkbox]:checked')
  _responsablesSeleccionados = Array.from(checks).map(c => c.value)
  const display = document.getElementById('responsables-display')
  const hidden  = document.getElementById('input-responsables')
  if (_responsablesSeleccionados.length === 0) {
    display.innerHTML = '<span class="multiselect-placeholder">— Selecciona responsables —</span>'
  } else {
    display.innerHTML = _responsablesSeleccionados
      .map(n => `<span class="multiselect-tag">${n}<button type="button" data-val="${n}">&times;</button></span>`)
      .join('')
    display.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const val = btn.dataset.val
        const cb = document.querySelector(`#responsables-opciones input[value="${CSS.escape(val)}"]`)
        if (cb) { cb.checked = false; actualizarResponsables() }
      })
    })
  }
  if (hidden) hidden.value = JSON.stringify(_responsablesSeleccionados)
}

function iniciarMultiselectResponsables() {
  const wrap    = document.getElementById('responsables-wrap')
  const display = document.getElementById('responsables-display')
  const dropdown = document.getElementById('responsables-dropdown')
  const search  = document.getElementById('responsables-search')
  if (!wrap) return

  display.addEventListener('click', () => {
    const abierto = dropdown.classList.toggle('abierto')
    if (abierto) search.focus()
  })
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase()
    document.querySelectorAll('#responsables-opciones .multiselect-opcion').forEach(label => {
      label.style.display = label.textContent.toLowerCase().includes(q) ? '' : 'none'
    })
  })
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) dropdown.classList.remove('abierto')
  })
}

function resetMultiselect() {
  _responsablesSeleccionados = []
  document.querySelectorAll('#responsables-opciones input[type=checkbox]').forEach(cb => cb.checked = false)
  actualizarResponsables()
  const search = document.getElementById('responsables-search')
  if (search) { search.value = ''; search.dispatchEvent(new Event('input')) }
}

function iniciarModalesExcel() {
  // ── Modal Añadir Votante ──
  const modalAV = document.getElementById('modal-añadir-votante')
  document.getElementById('btn-abrir-votante').addEventListener('click', () => {
    modalAV.style.display = 'flex'
  })
  document.getElementById('modal-cerrar-votante').addEventListener('click', () => {
    modalAV.style.display = 'none'
  })
  document.getElementById('modal-cancelar-votante').addEventListener('click', () => {
    modalAV.style.display = 'none'
  })
  modalAV.addEventListener('click', e => {
    if (e.target === modalAV) modalAV.style.display = 'none'
  })

  // ── Modal Excel Votantes ──
  const modalV = document.getElementById('modal-excel-votantes')
  document.getElementById('btn-abrir-excel-votantes').addEventListener('click', () => {
    modalV.style.display = 'flex'
  })
  document.getElementById('modal-cerrar-excel-votantes').addEventListener('click', () => {
    modalV.style.display = 'none'
  })
  modalV.addEventListener('click', e => {
    if (e.target === e.currentTarget) modalV.style.display = 'none'
  })

  // Dropdown "Descargar formato"
  const btnFormato  = document.getElementById('btn-formato-dropdown')
  const menuFormato = document.getElementById('excel-formato-menu')
  btnFormato.addEventListener('click', e => {
    e.stopPropagation()
    menuFormato.style.display = menuFormato.style.display === 'none' ? 'block' : 'none'
  })
  document.addEventListener('click', () => { menuFormato.style.display = 'none' })
  document.getElementById('btn-descargar-formato-votantes').addEventListener('click', () => {
    descargarFormatoVotantes()
    menuFormato.style.display = 'none'
  })

  // Inicializa la lógica de upload (drag, file input, subir, limpiar)
  initExcelVotantes()
}


/* ==============================================
   SIDEBAR Y ROL
============================================== */

function actualizarSidebar() {
  const nombre = perfilActual?.nombre_completo || usuarioActual?.email || 'Usuario'
  const rol = perfilActual?.rol || '—'

  document.getElementById('sidebar-nombre').textContent = nombre.split(' ')[0]
  document.getElementById('sidebar-rol').textContent = rol
  document.getElementById('sidebar-avatar').textContent = nombre[0].toUpperCase()

  document.getElementById('dashboard-saludo').textContent = `Bienvenido, ${nombre.split(' ')[0]} 👋`

  const fecha = new Date().toLocaleDateString('es-CO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  document.getElementById('dashboard-fecha').textContent = fecha
}

function aplicarRol() {
  const rol = perfilActual?.rol || ''
  const esAdmin = ['owner', 'admin'].includes(rol)
  const esLider = ['owner', 'admin', 'lider', 'amigo'].includes(rol)

  // Elementos solo para líderes y amigos
  document.querySelectorAll('.solo-lider').forEach(el => {
    el.style.display = esLider ? '' : 'none'
  })

  // Elementos solo para admin y owner
  document.querySelectorAll('.solo-admin').forEach(el => {
    el.style.display = esAdmin ? '' : 'none'
  })

  // Elementos solo para owner
  const esOwner = rol === 'owner'
  document.querySelectorAll('.solo-owner').forEach(el => {
    el.style.display = esOwner ? '' : 'none'
  })
}


/* ==============================================
   NAVEGACIÓN
============================================== */

function iniciarNavegacion() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault()
      navegarA(item.dataset.seccion)
      // Cerrar menú en móvil
      document.getElementById('sidebar').classList.remove('abierto')
      document.getElementById('sidebar-overlay').classList.remove('visible')
    })
  })
}

function navegarA(seccion) {
  // Quitar activo de todos los nav-items
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('activo'))

  // Poner activo en el que corresponde
  const navItem = document.querySelector(`.nav-item[data-seccion="${seccion}"]`)
  if (navItem) navItem.classList.add('activo')

  // Ocultar todas las secciones
  document.querySelectorAll('.seccion').forEach(s => s.classList.remove('activa'))

  // Mostrar la sección pedida
  const secEl = document.getElementById(`sec-${seccion}`)
  if (secEl) secEl.classList.add('activa')

  // Actualizar título del topbar
  const titulos = {
    dashboard: 'Dashboard',
    perfil: 'Mi Perfil',
    reuniones: 'Lista de Reuniones',
    votantes: 'Lista de Votantes',
    aprobaciones: 'Aprobaciones',
    consolidado: 'Consolidados',
    solicitudes: 'Solicitudes',
    noticias: 'Noticias y Eventos',
    usuarios: 'Gestión de Usuarios',
    auditoria: 'Log de Auditoría',
    mapa: 'Mapa Electoral',
    configuracion: 'Configuración',
    eventos: 'Eventos',
  }
  document.getElementById('topbar-titulo').textContent = titulos[seccion] || seccion

  // Cargar datos de la sección
  cargarSeccion(seccion)
}

async function cargarSeccion(seccion) {
  switch (seccion) {
    case 'dashboard': await cargarDashboard(); break
    case 'perfil': cargarPerfil(); break
    case 'reuniones': await cargarReuniones(); break
    case 'votantes': await cargarVotantes(); break
    case 'aprobaciones': await cargarAprobaciones(); break
    case 'consolidado': await cargarConsolidado(); break
    case 'solicitudes': await cargarSolicitudes(); break
    case 'noticias': await cargarNoticias(); break
    case 'usuarios': await cargarUsuarios(); break
    case 'auditoria': await cargarAuditoria(); break
    case 'mapa': await cargarMapa(); break
    case 'eventos': await cargarEventos(); iniciarModalEvento(); iniciarModalQR(); break
  }
}


/* ==============================================
   MENÚ MÓVIL
============================================== */

function iniciarMenuConfig() {
  const btn = document.getElementById('btn-config')
  const dropdown = document.getElementById('config-dropdown')

  btn.addEventListener('click', e => {
    e.stopPropagation()
    dropdown.classList.toggle('abierto')
  })

  document.querySelectorAll('.config-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault()
      dropdown.classList.remove('abierto')
      navegarA(item.dataset.seccion)
    })
  })

  document.addEventListener('click', () => dropdown.classList.remove('abierto'))
}

function iniciarMenuMovil() {
  const sidebar = document.getElementById('sidebar')
  const overlay = document.getElementById('sidebar-overlay')

  document.getElementById('btn-menu').addEventListener('click', () => {
    sidebar.classList.toggle('abierto')
    overlay.classList.toggle('visible')
  })

  overlay.addEventListener('click', () => {
    sidebar.classList.remove('abierto')
    overlay.classList.remove('visible')
  })
}


/* ==============================================
   PESTAÑAS (Tabs)
============================================== */

function iniciarPestanas() {
  document.querySelectorAll('.pestana').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab
      if (!tab) return

      // Determinar el grupo (el contenedor padre)
      const grupo = btn.closest('.pestanas')
      grupo.querySelectorAll('.pestana').forEach(b => b.classList.remove('activa'))
      btn.classList.add('activa')

      // Mostrar el tab-contenido correspondiente
      // Busca en el scope: el siguiente bloque de tabs
      const scope = btn.closest('.seccion') || document
      scope.querySelectorAll('.tab-contenido').forEach(el => el.classList.remove('activo'))
      const tabEl = scope.querySelector(`#${tab}`)
      if (tabEl) tabEl.classList.add('activo')
    })
  })
}


/* ==============================================
   DASHBOARD
============================================== */

let _graficoDashMunicipio = null

async function cargarDashboard() {
  const esAdmin = ['owner', 'admin'].includes(perfilActual?.rol)

  let qR = db.from('lista_reuniones').select('estado')
  let qV = db.from('lista_votantes').select('estado, municipio')

  if (!esAdmin) {
    qR = qR.eq('subido_por', usuarioActual.id)
    qV = qV.eq('subido_por', usuarioActual.id)
  }

  const [
    { data: reuniones, error: errR },
    { data: votantes,  error: errV },
    { data: eventosDB }
  ] = await Promise.all([qR, qV, db.from('eventos').select('nombre_evento, fecha, hora_inicio, hora_cierre, municipio')])

  if (errR || errV) { console.error('Error cargando dashboard:', errR || errV); return }

  const r = reuniones || []
  const v = votantes || []

  const rApro = r.filter(x => x.estado === 'aprobado').length
  const rPend = r.filter(x => x.estado === 'pendiente').length
  const rRech = r.filter(x => x.estado === 'rechazado').length
  const vApro = v.filter(x => x.estado === 'aprobado').length
  const vPend = v.filter(x => x.estado === 'pendiente').length
  const vRech = v.filter(x => x.estado === 'rechazado').length

  document.getElementById('kpi-total-votantes').textContent = v.length
  document.getElementById('kpi-total').textContent = r.length + v.length
  document.getElementById('kpi-aprobados').textContent = rApro + vApro
  document.getElementById('kpi-pendientes').textContent = rPend + vPend
  document.getElementById('kpi-rechazados').textContent = rRech + vRech

  document.getElementById('dash-total-r').textContent = `${r.length} total`
  document.getElementById('dash-barras-r').innerHTML = htmlBarras(rApro, rPend, rRech, r.length)
  document.getElementById('dash-total-v').textContent = `${v.length} total`
  document.getElementById('dash-barras-v').innerHTML = htmlBarras(vApro, vPend, vRech, v.length)

  // ── Gráfico dona municipios ──
  const conteo = {}
  v.forEach(x => {
    if (!x.municipio) return
    const m = x.municipio.trim()
    conteo[m] = (conteo[m] || 0) + 1
  })

  const entradas = Object.entries(conteo).sort((a, b) => b[1] - a[1])
  const TOP = 8
  const top = entradas.slice(0, TOP)
  const otrosTotal = entradas.slice(TOP).reduce((s, [, n]) => s + n, 0)
  if (otrosTotal > 0) top.push(['Otros', otrosTotal])

  const labels  = top.map(([k]) => k)
  const valores = top.map(([, n]) => n)
  const PALETA  = ['#facc15','#f97316','#ef4444','#a855f7','#3b82f6','#10b981','#06b6d4','#e11d48','#84cc16','#cbd5e1']
  const colores = labels.map((l, i) => l === 'Otros' ? '#cbd5e1' : PALETA[i % PALETA.length])

  document.getElementById('dash-dona-total').textContent = `${v.length} votante${v.length !== 1 ? 's' : ''}`
  document.getElementById('dash-dona-muni-top-val').textContent = entradas.length
  document.getElementById('dash-dona-muni-top-label').textContent = `municipio${entradas.length !== 1 ? 's' : ''}`

  // Leyenda personalizada
  document.getElementById('dash-dona-leyenda').innerHTML = top.map(([nombre, n], i) => {
    const pct = v.length > 0 ? Math.round(n / v.length * 100) : 0
    return `
      <div class="dash-dona-leyenda-item">
        <span class="dash-dona-dot" style="background:${colores[i]}"></span>
        <span class="dash-dona-leyenda-nombre">${nombre}</span>
        <span class="dash-dona-leyenda-val">${n}</span>
        <span class="dash-dona-leyenda-pct">${pct}%</span>
      </div>`
  }).join('')

  renderCalendarioDash(eventosDB || [])

  const canvas = document.getElementById('dash-grafico-municipio')
  if (_graficoDashMunicipio) { _graficoDashMunicipio.destroy(); _graficoDashMunicipio = null }

  if (valores.length) {
    _graficoDashMunicipio = new Chart(canvas, {
      type: 'doughnut',
      data: { labels, datasets: [{ data: valores, backgroundColor: colores, borderWidth: 3, borderColor: '#fff', hoverOffset: 10, hoverBorderWidth: 0 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '72%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                const pct = v.length > 0 ? Math.round(ctx.parsed / v.length * 100) : 0
                return `  ${ctx.parsed} votantes (${pct}%)`
              }
            },
            backgroundColor: '#1e293b',
            titleColor: '#fff',
            bodyColor: '#94a3b8',
            padding: 10,
            cornerRadius: 8,
          }
        },
        animation: { animateRotate: true, duration: 700, easing: 'easeInOutQuart' }
      }
    })
  }
}

let _calMes = new Date().getMonth()
let _calAnio = new Date().getFullYear()

function renderCalendarioDash(eventos) {
  const wrap = document.getElementById('dash-calendario')
  if (!wrap) return

  // Indexar eventos por fecha YYYY-MM-DD
  const porFecha = {}
  eventos.forEach(ev => {
    if (!ev.fecha) return
    if (!porFecha[ev.fecha]) porFecha[ev.fecha] = []
    porFecha[ev.fecha].push(ev)
  })

  const hoy = new Date()
  const primerDia = new Date(_calAnio, _calMes, 1)
  const ultimoDia = new Date(_calAnio, _calMes + 1, 0)
  const diasMes   = ultimoDia.getDate()
  const inicioSemana = primerDia.getDay() // 0=dom

  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
  const dias  = ['Do','Lu','Ma','Mi','Ju','Vi','Sá']

  // Cabecera navegación
  let html = `
    <div class="cal-nav">
      <button class="cal-nav-btn" id="cal-prev">&#8249;</button>
      <span class="cal-titulo">${meses[_calMes]} ${_calAnio}</span>
      <button class="cal-nav-btn" id="cal-next">&#8250;</button>
    </div>
    <div class="cal-grid">
      ${dias.map(d => `<div class="cal-dia-header">${d}</div>`).join('')}`

  // Celdas vacías al inicio
  for (let i = 0; i < inicioSemana; i++) html += `<div class="cal-celda cal-vacia"></div>`

  // Días del mes
  for (let d = 1; d <= diasMes; d++) {
    const fecha = `${_calAnio}-${String(_calMes + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    const esHoy = hoy.getDate() === d && hoy.getMonth() === _calMes && hoy.getFullYear() === _calAnio
    const evsDia = porFecha[fecha] || []
    const tieneEvento = evsDia.length > 0

    const tooltip = tieneEvento
      ? evsDia.map(e => `${e.nombre_evento}${e.hora_inicio ? ' · ' + e.hora_inicio : ''}`).join('\n')
      : ''

    html += `<div class="cal-celda${esHoy ? ' cal-hoy' : ''}${tieneEvento ? ' cal-con-evento' : ''}"
               title="${tooltip}" data-fecha="${fecha}">
               <span class="cal-num">${d}</span>
               ${tieneEvento ? `<div class="cal-puntos">${evsDia.slice(0,3).map((e,i) => `<span class="cal-punto" style="background:${['#6366f1','#f97316','#10b981'][i]}"></span>`).join('')}</div>` : ''}
             </div>`
  }

  html += `</div>`

  // Lista de próximos eventos del mes
  const proximos = eventos
    .filter(e => e.fecha >= `${_calAnio}-${String(_calMes+1).padStart(2,'0')}-01` &&
                 e.fecha <= `${_calAnio}-${String(_calMes+1).padStart(2,'0')}-${String(diasMes).padStart(2,'0')}`)
    .sort((a,b) => a.fecha.localeCompare(b.fecha))
    .slice(0, 4)

  if (proximos.length) {
    html += `<div class="cal-proximos">`
    proximos.forEach(ev => {
      const [,, dia] = ev.fecha.split('-')
      html += `
        <div class="cal-proximo-item">
          <div class="cal-proximo-fecha">
            <span class="cal-proximo-dia">${parseInt(dia)}</span>
            <span class="cal-proximo-mes">${meses[_calMes].slice(0,3)}</span>
          </div>
          <div class="cal-proximo-info">
            <span class="cal-proximo-nombre">${ev.nombre_evento}</span>
            <span class="cal-proximo-meta">${ev.hora_inicio || ''} ${ev.municipio ? '· ' + ev.municipio : ''}</span>
          </div>
        </div>`
    })
    html += `</div>`
  }

  wrap.innerHTML = html

  document.getElementById('cal-prev').addEventListener('click', () => {
    _calMes--
    if (_calMes < 0) { _calMes = 11; _calAnio-- }
    renderCalendarioDash(eventos)
  })
  document.getElementById('cal-next').addEventListener('click', () => {
    _calMes++
    if (_calMes > 11) { _calMes = 0; _calAnio++ }
    renderCalendarioDash(eventos)
  })
}

function htmlBarras(apro, pend, rech, total) {
  const items = [
    { label: 'Aprobados', valor: apro, color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
    { label: 'Pendientes', valor: pend, color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    { label: 'Rechazados', valor: rech, color: '#ef4444', bg: 'rgba(239,68,68,0.1)' },
  ]

  return items.map(({ label, valor, color, bg }) => {
    const pct = total > 0 ? Math.round((valor / total) * 100) : 0
    return `
      <div class="barra-item">
        <div class="barra-fila">
          <div class="barra-label-grupo">
            <span class="barra-dot" style="background:${color}"></span>
            <span class="barra-label">${label}</span>
          </div>
          <div class="barra-valores">
            <span class="barra-num" style="color:${color}">${valor}</span>
            <span class="barra-pct">${pct}%</span>
          </div>
        </div>
        <div class="barra-fondo" style="background:${bg}">
          <div class="barra-relleno" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>`
  }).join('')
}


/* ==============================================
   PERFIL
============================================== */

function cargarPerfil() {
  const p = perfilActual
  if (!p) {
    document.getElementById('perfil-contenido').textContent = 'No se encontraron datos de perfil.'
    return
  }

  const inicial = (p.nombre_completo || 'U').charAt(0).toUpperCase()
  const rolLabel = p.rol ? p.rol.toUpperCase() : 'USUARIO'

  document.getElementById('perfil-contenido').innerHTML = `
    <div class="perfil-container">
      <div class="perfil-header">
        <div class="perfil-avatar-grande">${inicial}</div>
        <div class="perfil-header-texto">
          <h2 class="perfil-nombre-tit">${p.nombre_completo || 'Sin nombre'}</h2>
          <span class="badge-rol badge-${p.rol || 'amigo'}">${rolLabel}</span>
        </div>
      </div>

      <div class="perfil-grid">
        <div class="perfil-info-item">
          <label>Correo Electrónico</label>
          <span>${usuarioActual.email}</span>
        </div>
        <div class="perfil-info-item">
          <label>Municipio</label>
          <span>${p.municipio || 'No asignado'}</span>
        </div>
        <div class="perfil-info-item">
          <label>Teléfono</label>
          <span>${p.telefono || 'Sin teléfono'}</span>
        </div>
        <div class="perfil-info-item">
          <label>ID de Usuario</label>
          <span style="font-family:monospace; font-size:0.75rem">${usuarioActual.id.substring(0, 8)}...</span>
        </div>
      </div>

      <div class="perfil-acciones">
        <h3 class="perfil-subtit">Seguridad</h3>
        <p class="perfil-desc-sec">¿Necesitas actualizar tu contraseña? Enviaremos un correo de recuperación a tu cuenta.</p>
        <button class="btn btn-secundario" onclick="restablecerClave()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:16px;height:16px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Restablecer Contraseña
        </button>
      </div>
    </div>
  `
}

async function restablecerClave() {
  if (!usuarioActual) return
  try {
    const { error } = await db.auth.resetPasswordForEmail(usuarioActual.email)
    if (error) throw error
    alert("Se ha enviado un correo de recuperación a " + usuarioActual.email)
  } catch (err) {
    alert("Error: " + err.message)
  }
}


/* ==============================================
   LISTA DE REUNIONES
============================================== */

async function cargarReuniones() {
  const { data, error } = await db
    .from('lista_reuniones')
    .select('*')
    .eq('subido_por', usuarioActual.id)
    .order('created_at', { ascending: false })

  const tbody = document.getElementById('tabla-reuniones-body')

  if (error || !data?.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="tabla-vacia">Sin registros aún.</td></tr>'
    return
  }

  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${r.nombre_completo}</td>
      <td>${r.cedula}</td>
      <td>${r.municipio || '—'}</td>
      <td>${r.fecha_reunion || '—'}</td>
      <td>${r.amigo_referido}</td>
      <td>${badgeEstado(r.estado)}</td>
    </tr>
  `).join('')
}

document.getElementById('form-reunion').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const alertaEl = document.getElementById('reunion-alerta')
  const btn = form.querySelector('button[type="submit"]')

  btn.disabled = true
  btn.textContent = 'Guardando...'
  alertaEl.style.display = 'none'

  const datos = {
    nombre_completo: form.nombre_completo.value,
    cedula: form.cedula.value,
    telefono: form.telefono.value || null,
    municipio: form.municipio.value || null,
    fecha_reunion: form.fecha_reunion.value || null,
    amigo_referido: form.amigo_referido.value,
    subido_por: usuarioActual.id,
    estado: 'pendiente',
  }

  const { error } = await db.from('lista_reuniones').insert(datos)

  if (error) {
    mostrarAlerta(alertaEl, '❌ Error al guardar. Intenta de nuevo.', 'error')
  } else {
    mostrarAlerta(alertaEl, '✅ Registro guardado correctamente.', 'exito')
    form.reset()
    await cargarReuniones()
  }

  btn.disabled = false
  btn.textContent = 'Guardar registro'
})


/* ==============================================
   LISTA DE VOTANTES
============================================== */

/* Estado local de votantes para filtro + paginación */
let _votantesData = []
let _votantesPagina = 1
const _VOTANTES_POR_PAGINA = 13

async function cargarVotantes() {
  const { data, error } = await db
    .from('lista_votantes')
    .select('*')
    .eq('subido_por', usuarioActual.id)
    .order('created_at', { ascending: false })

  _votantesData = error ? [] : (data || [])
  _votantesPagina = 1
  renderTablaVotantes()
  renderGraficoVotantes()

  // Conectar buscador y tabs de gráfico (una sola vez)
  const input = document.getElementById('buscador-votantes')
  if (input && !input.dataset.connected) {
    input.dataset.connected = '1'
    input.addEventListener('input', () => {
      _votantesPagina = 1
      renderTablaVotantes()
    })
    iniciarGraficoVotantes()
  } else {
    // En recargas posteriores, solo repoblar el selector y re-renderizar
    poblarSelectorReferidoGrafico()
    renderGraficoVotantes()
  }
}

function renderTablaVotantes() {
  const tbody    = document.getElementById('tabla-votantes-body')
  const pagWrap  = document.getElementById('paginacion-votantes')
  const q        = (document.getElementById('buscador-votantes')?.value || '').toLowerCase().trim()

  // Filtrar
  const filtrados = q
    ? _votantesData.filter(v =>
        [v.nombre_completo, v.cedula, v.municipio, v.puesto_votacion, v.amigo_referido]
          .some(campo => (campo || '').toLowerCase().includes(q))
      )
    : _votantesData

  if (!filtrados.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="tabla-vacia">${q ? 'Sin resultados para "' + q + '".' : 'Sin registros aún.'}</td></tr>`
    pagWrap.innerHTML = ''
    return
  }

  // Paginación
  const totalPags = Math.ceil(filtrados.length / _VOTANTES_POR_PAGINA)
  if (_votantesPagina > totalPags) _votantesPagina = totalPags
  const inicio = (_votantesPagina - 1) * _VOTANTES_POR_PAGINA
  const pagina = filtrados.slice(inicio, inicio + _VOTANTES_POR_PAGINA)

  tbody.innerHTML = pagina.map(v => `
    <tr>
      <td>${v.nombre_completo}</td>
      <td>${v.cedula}</td>
      <td>${v.municipio || '—'}</td>
      <td>${v.puesto_votacion || '—'}</td>
      <td>${v.mesa || '—'}</td>
      <td>${v.amigo_referido || '—'}</td>
      <td>${badgeEstado(v.estado)}</td>
    </tr>
  `).join('')

  // Controles de paginación
  if (totalPags <= 1) { pagWrap.innerHTML = ''; return }

  const rango = paginasVisibles(_votantesPagina, totalPags)
  pagWrap.innerHTML = `
    <div class="paginacion">
      <button class="pag-btn" data-p="${_votantesPagina - 1}" ${_votantesPagina === 1 ? 'disabled' : ''}>&#8592;</button>
      ${rango.map(p => p === '…'
        ? `<span class="pag-ellipsis">…</span>`
        : `<button class="pag-btn ${p === _votantesPagina ? 'activo' : ''}" data-p="${p}">${p}</button>`
      ).join('')}
      <button class="pag-btn" data-p="${_votantesPagina + 1}" ${_votantesPagina === totalPags ? 'disabled' : ''}>&#8594;</button>
      <span class="pag-info">${inicio + 1}–${Math.min(inicio + _VOTANTES_POR_PAGINA, filtrados.length)} de ${filtrados.length}</span>
    </div>
  `
  pagWrap.querySelectorAll('.pag-btn:not([disabled])').forEach(btn => {
    btn.addEventListener('click', () => {
      _votantesPagina = parseInt(btn.dataset.p)
      renderTablaVotantes()
    })
  })
}

function paginasVisibles(actual, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const pags = new Set([1, total, actual])
  if (actual > 1) pags.add(actual - 1)
  if (actual < total) pags.add(actual + 1)
  const sorted = [...pags].sort((a, b) => a - b)
  const result = []
  let prev = 0
  for (const p of sorted) {
    if (p - prev > 1) result.push('…')
    result.push(p)
    prev = p
  }
  return result
}

/* ==============================================
   GRÁFICO VOTANTES
============================================== */

let _graficoMunicipio = null
let _graficoPuesto    = null
let _graficoReferido  = ''

const _COLORES_GRAFICO = [
  '#facc15','#f97316','#ef4444','#a855f7','#3b82f6',
  '#10b981','#06b6d4','#e11d48','#84cc16','#f59e0b',
  '#8b5cf6','#14b8a6','#f43f5e','#22c55e','#0ea5e9',
]

function iniciarGraficoVotantes() {
  const sel = document.getElementById('filtro-referido-grafico')
  if (!sel || sel.dataset.connected) return
  sel.dataset.connected = '1'
  sel.addEventListener('change', () => {
    _graficoReferido = sel.value
    renderGraficosVotantes()
  })
  poblarSelectorReferidoGrafico()
}

function poblarSelectorReferidoGrafico() {
  const sel = document.getElementById('filtro-referido-grafico')
  if (!sel) return
  const referidos = [...new Set(_votantesData.map(v => v.amigo_referido).filter(Boolean))].sort()
  const valorActual = sel.value
  sel.innerHTML = '<option value="">— Todos los referidos —</option>' +
    referidos.map(r => `<option value="${r}" ${r === valorActual ? 'selected' : ''}>${r}</option>`).join('')
  _graficoReferido = sel.value
}

function agrupar(datos, campo, top = 0) {
  const conteo = {}
  for (const v of datos) {
    const k = v[campo] || 'Sin dato'
    conteo[k] = (conteo[k] || 0) + 1
  }
  const entradas = Object.entries(conteo).sort((a, b) => b[1] - a[1])
  if (top && entradas.length > top) {
    const otros = entradas.slice(top).reduce((s, [, v]) => s + v, 0)
    return [...entradas.slice(0, top), ['Otros', otros]]
  }
  return entradas
}

function vacioEnCanvas(wrap, canvas, msg) {
  if (_graficoMunicipio && canvas.id === 'grafico-municipio') { _graficoMunicipio.destroy(); _graficoMunicipio = null }
  if (_graficoPuesto    && canvas.id === 'grafico-puesto')    { _graficoPuesto.destroy();    _graficoPuesto    = null }
  wrap.style.height = '100px'
  canvas.style.display = 'none'
  let el = wrap.querySelector('.grafico-sin-datos')
  if (!el) { el = document.createElement('p'); el.className = 'grafico-sin-datos'; el.style.cssText = 'margin:auto;color:var(--texto-muted);font-size:0.88rem;text-align:center;padding:1rem'; wrap.appendChild(el) }
  el.textContent = msg
  wrap.style.display = 'flex'
}

function renderGraficosVotantes() {
  const base = _graficoReferido
    ? _votantesData.filter(v => v.amigo_referido === _graficoReferido)
    : _votantesData

  // ── Gráfico Municipio (barras horizontales) ──
  const wrapM  = document.getElementById('grafico-wrap-municipio')
  const canvM  = document.getElementById('grafico-municipio')
  const entradasM = agrupar(base, 'municipio', 10)

  if (!entradasM.length) {
    vacioEnCanvas(wrapM, canvM, 'Sin datos de municipio.')
  } else {
    canvM.style.display = ''
    wrapM.style.display = ''
    wrapM.querySelector('.grafico-sin-datos')?.remove()
    wrapM.style.height = Math.max(160, entradasM.length * 44) + 'px'
    const labelsM  = entradasM.map(([k]) => k)
    const valoresM = entradasM.map(([, v]) => v)
    const coloresM = labelsM.map((l, i) => l === 'Otros' ? '#cbd5e1' : _COLORES_GRAFICO[i % _COLORES_GRAFICO.length])
    if (_graficoMunicipio) _graficoMunicipio.destroy()
    _graficoMunicipio = new Chart(canvM, {
      type: 'bar',
      data: { labels: labelsM, datasets: [{ data: valoresM, backgroundColor: coloresM, borderRadius: 6, borderSkipped: false, barThickness: 22 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} votante${ctx.parsed.x !== 1 ? 's' : ''}` } }
        },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 }, color: '#64748b' }, grid: { color: 'rgba(0,0,0,0.04)' } },
          y: { ticks: { font: { size: 12 }, color: '#1e293b' }, grid: { display: false } }
        }
      }
    })
  }

  // ── Gráfico Puesto (dona) ──
  const wrapP  = document.getElementById('grafico-wrap-puesto')
  const canvP  = document.getElementById('grafico-puesto')
  const entradasP = agrupar(base, 'puesto_votacion')

  if (!entradasP.length) {
    vacioEnCanvas(wrapP, canvP, 'Sin datos de puesto.')
  } else {
    canvP.style.display = ''
    wrapP.style.display = ''
    wrapP.querySelector('.grafico-sin-datos')?.remove()
    const labelsP  = entradasP.map(([k]) => k)
    const valoresP = entradasP.map(([, v]) => v)
    const coloresP = labelsP.map((_, i) => _COLORES_GRAFICO[i % _COLORES_GRAFICO.length])
    if (_graficoPuesto) _graficoPuesto.destroy()
    _graficoPuesto = new Chart(canvP, {
      type: 'doughnut',
      data: { labels: labelsP, datasets: [{ data: valoresP, backgroundColor: coloresP, borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '62%',
        layout: { padding: { right: 8 } },
        plugins: {
          legend: {
            position: 'right',
            labels: {
              font: { size: 11 },
              padding: 10,
              boxWidth: 11,
              boxHeight: 11,
              usePointStyle: true,
              pointStyle: 'circle',
              filter: (item) => item.index < 10,
            }
          },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} votante${ctx.parsed !== 1 ? 's' : ''}` } }
        }
      }
    })
  }

}

function renderGraficoVotantes() { renderGraficosVotantes() }

/* ==============================================
   EVENTOS
============================================== */
function iniciarModalEvento() {
  const overlay  = document.getElementById('modal-crear-evento')
  const btnAbrir = document.getElementById('btn-abrir-evento')
  const btnCerrar = document.getElementById('modal-cerrar-evento')
  const btnCancelar = document.getElementById('modal-cancelar-evento')
  if (!overlay) return

  iniciarMultiselectResponsables()

  const abrir = () => {
    overlay.style.display = 'flex'
    document.getElementById('form-evento-nuevo').reset()
    resetMultiselect()
    document.getElementById('evento-nuevo-alerta').style.display = 'none'
  }
  const cerrar = () => { overlay.style.display = 'none' }

  btnAbrir.addEventListener('click', abrir)
  btnCerrar.addEventListener('click', cerrar)
  btnCancelar.addEventListener('click', cerrar)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar() })
}

document.getElementById('form-evento-nuevo').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form     = e.target
  const alertaEl = document.getElementById('evento-nuevo-alerta')
  const btn      = form.querySelector('button[type="submit"]')

  if (_responsablesSeleccionados.length === 0) {
    mostrarAlerta(alertaEl, '⚠️ Selecciona al menos un responsable.', 'error')
    return
  }

  btn.disabled = true
  btn.textContent = 'Guardando…'
  alertaEl.style.display = 'none'

  const datos = {
    nombre_evento:    form.nombre_evento.value.trim(),
    responsables:     _responsablesSeleccionados,
    municipio:        form.municipio_evento.value,
    fecha:            form.fecha_evento.value,
    hora_inicio:      form.hora_inicio.value,
    hora_cierre:      form.hora_cierre.value,
    direccion:        form.direccion_evento.value.trim(),
    creado_por:       usuarioActual.id,
  }

  const { error } = await db.from('eventos').insert([datos])

  if (error) {
    mostrarAlerta(alertaEl, '❌ Error al guardar: ' + error.message, 'error')
  } else {
    document.getElementById('modal-crear-evento').style.display = 'none'
    await cargarEventos()
  }

  btn.disabled = false
  btn.textContent = 'Guardar evento'
})

async function cargarEventos() {
  const { data, error } = await db
    .from('eventos')
    .select('*')
    .order('fecha', { ascending: true })

  const wrap = document.getElementById('lista-eventos-wrap')
  if (!wrap) return

  if (error || !data?.length) {
    wrap.innerHTML = `
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
        <line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
      <p style="font-size:1rem;font-weight:600">Sin eventos registrados</p>
      <p style="font-size:0.875rem">Crea tu primer evento con el botón de arriba</p>`
    wrap.style.cssText = 'min-height:300px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1rem;color:var(--texto-muted)'
    return
  }

  wrap.style.cssText = ''

  const ahora = new Date()

  function estadoEvento(ev) {
    if (!ev.fecha || !ev.hora_inicio || !ev.hora_cierre) return 'sin-horario'
    const inicio  = new Date(`${ev.fecha}T${ev.hora_inicio}`)
    const cierre  = new Date(`${ev.fecha}T${ev.hora_cierre}`)
    const desde   = new Date(inicio.getTime() - 60 * 60 * 1000)
    const hasta   = new Date(cierre.getTime() + 2 * 60 * 60 * 1000)
    if (ahora < desde)   return 'proximo'
    if (ahora <= cierre) return 'activo'
    if (ahora <= hasta)  return 'finalizado'
    return 'expirado'
  }

  const orden = { activo: 0, proximo: 1, 'sin-horario': 1, finalizado: 2, expirado: 2 }
  data.sort((a, b) => orden[estadoEvento(a)] - orden[estadoEvento(b)])

  wrap.innerHTML = data.map(ev => {
    const responsables = Array.isArray(ev.responsables) ? ev.responsables.join(', ') : ev.responsables
    const fecha = ev.fecha ? new Date(ev.fecha + 'T00:00:00').toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' }) : '—'
    const estado = estadoEvento(ev)
    const registroDeshabilitado = estado === 'finalizado' || estado === 'expirado'

    const badgeEstadoEvento = estado === 'activo'
      ? `<span class="evento-badge activo">● En evento</span>`
      : (estado === 'finalizado' || estado === 'expirado')
      ? `<span class="evento-badge finalizado">✓ Finalizado</span>`
      : estado === 'proximo' || estado === 'sin-horario'
      ? `<span class="evento-badge agendado">◎ Agendado</span>`
      : ''

    const btnRegistro = registroDeshabilitado
      ? `<button class="btn btn-primario" disabled style="font-size:0.78rem;padding:0.3rem 0.75rem;opacity:0.45;cursor:not-allowed" title="El registro ya está cerrado">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
           Registro
         </button>`
      : `<button class="btn-registro-evento btn btn-primario" data-id="${ev.id}" data-nombre="${ev.nombre_evento}" data-responsables='${JSON.stringify(Array.isArray(ev.responsables) ? ev.responsables : [])}' style="font-size:0.78rem;padding:0.3rem 0.75rem">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
           Registro
         </button>`

    return `
      <div class="evento-card${estado === 'finalizado' || estado === 'expirado' ? ' evento-card-finalizado' : ''}">
        <div class="evento-card-header">
          <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap">
            <span class="evento-nombre">${ev.nombre_evento}</span>
            <span class="evento-municipio">${ev.municipio || ''}</span>
            ${badgeEstadoEvento}
          </div>
          <div style="display:flex;gap:0.5rem;flex-wrap:wrap">
            ${btnRegistro}
            <button class="btn-stats-evento btn btn-secundario" data-id="${ev.id}" data-nombre="${ev.nombre_evento}" style="font-size:0.78rem;padding:0.3rem 0.75rem">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
              Estadísticas
            </button>
          </div>
        </div>
        <div class="evento-card-meta">
          <span class="evento-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/></svg>
            ${fecha}
          </span>
          <span class="evento-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${ev.hora_inicio || '—'} – ${ev.hora_cierre || '—'}
          </span>
          <span class="evento-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
            ${ev.direccion || '—'}
          </span>
          <span class="evento-meta-item">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
            ${responsables || '—'}
          </span>
        </div>
      </div>`
  }).join('')

  // Enganche de botones
  wrap.querySelectorAll('.btn-stats-evento').forEach(btn => {
    btn.addEventListener('click', () => abrirStatsEvento(btn.dataset.id, btn.dataset.nombre))
  })
  wrap.querySelectorAll('.btn-registro-evento').forEach(btn => {
    btn.addEventListener('click', () => {
      const responsables = JSON.parse(btn.dataset.responsables || '[]')
      abrirRegistroEvento(btn.dataset.id, btn.dataset.nombre, responsables)
    })
  })
}

// ── Modal QR ──
function iniciarModalQR() {
  const btnQR   = document.getElementById('btn-ver-qr')
  const overlay = document.getElementById('modal-qr')
  const btnCerrar = document.getElementById('modal-cerrar-qr')
  const btnDesc = document.getElementById('btn-descargar-qr')
  if (!btnQR || btnQR.dataset.qrIniciado) return
  btnQR.dataset.qrIniciado = '1'

  const url = window.location.href.replace(/panel-equipo.*/, '') + 'registro-evento/'

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=10&data=${encodeURIComponent(url)}`

  btnQR.addEventListener('click', () => {
    overlay.style.display = 'flex'
    document.getElementById('qr-url-texto').textContent = url
    document.getElementById('qr-img').src = qrSrc
  })
  const cerrar = () => { overlay.style.display = 'none' }
  btnCerrar.addEventListener('click', cerrar)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar() })
  btnDesc.addEventListener('click', () => {
    const a = document.createElement('a')
    a.download = 'qr-asistencia.png'
    a.href = qrSrc
    a.target = '_blank'
    a.click()
  })
}

// ── Modal Registro Manual ──
function abrirRegistroEvento(eventoId, nombreEvento, responsables) {
  const overlay = document.getElementById('modal-registro-evento')
  const form    = document.getElementById('form-registro-evento-manual')
  document.getElementById('registro-evento-titulo').textContent = `Registro — ${nombreEvento}`
  document.getElementById('registro-manual-evento-id').value = eventoId
  document.getElementById('registro-manual-alerta').style.display = 'none'
  form.reset()

  const selRef = document.getElementById('select-referido-registro-manual')
  selRef.innerHTML = '<option value="">— Selecciona un organizador —</option>' +
    responsables.map(r => `<option value="${r}">${r}</option>`).join('')

  overlay.style.display = 'flex'

  const cerrar = () => { overlay.style.display = 'none' }
  document.getElementById('modal-cerrar-registro-evento').onclick = cerrar
  document.getElementById('modal-cancelar-registro-evento').onclick = cerrar
  overlay.onclick = (e) => { if (e.target === overlay) cerrar() }
}

document.getElementById('form-registro-evento-manual').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form     = e.target
  const alertaEl = document.getElementById('registro-manual-alerta')
  const btn      = form.querySelector('button[type="submit"]')
  const eventoId = document.getElementById('registro-manual-evento-id').value

  btn.disabled = true
  btn.textContent = 'Guardando…'
  alertaEl.style.display = 'none'

  const { error } = await db.from('asistentes_evento').insert([{
    evento_id:       eventoId,
    nombre_completo: form.nombre_completo.value.trim(),
    cedula:          form.cedula.value.trim(),
    telefono:        form.telefono.value.trim() || null,
    referido:        form.referido.value,
  }])

  if (error) {
    mostrarAlerta(alertaEl, '❌ Error: ' + error.message, 'error')
  } else {
    form.reset()
    mostrarAlerta(alertaEl, '✅ Asistencia registrada correctamente.', 'exito')
  }

  btn.disabled = false
  btn.textContent = 'Registrar asistencia'
})

// ── Modal Estadísticas ──
let _graficoStats = null
let _statsActuales = { asistentes: [], cedulasVotantes: new Set(), nombreEvento: '' }

async function abrirStatsEvento(eventoId, nombreEvento) {
  const overlay = document.getElementById('modal-stats-evento')
  overlay.style.display = 'flex'
  document.getElementById('stats-evento-nombre').textContent = nombreEvento
  document.getElementById('stats-kpis').innerHTML = '<p style="color:var(--texto-muted);font-size:0.85rem">Cargando…</p>'
  document.getElementById('stats-tabla').innerHTML = ''

  // Destruir gráfico anterior
  if (_graficoStats) { _graficoStats.destroy(); _graficoStats = null }

  _statsActuales = { asistentes: [], cedulasVotantes: new Set(), nombreEvento }

  const cerrar = () => { overlay.style.display = 'none' }
  document.getElementById('modal-cerrar-stats').onclick = cerrar
  overlay.onclick = (e) => { if (e.target === overlay) cerrar() }

  document.getElementById('btn-descargar-stats').onclick = () => descargarStatsEvento()

  // Cargar asistentes del evento
  const { data: asistentes, error } = await db
    .from('asistentes_evento')
    .select('*')
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: true })

  if (error) {
    document.getElementById('stats-kpis').innerHTML = `<p style="color:red">Error: ${error.message}</p>`
    return
  }

  const total = asistentes?.length || 0

  // Cruzar cédulas con lista_votantes
  let votantes = 0
  if (total > 0) {
    const cedulas = asistentes.map(a => a.cedula).filter(Boolean)
    const { data: encontrados } = await db
      .from('lista_votantes')
      .select('cedula')
      .in('cedula', cedulas)
    votantes = encontrados?.length || 0
  }
  const noVotantes = total - votantes

  // KPIs
  document.getElementById('stats-kpis').innerHTML = `
    <div class="stats-kpi">
      <span class="stats-kpi-val">${total}</span>
      <span class="stats-kpi-label">Total asistentes</span>
    </div>
    <div class="stats-kpi" style="--kpi-color:#22c55e">
      <span class="stats-kpi-val">${votantes}</span>
      <span class="stats-kpi-label">Votantes registrados</span>
    </div>
    <div class="stats-kpi" style="--kpi-color:#f97316">
      <span class="stats-kpi-val">${noVotantes}</span>
      <span class="stats-kpi-label">No registrados</span>
    </div>`

  // Gráfico dona
  const canvas = document.getElementById('grafico-stats-evento')
  if (total > 0) {
    _graficoStats = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ['Votantes registrados', 'No registrados'],
        datasets: [{ data: [votantes, noVotantes], backgroundColor: ['#22c55e', '#f97316'], borderWidth: 2, borderColor: '#fff', hoverOffset: 6 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { font: { size: 12 }, padding: 16, usePointStyle: true, pointStyle: 'circle' } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} (${total ? Math.round(ctx.parsed/total*100) : 0}%)` } }
        }
      }
    })
  } else {
    canvas.getContext('2d') // limpia
    canvas.parentElement.innerHTML = '<p style="text-align:center;color:var(--texto-muted);padding:3rem 0">Sin asistentes registrados aún</p>'
  }

  // Tabla de asistentes
  if (total > 0) {
    const cedulasVotantes = new Set()
    if (votantes > 0) {
      const { data: enc } = await db.from('lista_votantes').select('cedula').in('cedula', asistentes.map(a => a.cedula))
      enc?.forEach(v => cedulasVotantes.add(v.cedula))
    }
    _statsActuales = { asistentes, cedulasVotantes, nombreEvento }
    document.getElementById('stats-tabla').innerHTML = `
      <table class="tabla-asistentes">
        <thead><tr><th>Nombre</th><th>Cédula</th><th>Teléfono</th><th>Referido</th><th>Votante</th></tr></thead>
        <tbody>
          ${asistentes.map(a => `
            <tr>
              <td>${a.nombre_completo}</td>
              <td>${a.cedula}</td>
              <td>${a.telefono || '—'}</td>
              <td>${a.referido || '—'}</td>
              <td>${cedulasVotantes.has(a.cedula) ? '<span class="badge-si">Sí</span>' : '<span class="badge-no">No</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`
  }
}

function descargarStatsEvento() {
  const { asistentes, cedulasVotantes, nombreEvento } = _statsActuales
  if (!asistentes.length) return

  const hacer = () => {
    const datos = asistentes.map(a => ({
      'Nombre':   a.nombre_completo,
      'Cédula':   a.cedula,
      'Teléfono': a.telefono || '',
      'Referido': a.referido || '',
      'Votante registrado': cedulasVotantes.has(a.cedula) ? 'Sí' : 'No',
    }))
    const hoja  = XLSX.utils.json_to_sheet(datos)
    hoja['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 18 }]
    const libro = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(libro, hoja, 'Asistentes')
    const nombreArchivo = `asistentes_${nombreEvento.replace(/\s+/g, '_').toLowerCase()}_${hoy()}.xlsx`
    XLSX.writeFile(libro, nombreArchivo)
  }

  if (!window.XLSX) {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    script.onload = hacer
    document.head.appendChild(script)
  } else {
    hacer()
  }
}

document.getElementById('form-votante').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const alertaEl = document.getElementById('votante-alerta')
  const btn = form.querySelector('button[type="submit"]')

  btn.disabled = true
  btn.textContent = 'Guardando...'
  alertaEl.style.display = 'none'

  const datos = {
    nombre_completo: form.nombre_completo.value,
    cedula: form.cedula.value,
    telefono: form.telefono.value || null,
    municipio: form.municipio.value,
    puesto_votacion: form.puesto_votacion.value,
    mesa: form.mesa.value,
    amigo_referido: form.amigo_referido.value,
    subido_por: usuarioActual.id,
    estado: 'pendiente',
  }

  const { error } = await db.from('lista_votantes').insert(datos)

  if (error) {
    mostrarAlerta(alertaEl, '❌ Error al guardar. Intenta de nuevo.', 'error')
  } else {
    mostrarAlerta(alertaEl, '✅ Registro guardado correctamente.', 'exito')
    form.reset()
    await cargarVotantes()
    setTimeout(() => {
      document.getElementById('modal-añadir-votante').style.display = 'none'
    }, 1200)
  }

  btn.disabled = false
  btn.textContent = 'Guardar registro'
})


/* ==============================================
   APROBACIONES
============================================== */

async function cargarAprobaciones() {
  const [{ data: reuniones, error: errR }, { data: votantes, error: errV }] = await Promise.all([
    db.from('lista_reuniones').select('*').order('created_at', { ascending: false }),
    db.from('lista_votantes').select('*').order('created_at', { ascending: false }),
  ])

  if (errR || errV) {
    const msg = '<tr><td colspan="8" class="tabla-vacia" style="color:var(--rojo)">Error al cargar datos. Intenta de nuevo.</td></tr>'
    document.getElementById('tabla-apro-reuniones-body').innerHTML = msg
    document.getElementById('tabla-apro-votantes-body').innerHTML = msg
    return
  }

  const r = reuniones || []
  const v = votantes || []

  const pendR = r.filter(x => x.estado === 'pendiente').length
  const pendV = v.filter(x => x.estado === 'pendiente').length

  document.getElementById('badge-apro-r').textContent = pendR
  document.getElementById('badge-apro-v').textContent = pendV

  // Tabla reuniones
  const tbodyR = document.getElementById('tabla-apro-reuniones-body')
  tbodyR.innerHTML = r.length ? r.map(r => filaAprobacionReunion(r)).join('') :
    '<tr><td colspan="7" class="tabla-vacia">Sin registros.</td></tr>'

  // Tabla votantes
  const tbodyV = document.getElementById('tabla-apro-votantes-body')
  tbodyV.innerHTML = v.length ? v.map(v => filaAprobacionVotante(v)).join('') :
    '<tr><td colspan="8" class="tabla-vacia">Sin registros.</td></tr>'
}

function filaAprobacionReunion(r) {
  const acciones = r.estado === 'pendiente'
    ? `<div class="acciones-grupo">
        <button class="btn btn-exito" onclick="aprobar('lista_reuniones','${r.id}')">✓ Aprobar</button>
        <div class="rechazo-fila">
          <input type="text" id="motivo-${r.id}" placeholder="Motivo rechazo">
          <button class="btn btn-peligro" onclick="rechazar('lista_reuniones','${r.id}')">✕</button>
        </div>
       </div>`
    : `<span style="font-size:0.75rem;color:var(--texto-muted)">${r.comentario_rechazo || '—'}</span>`

  return `<tr>
    <td>${r.nombre_completo}</td><td>${r.cedula}</td>
    <td>${r.municipio || '—'}</td><td>${r.fecha_reunion || '—'}</td>
    <td>${r.amigo_referido}</td>
    <td>${badgeEstado(r.estado)}</td>
    <td>${acciones}</td>
  </tr>`
}

function filaAprobacionVotante(v) {
  const acciones = v.estado === 'pendiente'
    ? `<div class="acciones-grupo">
        <button class="btn btn-exito" onclick="aprobar('lista_votantes','${v.id}')">✓ Aprobar</button>
        <div class="rechazo-fila">
          <input type="text" id="motivo-${v.id}" placeholder="Motivo rechazo">
          <button class="btn btn-peligro" onclick="rechazar('lista_votantes','${v.id}')">✕</button>
        </div>
       </div>`
    : `<span style="font-size:0.75rem;color:var(--texto-muted)">${v.comentario_rechazo || '—'}</span>`

  return `<tr>
    <td>${v.nombre_completo}</td><td>${v.cedula}</td>
    <td>${v.municipio}</td><td>${v.puesto_votacion}</td><td>${v.mesa}</td>
    <td>${v.amigo_referido}</td>
    <td>${badgeEstado(v.estado)}</td>
    <td>${acciones}</td>
  </tr>`
}

async function aprobar(tabla, id) {
  await db.from(tabla).update({
    estado: 'aprobado',
    aprobado_por: usuarioActual.id,
    comentario_rechazo: null,
  }).eq('id', id)
  await cargarAprobaciones()
}

async function rechazar(tabla, id) {
  const motivo = document.getElementById(`motivo-${id}`)?.value?.trim()
  if (!motivo) { alert('Escribe un motivo de rechazo.'); return }

  await db.from(tabla).update({
    estado: 'rechazado',
    aprobado_por: usuarioActual.id,
    comentario_rechazo: motivo,
  }).eq('id', id)
  await cargarAprobaciones()
}


/* ==============================================
   CONSOLIDADOS
============================================== */

let _conGraficoMunicipio = null
let _conGraficoReferido  = null
let _conGraficoPuesto    = null

async function cargarConsolidado() {
  const [{ data: r, error: errR }, { data: v, error: errV }] = await Promise.all([
    db.from('lista_reuniones').select('*').order('created_at', { ascending: false }),
    db.from('lista_votantes').select('*').order('created_at', { ascending: false }),
  ])

  if (errR || errV) { console.error('Error cargando consolidado:', errR || errV); return }

  datosReuniones = r || []
  datosVotantes  = v || []
  renderConsolidado()
  renderGraficosConsolidado()
}

function renderGraficosConsolidado() {
  const v = datosVotantes

  // ── KPIs ──
  const municipios = new Set(v.map(x => x.municipio).filter(Boolean))
  const puestos    = new Set(v.map(x => x.puesto_votacion).filter(Boolean))
  const referidos  = new Set(v.map(x => x.amigo_referido).filter(Boolean))
  document.getElementById('con-kpi-votantes').textContent   = v.length
  document.getElementById('con-kpi-municipios').textContent = municipios.size
  document.getElementById('con-kpi-puestos').textContent    = puestos.size
  document.getElementById('con-kpi-referidos').textContent  = referidos.size

  const PALETA = ['#facc15','#f97316','#ef4444','#a855f7','#3b82f6','#10b981','#06b6d4','#e11d48','#84cc16','#f59e0b','#8b5cf6','#14b8a6','#f43f5e','#22c55e','#0ea5e9']

  // ── Gráfico Municipio (dona) ──
  const entMuni = agrupar(v, 'municipio')
  const wrapM = document.getElementById('con-wrap-municipio')
  if (entMuni.length) {
    wrapM.querySelector('.grafico-sin-datos')?.remove()
    document.getElementById('con-grafico-municipio').style.display = ''
    if (_conGraficoMunicipio) _conGraficoMunicipio.destroy()
    _conGraficoMunicipio = new Chart(document.getElementById('con-grafico-municipio'), {
      type: 'doughnut',
      data: {
        labels: entMuni.map(([k]) => k),
        datasets: [{ data: entMuni.map(([,n]) => n), backgroundColor: entMuni.map((_,i) => PALETA[i % PALETA.length]), borderWidth: 2, borderColor: '#fff', hoverOffset: 8 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '60%',
        plugins: {
          legend: { position: 'right', labels: { font: { size: 11 }, padding: 10, usePointStyle: true, pointStyle: 'circle', filter: item => item.index < 10 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed} votos` } }
        }
      }
    })
  }

  // ── Gráfico Referido (barras horizontales) ──
  const entRef = agrupar(v, 'amigo_referido')
  const wrapR = document.getElementById('con-wrap-referido')
  if (entRef.length) {
    wrapR.style.height = Math.max(160, entRef.length * 44) + 'px'
    wrapR.querySelector('.grafico-sin-datos')?.remove()
    document.getElementById('con-grafico-referido').style.display = ''
    if (_conGraficoReferido) _conGraficoReferido.destroy()
    _conGraficoReferido = new Chart(document.getElementById('con-grafico-referido'), {
      type: 'bar',
      data: {
        labels: entRef.map(([k]) => k),
        datasets: [{ data: entRef.map(([,n]) => n), backgroundColor: entRef.map((_,i) => PALETA[i % PALETA.length]), borderRadius: 6, borderSkipped: false, barThickness: 22 }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} voto${ctx.parsed.x !== 1 ? 's' : ''}` } }
        },
        scales: {
          x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 11 }, color: '#64748b' }, grid: { color: 'rgba(0,0,0,0.04)' } },
          y: { ticks: { font: { size: 12 }, color: '#1e293b' }, grid: { display: false } }
        }
      }
    })
  }

  // ── Ranking Puestos ──
  const entPuesto = agrupar(v, 'puesto_votacion')
  renderRankingPuestos(entPuesto)
}

function renderRankingPuestos(entradas) {
  const wrap = document.getElementById('con-ranking-puestos')
  if (!wrap) return

  const PALETA = ['#facc15','#f97316','#ef4444','#a855f7','#3b82f6','#10b981','#06b6d4','#e11d48','#84cc16','#f59e0b']
  const TOP = 10
  const top = entradas.slice(0, TOP)
  const maximo = top[0]?.[1] || 1

  if (!top.length) {
    wrap.innerHTML = '<p style="color:var(--texto-muted);font-size:0.875rem;text-align:center;padding:1.5rem 0">Sin datos de puestos</p>'
    return
  }

  wrap.innerHTML = top.map(([nombre, n], i) => {
    const pct = Math.round(n / maximo * 100)
    const color = PALETA[i % PALETA.length]
    return `
      <div class="ranking-puesto-item">
        <div class="ranking-puesto-num">${i + 1}</div>
        <div class="ranking-puesto-info">
          <div class="ranking-puesto-header">
            <span class="ranking-puesto-nombre">${nombre}</span>
            <span class="ranking-puesto-val">${n} <span style="font-weight:400;color:var(--texto-muted)">voto${n !== 1 ? 's' : ''}</span></span>
          </div>
          <div class="ranking-puesto-barra-bg">
            <div class="ranking-puesto-barra-fill" style="width:${pct}%;background:${color}"></div>
          </div>
        </div>
      </div>`
  }).join('')

  // Botón "Ver todos"
  const btnVerTodos = document.getElementById('btn-ver-todos-puestos')
  const badge = document.getElementById('con-puestos-total-badge')
  if (entradas.length > TOP) {
    btnVerTodos.style.display = ''
    badge.textContent = entradas.length
    btnVerTodos.onclick = () => abrirModalTodosPuestos(entradas)
  } else {
    btnVerTodos.style.display = 'none'
  }
}

function abrirModalTodosPuestos(entradas) {
  const overlay = document.getElementById('modal-todos-puestos')
  const lista   = document.getElementById('modal-lista-puestos')
  const buscador = document.getElementById('buscador-puestos-modal')
  const PALETA  = ['#facc15','#f97316','#ef4444','#a855f7','#3b82f6','#10b981','#06b6d4','#e11d48','#84cc16','#f59e0b']
  const maximo  = entradas[0]?.[1] || 1

  const renderLista = (filtradas) => {
    lista.innerHTML = filtradas.map(([nombre, n], i) => {
      const pct   = Math.round(n / maximo * 100)
      const color = PALETA[i % PALETA.length]
      return `
        <div class="ranking-puesto-item">
          <div class="ranking-puesto-num">${i + 1}</div>
          <div class="ranking-puesto-info">
            <div class="ranking-puesto-header">
              <span class="ranking-puesto-nombre">${nombre}</span>
              <span class="ranking-puesto-val">${n} <span style="font-weight:400;color:var(--texto-muted)">voto${n !== 1 ? 's' : ''}</span></span>
            </div>
            <div class="ranking-puesto-barra-bg">
              <div class="ranking-puesto-barra-fill" style="width:${pct}%;background:${color}"></div>
            </div>
          </div>
        </div>`
    }).join('')
  }

  renderLista(entradas)
  buscador.value = ''
  overlay.style.display = 'flex'

  buscador.oninput = () => {
    const q = buscador.value.toLowerCase()
    renderLista(entradas.filter(([k]) => k.toLowerCase().includes(q)))
  }
  document.getElementById('modal-cerrar-puestos').onclick = () => { overlay.style.display = 'none' }
  overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = 'none' }
}

function renderConsolidado() {
  const estado = document.getElementById('filtro-estado').value
  const municipio = document.getElementById('filtro-municipio').value.toLowerCase()

  const filtrar = (arr) => arr.filter(x => {
    if (estado && x.estado !== estado) return false
    if (municipio && !x.municipio?.toLowerCase().includes(municipio)) return false
    return true
  })

  const r = filtrar(datosReuniones)
  const v = filtrar(datosVotantes)

  const tbodyR = document.getElementById('tabla-con-reuniones-body')
  tbodyR.innerHTML = r.length ? r.map(x => `
    <tr>
      <td>${x.nombre_completo}</td><td>${x.cedula}</td>
      <td>${x.municipio || '—'}</td><td>${x.fecha_reunion || '—'}</td>
      <td>${x.amigo_referido}</td>
      <td>${badgeEstado(x.estado)}</td>
      <td style="font-size:0.8rem;color:var(--texto-muted)">${x.comentario_rechazo || '—'}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="tabla-vacia">Sin resultados.</td></tr>'

  const tbodyV = document.getElementById('tabla-con-votantes-body')
  tbodyV.innerHTML = v.length ? v.map(x => `
    <tr>
      <td>${x.nombre_completo}</td><td>${x.cedula}</td>
      <td>${x.municipio}</td><td>${x.puesto_votacion}</td><td>${x.mesa}</td>
      <td>${x.amigo_referido}</td>
      <td>${badgeEstado(x.estado)}</td>
      <td style="font-size:0.8rem;color:var(--texto-muted)">${x.comentario_rechazo || '—'}</td>
    </tr>`).join('') : '<tr><td colspan="8" class="tabla-vacia">Sin resultados.</td></tr>'
}

function iniciarFiltrosConsolidado() {
  document.getElementById('filtro-estado').addEventListener('input', renderConsolidado)
  document.getElementById('filtro-municipio').addEventListener('input', renderConsolidado)
}


/* ==============================================
   EXPORTAR EXCEL
   Usa SheetJS vía CDN (se carga automáticamente)
============================================== */

function iniciarExportarExcel() {
  document.getElementById('btn-exportar').addEventListener('click', async () => {
    // Cargar SheetJS solo cuando se necesite
    if (!window.XLSX) {
      const script = document.createElement('script')
      script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
      script.onload = () => exportarExcel()
      document.head.appendChild(script)
    } else {
      exportarExcel()
    }
  })
}

function exportarExcel() {
  // Determinar qué pestaña está activa en consolidado
  const tabActiva = document.querySelector('#sec-consolidado .pestana.activa')?.dataset.tab
  const esReuniones = tabActiva === 'con-reuniones'

  const estado = document.getElementById('filtro-estado').value
  const municipio = document.getElementById('filtro-municipio').value.toLowerCase()

  const filtrar = (arr) => arr.filter(x => {
    if (estado && x.estado !== estado) return false
    if (municipio && !x.municipio?.toLowerCase().includes(municipio)) return false
    return true
  })

  let datos, nombreHoja, nombreArchivo
  if (esReuniones) {
    datos = filtrar(datosReuniones).map(r => ({
      Nombre: r.nombre_completo,
      Cédula: r.cedula,
      Teléfono: r.telefono || '',
      Municipio: r.municipio || '',
      'Fecha Reunión': r.fecha_reunion || '',
      'Referido por': r.amigo_referido,
      Estado: r.estado,
      Comentario: r.comentario_rechazo || '',
    }))
    nombreHoja = 'Reuniones'
    nombreArchivo = `reuniones_${hoy()}.xlsx`
  } else {
    datos = filtrar(datosVotantes).map(v => ({
      Nombre: v.nombre_completo,
      Cédula: v.cedula,
      Teléfono: v.telefono || '',
      Municipio: v.municipio,
      Puesto: v.puesto_votacion,
      Mesa: v.mesa,
      'Referido por': v.amigo_referido,
      Estado: v.estado,
      Comentario: v.comentario_rechazo || '',
    }))
    nombreHoja = 'Votantes'
    nombreArchivo = `votantes_${hoy()}.xlsx`
  }

  const hoja = XLSX.utils.json_to_sheet(datos)
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, nombreHoja)
  XLSX.writeFile(libro, nombreArchivo)
}


/* ==============================================
   SOLICITUDES
============================================== */

async function cargarSolicitudes() {
  const { data } = await db
    .from('solicitudes')
    .select('*, usuarios(nombre_completo)')
    .order('created_at', { ascending: false })

  const items = data || []
  const pendiente = items.filter(x => x.estado === 'pendiente').length
  const revision = items.filter(x => x.estado === 'revision').length
  const resuelto = items.filter(x => x.estado === 'resuelto').length

  document.getElementById('sol-kpi-pendiente').textContent = pendiente
  document.getElementById('sol-kpi-revision').textContent = revision
  document.getElementById('sol-kpi-resuelto').textContent = resuelto

  renderSolicitudes(items)

  // Filtros
  const filtroEstado = document.getElementById('sol-filtro-estado')
  const filtroTexto = document.getElementById('sol-filtro-texto')
  const aplicar = () => {
    const est = filtroEstado.value
    const txt = filtroTexto.value.toLowerCase()
    renderSolicitudes(items.filter(x => {
      if (est && x.estado !== est) return false
      if (txt && !x.asunto?.toLowerCase().includes(txt) && !x.usuarios?.nombre_completo?.toLowerCase().includes(txt)) return false
      return true
    }))
  }
  filtroEstado.addEventListener('input', aplicar)
  filtroTexto.addEventListener('input', aplicar)
}

function renderSolicitudes(items) {
  const tbody = document.getElementById('tabla-solicitudes-body')
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="tabla-vacia">Sin solicitudes.</td></tr>'
    return
  }
  tbody.innerHTML = items.map(s => `
    <tr>
      <td>${s.usuarios?.nombre_completo || '—'}</td>
      <td>${s.tipo || '—'}</td>
      <td>${s.asunto || '—'}</td>
      <td>${badgeEstado(s.estado)}</td>
      <td style="font-size:0.8rem;color:var(--texto-muted)">${formatFecha(s.created_at)}</td>
    </tr>`).join('')
}


/* ==============================================
   NOTICIAS Y EVENTOS
============================================== */

async function cargarNoticias() {
  const { data } = await db
    .from('noticias_eventos')
    .select('*')
    .order('created_at', { ascending: false })

  renderNoticias(data || [])
}

function renderNoticias(items) {
  const tbody = document.getElementById('tabla-noticias-body')
  if (!tbody) return

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="tabla-vacia">Sin publicaciones aún.</td></tr>'
    return
  }

  tbody.innerHTML = items.map(n => `
    <tr>
      <td>
        <span class="badge-rol" style="background:${n.tipo === 'evento' ? '#fef3c7' : '#dbeafe'}; color:${n.tipo === 'evento' ? '#92400e' : '#1e40af'}">
          ${n.tipo === 'evento' ? 'EVENTO' : 'NOTICIA'}
        </span>
      </td>
      <td>
        <div style="font-weight:600; color:var(--texto)">${n.titulo}</div>
        <div style="font-size:0.75rem; color:var(--texto-sec)">${n.resumen || n.cuerpo || ''}</div>
      </td>
      <td>${formatFecha(n.created_at)}</td>
      <td>
        <span style="color:${n.activo !== false ? 'var(--exito)' : 'var(--error)'}">
          ${n.activo !== false ? '● Visible' : '● Oculto'}
        </span>
      </td>
      <td>
        <button class="btn btn-sm" onclick="eliminarPublicacion('${n.id}')" title="Eliminar">🗑️</button>
      </td>
    </tr>`).join('')
}

async function eliminarPublicacion(id) {
  if (!confirm('¿Seguro que quieres eliminar esta publicación?')) return
  const { error } = await db.from('noticias_eventos').delete().eq('id', id)
  if (error) alert("Error: " + error.message)
  else await cargarNoticias()
}

document.getElementById('form-noticia').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const alertaEl = document.getElementById('noticia-alerta')
  const btn = form.querySelector('button[type="submit"]')

  btn.disabled = true
  btn.textContent = 'Publicando...'

  const { error } = await db.from('noticias_eventos').insert({
    tipo: 'noticia',
    titulo: form.titulo.value,
    cuerpo: form.resumen.value, // En el HTML el campo de texto se llama 'resumen'
    creado_por: usuarioActual.id,
    activo: true
  })

  if (error) {
    mostrarAlerta(alertaEl, '❌ Error al publicar: ' + error.message, 'error')
  } else {
    mostrarAlerta(alertaEl, '✅ Noticia publicada.', 'exito')
    form.reset()
    await cargarNoticias()
  }
  btn.disabled = false
  btn.textContent = 'Publicar'
})

document.getElementById('form-evento').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const alertaEl = document.getElementById('evento-alerta')
  const btn = form.querySelector('button[type="submit"]')

  btn.disabled = true
  btn.textContent = 'Publicando...'

  const { error } = await db.from('noticias_eventos').insert({
    tipo: 'evento',
    titulo: form.titulo.value,
    municipio: form.municipio.value,
    fecha_evento: form.fecha_evento.value || null,
    hora_evento: form.hora_evento.value || null,
    lugar_evento: form.lugar.value || null,
    creado_por: usuarioActual.id,
    activo: true
  })

  if (error) {
    mostrarAlerta(alertaEl, '❌ Error al publicar: ' + error.message, 'error')
  } else {
    mostrarAlerta(alertaEl, '✅ Evento publicado.', 'exito')
    form.reset()
    await cargarNoticias()
  }
  btn.disabled = false
  btn.textContent = 'Publicar evento'
})


/* ==============================================
   GESTIÓN DE USUARIOS
============================================== */

async function cargarUsuarios() {
  const { data, error } = await db
    .from('usuarios')
    .select('*')

  const tbody = document.getElementById('tabla-usuarios-body')

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="tabla-vacia" style="color:var(--rojo)">Error: ${error.message}</td></tr>`
    return
  }

  const JERARQUIA = { owner: 0, admin: 1, lider: 2, amigo: 3 }
  const items = (data || []).sort((a, b) => {
    const rA = JERARQUIA[a.rol] ?? 99
    const rB = JERARQUIA[b.rol] ?? 99
    if (rA !== rB) return rA - rB
    return (a.nombre_completo || '').localeCompare(b.nombre_completo || '', 'es')
  })

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="tabla-vacia">Sin usuarios.</td></tr>'
    return
  }

  tbody.innerHTML = items.map(u => `
    <tr>
      <td>${u.nombre_completo}</td>
      <td>${u.email}</td>
      <td><span class="estado-badge estado-${u.rol}">${u.rol}</span></td>
      <td>${u.municipio || '—'}</td>
      <td>${u.telefono || '—'}</td>
      <td>
        <button class="btn btn-peligro btn-sm" onclick="desactivarUsuario('${u.id}', ${u.activo})">
          ${u.activo ? 'Desactivar' : 'Activar'}
        </button>
      </td>
    </tr>`).join('')
}

async function desactivarUsuario(id, activo) {
  if (!confirm(`¿${activo ? 'Desactivar' : 'Activar'} este usuario?`)) return
  await db.from('usuarios').update({ activo: !activo }).eq('id', id)
  await cargarUsuarios()
}

// ── Modal Añadir Usuario ──
;(function () {
  const btnAbrir   = document.getElementById('btn-abrir-usuario')
  const overlay    = document.getElementById('modal-añadir-usuario')
  const btnCerrar  = document.getElementById('modal-cerrar-usuario')
  const btnCancel  = document.getElementById('modal-cancelar-usuario')
  if (!btnAbrir) return
  const cerrar = () => {
    overlay.style.display = 'none'
    document.getElementById('form-usuario').reset()
    document.getElementById('usuario-alerta').style.display = 'none'
  }
  btnAbrir.addEventListener('click', () => { overlay.style.display = 'flex' })
  btnCerrar.addEventListener('click', cerrar)
  btnCancel.addEventListener('click', cerrar)
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cerrar() })
})()

document.getElementById('form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault()
  const form = e.target
  const alertaEl = document.getElementById('usuario-alerta')
  const btn = form.querySelector('button[type="submit"]')
  btn.disabled = true
  btn.textContent = 'Creando...'

  const { data: { session } } = await db.auth.getSession()

  const res = await fetch(`${SUPABASE_URL}/functions/v1/crear-usuario`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      email: form.email.value,
      password: form.password.value,
      nombre_completo: form.nombre_completo.value,
      rol: form.rol.value,
      municipio: form.municipio.value || null,
      telefono: form.telefono.value || null,
      creado_por: usuarioActual.id,
    }),
  })

  const resultado = await res.json()

  if (!res.ok) {
    mostrarAlerta(alertaEl, `❌ ${resultado.error || 'Error al crear usuario'}`, 'error')
  } else {
    document.getElementById('modal-añadir-usuario').style.display = 'none'
    form.reset()
    await cargarUsuarios()
  }

  btn.disabled = false
  btn.textContent = 'Crear usuario'
})


/* ==============================================
   LOG DE AUDITORÍA
============================================== */

async function cargarAuditoria() {
  const { data } = await db
    .from('auditoria')
    .select('*, usuarios(nombre_completo)')
    .order('created_at', { ascending: false })
    .limit(200)

  const items = data || []
  renderAuditoria(items)

  // Filtro de búsqueda
  const filtro = document.getElementById('auditoria-filtro')
  filtro.addEventListener('input', () => {
    const txt = filtro.value.toLowerCase()
    renderAuditoria(items.filter(x =>
      x.accion?.toLowerCase().includes(txt) ||
      x.usuarios?.nombre_completo?.toLowerCase().includes(txt) ||
      x.tabla?.toLowerCase().includes(txt)
    ))
  })

  // Exportar auditoría
  document.getElementById('btn-exportar-auditoria').onclick = () => exportarAuditoria(items)
}

function renderAuditoria(items) {
  const tbody = document.getElementById('tabla-auditoria-body')
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="tabla-vacia">Sin registros de auditoría.</td></tr>'
    return
  }
  tbody.innerHTML = items.map(a => `
    <tr>
      <td style="font-size:0.8rem;color:var(--texto-muted)">${formatFecha(a.created_at)}</td>
      <td>${a.usuarios?.nombre_completo || '—'}</td>
      <td>${a.tabla || '—'}</td>
      <td>${a.accion || '—'}</td>
      <td style="font-size:0.75rem;color:var(--texto-muted);word-break:break-word">${a.detalle || '—'}</td>
    </tr>`).join('')
}

function exportarAuditoria(items) {
  if (!window.XLSX) {
    const script = document.createElement('script')
    script.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
    script.onload = () => _exportarAuditoriaXLSX(items)
    document.head.appendChild(script)
  } else {
    _exportarAuditoriaXLSX(items)
  }
}

function _exportarAuditoriaXLSX(items) {
  const datos = items.map(a => ({
    Fecha: formatFecha(a.created_at),
    Usuario: a.usuarios?.nombre_completo || '',
    Tabla: a.tabla || '',
    Acción: a.accion || '',
    Detalle: a.detalle || '',
  }))
  const hoja = XLSX.utils.json_to_sheet(datos)
  const libro = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(libro, hoja, 'Auditoría')
  XLSX.writeFile(libro, `auditoria_${hoy()}.xlsx`)
}


/* ==============================================
   MAPA ELECTORAL
============================================== */

// Centroides de los 42 municipios del Valle del Cauca
const CENTROIDES_VDC = {
  'cali': [3.4516, -76.5320],
  'palmira': [3.5338, -76.2985],
  'buenaventura': [3.8802, -77.0311],
  'tulua': [4.0843, -76.1982],
  'cartago': [4.7459, -75.9119],
  'buga': [3.9002, -76.2996],
  'yumbo': [3.5886, -76.4953],
  'jamundi': [3.2629, -76.5387],
  'florida': [3.3283, -76.2356],
  'candelaria': [3.4085, -76.3418],
  'pradera': [3.4213, -76.2443],
  'el cerrito': [3.6953, -76.2954],
  'guacari': [3.7706, -76.3380],
  'ginebra': [3.7427, -76.2745],
  'san pedro': [3.9613, -76.4017],
  'bugalagrande': [4.2060, -76.1597],
  'zarzal': [4.3886, -76.0713],
  'la union': [4.5300, -76.1015],
  'roldanillo': [4.4172, -76.1538],
  'toro': [4.5990, -76.0802],
  'versalles': [4.5800, -76.2386],
  'el dovio': [4.5213, -76.2990],
  'trujillo': [4.2353, -76.3270],
  'riofrio': [4.0918, -76.3507],
  'yotoco': [3.8687, -76.3951],
  'calima': [3.9279, -76.5192],
  'dagua': [3.6573, -76.6894],
  'la cumbre': [3.6430, -76.5638],
  'vijes': [3.6911, -76.4613],
  'restrepo': [3.8227, -76.5303],
  'el aguila': [4.9163, -75.9705],
  'ansermanuevo': [4.8042, -75.9842],
  'el cairo': [4.8958, -76.2418],
  'obando': [4.5782, -75.9781],
  'la victoria': [4.5238, -75.9070],
  'ulloa': [4.7064, -75.9353],
  'alcala': [4.6742, -75.7762],
  'caicedonia': [4.3309, -75.8291],
  'sevilla': [4.2680, -75.9377],
  'andalucia': [4.1523, -76.1668],
  'argelia': [4.0677, -75.9892],
  'bolivar': [4.3432, -76.2281],
}

// Coordenadas de puestos de votación conocidos
// Clave: nombre exacto tal como aparece en lista_votantes (case-insensitive match)
const PUESTOS_VOTACION_COORDS = {
  'colegio cardenas mirriñao': [3.5459649031378686, -76.29660686953302],
  'esc. harold edder zamorano': [3.556195217147753, -76.30078643220871],
}

function normPuesto(nombre) {
  if (!nombre) return ''
  return nombre.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function normMunicipio(nombre) {
  if (!nombre) return ''
  return nombre.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/guadalajara de /g, '')
    .replace(/santiago de /g, '')
}

function colorIntensidad(valor) {
  if (!valor || valor === 0) return '#f1f5f9'
  if (valor <= 10) return '#fef9c3'
  if (valor <= 30) return '#facc15'
  if (valor <= 60) return '#f97316'
  return '#dc2626'
}

async function cargarMapa() {
  // 1. Fetch paralelo
  const [
    { data: reuniones },
    { data: votantes },
    { data: eventos },
    { data: solicitudes },
  ] = await Promise.all([
    db.from('lista_reuniones').select('municipio, estado'),
    db.from('lista_votantes').select('municipio, estado, puesto_votacion'),
    db.from('noticias_eventos').select('titulo, municipio, fecha_evento').eq('tipo', 'evento'),
    db.from('solicitudes').select('municipio, estado, tipo'),
  ])

  // 2. Agregar por municipio
  const stats = {}
  const agregar = (arr, tipo) => {
    ; (arr || []).forEach(x => {
      const k = normMunicipio(x.municipio)
      if (!k) return
      if (!stats[k]) stats[k] = { nombre: x.municipio?.trim(), reuniones: [], votantes: [], eventos: [], solicitudes: [] }
      stats[k][tipo].push(x)
    })
  }
  agregar(reuniones, 'reuniones')
  agregar(votantes, 'votantes')
  agregar(eventos, 'eventos')
  agregar(solicitudes, 'solicitudes')

  // 3. KPIs globales
  const totalR = (reuniones || []).length
  const totalV = (votantes || []).length
  const totalE = (eventos || []).length
  const totalS = (solicitudes || []).length
  const muniActivos = Object.keys(stats).filter(k => stats[k].reuniones.length + stats[k].votantes.length > 0).length

  document.getElementById('mapa-kpi-total').textContent = totalR + totalV
  document.getElementById('mapa-kpi-municipios').textContent = muniActivos
  document.getElementById('mapa-kpi-eventos').textContent = totalE
  document.getElementById('mapa-kpi-solicitudes').textContent = totalS

  // 4. Inicializar Leaflet solo una vez
  if (!mapaLeaflet) {
    mapaLeaflet = L.map('mapa-leaflet', { zoomControl: true, scrollWheelZoom: true })
      .setView([4.0, -76.3], 8)

    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 18,
    }).addTo(mapaLeaflet)

    mapaLeaflet.on('zoomend', () => {
      const zoom = mapaLeaflet.getZoom()
      mapaCirculos.forEach(({ circle, radioBase }) => {
        circle.setRadius(radioBase * Math.pow(0.5, zoom - 8))
      })
    })
  } else {
    const capasAEliminar = []
    mapaLeaflet.eachLayer(layer => {
      if (layer instanceof L.Circle || layer instanceof L.CircleMarker || layer instanceof L.Marker) {
        capasAEliminar.push(layer)
      }
    })
    capasAEliminar.forEach(l => mapaLeaflet.removeLayer(l))
  }
  mapaCirculos = []

  // 5. Círculos por municipio coloreados por intensidad
  const zoomActual = mapaLeaflet.getZoom()
  Object.entries(CENTROIDES_VDC).forEach(([k, coords]) => {
    const nombreMunicipio = k.replace(/(^|\s)\S/g, l => l.toUpperCase())
    const s = stats[k] || { nombre: nombreMunicipio, reuniones: [], votantes: [], eventos: [], solicitudes: [] }
    const intensidad = s.reuniones.length + s.votantes.length
    // ~611 m/px a zoom 8 → radioBase fija el tamaño en píxeles a cualquier zoom
    const nombreMostrar = s.nombre || nombreMunicipio
    const pxBase = Math.max(32, nombreMostrar.length * 2.6) + (intensidad > 0 ? Math.min(intensidad * 0.4, 14) : 0)
    const radioBase = Math.round(pxBase * 611)
    const radio = radioBase * Math.pow(0.5, zoomActual - 8)
    const color = colorIntensidad(intensidad)

    const borderColor = intensidad === 0 ? '#94a3b8' : color
    const circle = L.circle(coords, {
      radius: radio,
      fillColor: color,
      fillOpacity: intensidad === 0 ? 0.45 : 0.85,
      color: borderColor,
      weight: intensidad === 0 ? 1 : 2,
    }).addTo(mapaLeaflet)

    mapaCirculos.push({ circle, radioBase, key: k, intensidad })

    const nombre = s.nombre || nombreMunicipio
    circle.on('click', () => {
      mostrarPanelMapa(nombre, s)
      mostrarSeleccionMapa(coords, color)
    })
    circle.on('mouseover', () => circle.setStyle({ fillOpacity: 1, weight: 3 }))
    circle.on('mouseout', () => circle.setStyle({ fillOpacity: intensidad === 0 ? 0.45 : 0.85, weight: intensidad === 0 ? 1 : 2 }))
    circle.bindTooltip(nombre, { permanent: false, direction: 'top', className: 'mapa-tooltip' })

    // Ondas animadas en municipios con actividad media-alta
    if (intensidad >= 10) {
      const tamOndaPx = intensidad >= 61 ? 38 : intensidad >= 31 ? 30 : 22
      const ondaIcon = L.divIcon({
        html: `<div class="mapa-onda-wrap" style="width:${tamOndaPx * 2}px;height:${tamOndaPx * 2}px">
                 <div class="mapa-onda" style="background:${color};animation-delay:0s"></div>
                 <div class="mapa-onda" style="background:${color};animation-delay:0.6s"></div>
               </div>`,
        className: '',
        iconSize: [tamOndaPx * 2, tamOndaPx * 2],
        iconAnchor: [tamOndaPx, tamOndaPx],
      })
      L.marker(coords, { icon: ondaIcon, interactive: false, zIndexOffset: -100 }).addTo(mapaLeaflet)
    }
  })

    // 6. Marcadores de eventos (círculo pequeño morado encima)
    ; (eventos || []).forEach(ev => {
      const k = normMunicipio(ev.municipio)
      const coords = CENTROIDES_VDC[k]
      if (!coords) return
      const fecha = ev.fecha_evento ? formatFecha(ev.fecha_evento).split(',')[0] : 'Sin fecha'
      L.circleMarker(coords, {
        radius: 6,
        fillColor: '#6366f1',
        fillOpacity: 1,
        color: '#fff',
        weight: 2,
      }).addTo(mapaLeaflet)
        .bindPopup(`<div class="mapa-popup-titulo">${ev.titulo || 'Evento'}</div><div class="mapa-popup-fecha">${fecha} · ${ev.municipio}</div>`)
    })

  // 7. Marcadores de puestos de votación
  const votosPorPuesto = {}
  ;(votantes || []).forEach(v => {
    if (!v.puesto_votacion) return
    const k = normPuesto(v.puesto_votacion)
    votosPorPuesto[k] = (votosPorPuesto[k] || 0) + 1
  })

  Object.entries(PUESTOS_VOTACION_COORDS).forEach(([nombreNorm, coords]) => {
    const votos = votosPorPuesto[normPuesto(nombreNorm)] || 0
    const nombre = nombreNorm.replace(/(^\w|\s\w)/g, c => c.toUpperCase())

    const circle = L.circleMarker(coords, {
      radius: 10,
      fillColor: '#3b82f6',
      fillOpacity: 0.9,
      color: '#fff',
      weight: 2,
      pane: 'markerPane',
    }).addTo(mapaLeaflet)

    circle.bindTooltip(
      `<div class="mapa-puesto-tooltip">
        <strong>${nombre}</strong>
        <span>${votos} voto${votos !== 1 ? 's' : ''} registrado${votos !== 1 ? 's' : ''}</span>
       </div>`,
      { permanent: false, direction: 'top', className: 'mapa-tooltip-puesto', opacity: 1 }
    )
    circle.on('mouseover', function () { this.openTooltip() })
    circle.on('mouseout',  function () { this.closeTooltip() })
  })

  // Recalcular tamaño por si el contenedor estaba oculto al inicializar
  guardarStatsParaBuscador(stats)
  setTimeout(() => mapaLeaflet.invalidateSize(), 150)
}

function mostrarSeleccionMapa(coords, color) {
  if (mapaSeleccion) mapaLeaflet.removeLayer(mapaSeleccion)

  const icon = L.divIcon({
    html: `<div class="mapa-seleccion">
             <div class="mapa-seleccion-onda" style="background:${color};animation-delay:0s"></div>
             <div class="mapa-seleccion-onda" style="background:${color};animation-delay:0.4s"></div>
             <div class="mapa-seleccion-onda" style="background:${color};animation-delay:0.8s"></div>
             <div class="mapa-seleccion-punto" style="background:${color}"></div>
           </div>`,
    className: '',
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  })

  mapaSeleccion = L.marker(coords, { icon, interactive: false, zIndexOffset: 500 })
    .addTo(mapaLeaflet)
}

function mostrarPanelMapa(nombre, s) {
  document.getElementById('mapa-panel-nombre').textContent = nombre

  const r = s.reuniones
  const v = s.votantes
  const e = s.eventos
  const sol = s.solicitudes

  const rApro = r.filter(x => x.estado === 'aprobado').length
  const rPend = r.filter(x => x.estado === 'pendiente').length
  const vApro = v.filter(x => x.estado === 'aprobado').length
  const vPend = v.filter(x => x.estado === 'pendiente').length
  const solPend = sol.filter(x => x.estado === 'pendiente').length

  const eventosHtml = e.length
    ? e.map(ev => `<div class="mapa-evento-item">
        <strong>${ev.titulo || 'Evento'}</strong>
        <span>${ev.fecha_evento ? formatFecha(ev.fecha_evento).split(',')[0] : 'Sin fecha'}</span>
      </div>`).join('')
    : '<p style="font-size:0.8rem;color:var(--texto-muted)">Sin eventos registrados</p>'

  document.getElementById('mapa-panel-contenido').innerHTML = `
    <div class="mapa-panel-seccion">
      <div class="mapa-panel-seccion-titulo">Reuniones</div>
      <div class="mapa-stat"><span class="mapa-stat-label">Total</span><span class="mapa-stat-valor">${r.length}</span></div>
      <div class="mapa-stat"><span class="mapa-stat-label">✓ Aprobadas</span><span class="mapa-stat-valor aprobado">${rApro}</span></div>
      <div class="mapa-stat"><span class="mapa-stat-label">⏳ Pendientes</span><span class="mapa-stat-valor pendiente">${rPend}</span></div>
    </div>
    <div class="mapa-panel-seccion">
      <div class="mapa-panel-seccion-titulo">Votantes</div>
      <div class="mapa-stat"><span class="mapa-stat-label">Total</span><span class="mapa-stat-valor">${v.length}</span></div>
      <div class="mapa-stat"><span class="mapa-stat-label">✓ Aprobados</span><span class="mapa-stat-valor aprobado">${vApro}</span></div>
      <div class="mapa-stat"><span class="mapa-stat-label">⏳ Pendientes</span><span class="mapa-stat-valor pendiente">${vPend}</span></div>
    </div>
    <div class="mapa-panel-seccion">
      <div class="mapa-panel-seccion-titulo">Solicitudes</div>
      <div class="mapa-stat"><span class="mapa-stat-label">Total</span><span class="mapa-stat-valor">${sol.length}</span></div>
      <div class="mapa-stat"><span class="mapa-stat-label">⏳ Pendientes</span><span class="mapa-stat-valor pendiente">${solPend}</span></div>
    </div>
    <div class="mapa-eventos-lista">
      <div class="mapa-eventos-titulo">Eventos (${e.length})</div>
      ${eventosHtml}
    </div>
  `

  document.getElementById('mapa-panel-lateral').classList.add('visible')
}

function cerrarPanelMapa() {
  document.getElementById('mapa-panel-lateral').classList.remove('visible')
}


/* ==============================================
   BUSCADOR DE MUNICIPIOS EN EL MAPA
============================================== */

let _mapaStats = {}          // stats por municipio, guardado al cargar el mapa
let _buscadorIndiceActivo = -1

// Guarda stats para el buscador (llamado al final de cargarMapa)
function guardarStatsParaBuscador(stats) { _mapaStats = stats }

function filtrarMapaBuscador(valor) {
  const lista = document.getElementById('mapa-buscador-lista')
  const limpiar = document.getElementById('mapa-buscador-limpiar')
  limpiar.style.display = valor ? 'block' : 'none'
  _buscadorIndiceActivo = -1

  const q = normMunicipio(valor)

  // Mostrar/ocultar círculos según coincidencia
  mapaCirculos.forEach(({ circle, key, intensidad }) => {
    const coincide = !q || key.includes(q)
    circle.setStyle({
      fillOpacity: coincide ? (intensidad === 0 ? 0.45 : 0.85) : 0,
      opacity: coincide ? 1 : 0,
    })
  })

  if (!valor.trim()) { lista.style.display = 'none'; return }

  const resultados = Object.keys(CENTROIDES_VDC)
    .filter(k => k.includes(q))
    .sort()
    .slice(0, 8)

  if (!resultados.length) { lista.style.display = 'none'; return }

  lista.innerHTML = resultados.map(k => {
    const label = k.replace(/(^|\s)\S/g, l => l.toUpperCase())
    const s = _mapaStats[k]
    const intensidad = s ? s.reuniones.length + s.votantes.length : 0
    const color = colorIntensidad(intensidad)
    return `<li class="mapa-buscador-item" data-key="${k}" onmousedown="seleccionarMunicipioBuscador('${k}')">
      <span class="buscador-dot" style="background:${color};border:1.5px solid ${intensidad ? color : '#94a3b8'}"></span>
      ${label}
    </li>`
  }).join('')
  lista.style.display = 'block'
}

function seleccionarMunicipioBuscador(k) {
  if (!mapaLeaflet) return
  const coords = CENTROIDES_VDC[k]
  if (!coords) return

  const label = k.replace(/(^|\s)\S/g, l => l.toUpperCase())
  const s = _mapaStats[k] || { nombre: label, reuniones: [], votantes: [], eventos: [], solicitudes: [] }

  // Centrar y hacer zoom al municipio
  mapaLeaflet.flyTo(coords, 12, { duration: 1 })

  // Mostrar panel lateral y ripple de selección
  const color = colorIntensidad(s.reuniones.length + s.votantes.length)
  setTimeout(() => {
    mostrarPanelMapa(s.nombre || label, s)
    mostrarSeleccionMapa(coords, color)
  }, 800)

  // Limpiar buscador
  document.getElementById('mapa-buscador').value = label
  document.getElementById('mapa-buscador-lista').style.display = 'none'
  document.getElementById('mapa-buscador-limpiar').style.display = 'block'
}

function navegarBuscador(e) {
  const lista = document.getElementById('mapa-buscador-lista')
  const items = lista.querySelectorAll('.mapa-buscador-item')
  if (!items.length) return

  if (e.key === 'ArrowDown') {
    e.preventDefault()
    _buscadorIndiceActivo = Math.min(_buscadorIndiceActivo + 1, items.length - 1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    _buscadorIndiceActivo = Math.max(_buscadorIndiceActivo - 1, 0)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const activo = lista.querySelector('.mapa-buscador-item.activo')
    if (activo) seleccionarMunicipioBuscador(activo.dataset.key)
    return
  } else if (e.key === 'Escape') {
    lista.style.display = 'none'
    return
  }

  items.forEach((el, i) => el.classList.toggle('activo', i === _buscadorIndiceActivo))
  if (items[_buscadorIndiceActivo]) items[_buscadorIndiceActivo].scrollIntoView({ block: 'nearest' })
}

function limpiarBuscadorMapa() {
  document.getElementById('mapa-buscador').value = ''
  document.getElementById('mapa-buscador-lista').style.display = 'none'
  document.getElementById('mapa-buscador-limpiar').style.display = 'none'
  _buscadorIndiceActivo = -1
  mapaCirculos.forEach(({ circle, intensidad }) => {
    circle.setStyle({ fillOpacity: intensidad === 0 ? 0.45 : 0.85, opacity: 1 })
  })
}


/* ==============================================
   UTILIDADES
============================================== */

function badgeEstado(estado) {
  return `<span class="estado-badge estado-${estado}">${estado}</span>`
}

function mostrarAlerta(el, mensaje, tipo) {
  el.textContent = mensaje
  el.className = `alerta alerta-${tipo}`
  el.style.display = 'block'
  setTimeout(() => { el.style.display = 'none' }, 4000)
}

function hoy() {
  return new Date().toISOString().slice(0, 10)
}

function formatFecha(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}


/* ==============================================
   CARGA MASIVA DESDE EXCEL
============================================== */

// Mapeo de encabezados flexibles → nombre interno
const ALIAS_REUNIONES = {
  nombre: 'nombre_completo', nombre_completo: 'nombre_completo',
  cedula: 'cedula', cédula: 'cedula', documento: 'cedula', cc: 'cedula',
  telefono: 'telefono', teléfono: 'telefono', celular: 'telefono',
  municipio: 'municipio', ciudad: 'municipio',
  fecha_reunion: 'fecha_reunion', fecha: 'fecha_reunion', 'fecha reunión': 'fecha_reunion',
  amigo_referido: 'amigo_referido', referido: 'amigo_referido', referido_por: 'amigo_referido', 'referido por': 'amigo_referido',
}

const ALIAS_VOTANTES = {
  nombre: 'nombre_completo', nombre_completo: 'nombre_completo',
  cedula: 'cedula', cédula: 'cedula', documento: 'cedula', cc: 'cedula',
  'no_cedula': 'cedula', 'no cedula': 'cedula', 'no_cédula': 'cedula', 'no cédula': 'cedula',
  telefono: 'telefono', teléfono: 'telefono', celular: 'telefono',
  municipio: 'municipio', ciudad: 'municipio',
  puesto_votacion: 'puesto_votacion', puesto: 'puesto_votacion',
  'puesto de votacion': 'puesto_votacion', 'puesto de votación': 'puesto_votacion',
  'puesto_de_votacion': 'puesto_votacion', 'puesto_de_votación': 'puesto_votacion',
  mesa: 'mesa', numero_mesa: 'mesa', 'número de mesa': 'mesa',
  amigo_referido: 'amigo_referido', referido: 'amigo_referido', referido_por: 'amigo_referido', 'referido por': 'amigo_referido',
}

const CAMPOS_REUNIONES = ['nombre_completo', 'cedula', 'telefono', 'municipio', 'fecha_reunion', 'amigo_referido']
const CAMPOS_VOTANTES = ['nombre_completo', 'cedula', 'telefono', 'municipio', 'puesto_votacion', 'mesa', 'amigo_referido']

function normalizarClave(str) {
  return String(str).toLowerCase().trim()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '_')
}

function parsearExcel(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array', cellDates: true })
        const ws = wb.Sheets[wb.SheetNames[0]]
        // Detect header row: skip title/LIDER rows, find first row with "NOMBRE" or known field
        const range = XLSX.utils.decode_range(ws['!ref'] || 'A1')
        let headerRow = 0
        for (let r = range.s.r; r <= Math.min(range.s.r + 5, range.e.r); r++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c: 1 })] // column B
          if (cell && /nombre/i.test(String(cell.v))) { headerRow = r; break }
        }
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: headerRow })
        resolve(rows)
      } catch (err) { reject(err) }
    }
    reader.onerror = reject
    reader.readAsArrayBuffer(file)
  })
}

function mapearFilas(rows, alias) {
  return rows.map(row => {
    const mapped = {}
    for (const [k, v] of Object.entries(row)) {
      const norm = normalizarClave(k)
      const campo = alias[norm]
      if (campo) mapped[campo] = v === undefined || v === null ? '' : String(v).trim()
    }
    return mapped
  }).filter(r => r.nombre_completo || r.cedula)
}

function renderPreview(filas, campos, tablaEl, countEl) {
  const headers = campos.map(c => `<th>${c}</th>`).join('')
  const body = filas.slice(0, 5).map(f =>
    `<tr>${campos.map(c => `<td>${f[c] ?? '—'}</td>`).join('')}</tr>`
  ).join('')
  const resto = filas.length > 5 ? `<tr><td colspan="${campos.length}" class="tabla-vacia">… y ${filas.length - 5} registros más</td></tr>` : ''
  tablaEl.innerHTML = `<thead><tr>${headers}</tr></thead><tbody>${body}${resto}</tbody>`
  countEl.textContent = `${filas.length} registro(s) listos para subir`
}

function iniciarExcel({ inputId, zonaId, previewId, tablaId, countId, subirId, cancelarId, alertaId, referidoId, municipioId, modalId, alias, campos, tabla, onExito }) {
  const input = document.getElementById(inputId)
  const zona = document.getElementById(zonaId)
  const preview = document.getElementById(previewId)
  const tablaEl = document.getElementById(tablaId)
  const countEl = document.getElementById(countId)
  const btnSubir = document.getElementById(subirId)
  const btnCancelar = document.getElementById(cancelarId)
  const alertaEl = document.getElementById(alertaId)
  const selectRef = document.getElementById(referidoId)

  let filasListas = []

  async function procesarArchivo(file) {
    try {
      const rows = await parsearExcel(file)
      filasListas = mapearFilas(rows, alias)
      if (!filasListas.length) {
        mostrarAlerta(alertaEl, '⚠️ No se encontraron filas válidas. Verifica que los encabezados coincidan.', 'error')
        preview.style.display = 'none'
        return
      }
      renderPreview(filasListas, campos, tablaEl, countEl)
      preview.style.display = 'block'
      alertaEl.style.display = 'none'
    } catch {
      mostrarAlerta(alertaEl, '❌ No se pudo leer el archivo. Asegúrate de que sea .xlsx, .xls o .csv.', 'error')
      preview.style.display = 'none'
    }
  }

  zona.addEventListener('click', e => { if (e.target === zona) input.click() })
  input.addEventListener('change', e => { if (e.target.files[0]) procesarArchivo(e.target.files[0]) })

  zona.addEventListener('dragover', e => { e.preventDefault(); zona.classList.add('drag-over') })
  zona.addEventListener('dragleave', () => zona.classList.remove('drag-over'))
  zona.addEventListener('drop', e => {
    e.preventDefault()
    zona.classList.remove('drag-over')
    if (e.dataTransfer.files[0]) procesarArchivo(e.dataTransfer.files[0])
  })

  function limpiar() {
    filasListas = []
    preview.style.display = 'none'
    input.value = ''
    alertaEl.style.display = 'none'
  }

  btnCancelar.addEventListener('click', limpiar)

  btnSubir.addEventListener('click', async () => {
    if (!filasListas.length) return

    const referido = selectRef?.value?.trim()
    if (!referido) {
      mostrarAlerta(alertaEl, '⚠️ Debes seleccionar el "Referido por" antes de subir.', 'error')
      return
    }

    const selectMun = municipioId ? document.getElementById(municipioId) : null
    const municipio = selectMun?.value?.trim() || null
    if (selectMun && !municipio) {
      mostrarAlerta(alertaEl, '⚠️ Debes seleccionar el municipio antes de subir.', 'error')
      return
    }

    btnSubir.disabled = true
    btnSubir.textContent = 'Subiendo...'
    alertaEl.style.display = 'none'

    const registros = filasListas.map(f => ({
      ...f,
      amigo_referido: referido,
      ...(municipio && { municipio }),
      subido_por: usuarioActual.id,
      estado: 'pendiente',
    }))

    const LOTE = 100
    let errores = 0
    let mensajeError = ''

    try {
      for (let i = 0; i < registros.length; i += LOTE) {
        const lote = registros.slice(i, i + LOTE)
        const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))
        const insertar = db.from(tabla).insert(lote)
        const { error } = await Promise.race([insertar, timeout])
        if (error) {
          errores++
          mensajeError = error.message
        }
      }
    } catch (e) {
      btnSubir.disabled = false
      btnSubir.textContent = 'Subir todos los registros'
      mostrarAlerta(alertaEl, `❌ Tiempo agotado o error de red: ${e.message}. Revisa la consola y los permisos de Supabase.`, 'error')
      return
    }

    if (errores) {
      mostrarAlerta(alertaEl, `⚠️ ${errores} lote(s) fallaron. Error: ${mensajeError}`, 'error')
    } else {
      mostrarAlerta(alertaEl, `✅ ${registros.length} registro(s) subidos correctamente.`, 'exito')
      limpiar()
      if (modalId) setTimeout(() => { document.getElementById(modalId).style.display = 'none' }, 1500)
      await onExito()
    }

    btnSubir.disabled = false
    btnSubir.textContent = 'Subir todos los registros'
  })
}

function initExcelReuniones() {
  iniciarExcel({
    inputId: 'excel-reuniones', zonaId: 'excel-zona-reuniones',
    previewId: 'excel-preview-reuniones', tablaId: 'excel-tabla-reuniones',
    countId: 'excel-count-reuniones', subirId: 'btn-subir-reuniones',
    cancelarId: 'btn-cancelar-reuniones', alertaId: 'excel-alerta-reuniones',
    referidoId: 'modal-referido-reuniones', modalId: 'modal-excel-reuniones',
    alias: ALIAS_REUNIONES, campos: CAMPOS_REUNIONES,
    tabla: 'lista_reuniones', onExito: cargarReuniones,
  })
}

function initExcelVotantes() {
  iniciarExcel({
    inputId: 'excel-votantes', zonaId: 'excel-zona-votantes',
    previewId: 'excel-preview-votantes', tablaId: 'excel-tabla-votantes',
    countId: 'excel-count-votantes', subirId: 'btn-subir-votantes',
    cancelarId: 'btn-cancelar-votantes', alertaId: 'excel-alerta-votantes',
    referidoId: 'modal-referido-votantes', municipioId: 'modal-municipio-votantes', modalId: 'modal-excel-votantes',
    alias: ALIAS_VOTANTES, campos: CAMPOS_VOTANTES,
    tabla: 'lista_votantes', onExito: cargarVotantes,
  })
}

function descargarFormatoVotantes() {
  const wb = XLSX.utils.book_new()
  const filas = [
    ['ORG. SOCIAL IMPULSO CIUDADANO', '', '', '', '', ''],
    ['LIDER:', '', '', '', '', ''],
    ['No', 'NOMBRE', 'No CEDULA', 'TELEFONO', 'PUESTO DE VOTACION', 'MESA'],
    ...Array.from({ length: 50 }, (_, i) => [i + 1, '', '', '', '', '']),
  ]
  const ws = XLSX.utils.aoa_to_sheet(filas)
  ws['!cols'] = [{ wch: 5 }, { wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 32 }, { wch: 8 }]
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }]
  XLSX.utils.book_append_sheet(wb, ws, 'Votantes')
  XLSX.writeFile(wb, 'formato_votantes.xlsx')
}
