/* ==============================================
   CONFIGURACIÓN DE SUPABASE
   Reemplaza los valores con los de tu proyecto
============================================== */
const SUPABASE_URL  = 'https://qmoztpqycrlljonobxqm.supabase.co'
const SUPABASE_ANON = 'sb_publishable_lnbeC0MylQnGVt6Jn_d87Q_hbRwMyJD'

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON)


/* ==============================================
   ESTADO GLOBAL DE LA APP
============================================== */
let usuarioActual = null   // datos de auth.users
let perfilActual = null   // datos de la tabla usuarios
let tabActiva = {}     // pestaña activa por sección
let datosReuniones = []     // caché de reuniones (consolidados)
let datosVotantes = []     // caché de votantes (consolidados)


/* ==============================================
   ARRANQUE: cuando carga la página
============================================== */
document.addEventListener('DOMContentLoaded', async () => {
  iniciarNavegacion()
  iniciarMenuMovil()
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
  }
}


/* ==============================================
   MENÚ MÓVIL
============================================== */

function iniciarMenuMovil() {
  document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('abierto')
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

async function cargarDashboard() {
  const esAdmin = ['owner', 'admin'].includes(perfilActual?.rol)

  // Obtener reuniones y votantes
  let qR = db.from('lista_reuniones').select('estado')
  let qV = db.from('lista_votantes').select('estado')

  if (!esAdmin) {
    qR = qR.eq('subido_por', usuarioActual.id)
    qV = qV.eq('subido_por', usuarioActual.id)
  }

  const [{ data: reuniones, error: errR }, { data: votantes, error: errV }] = await Promise.all([qR, qV])

  if (errR || errV) {
    console.error('Error cargando dashboard:', errR || errV)
    return
  }

  const r = reuniones || []
  const v = votantes || []

  const rApro = r.filter(x => x.estado === 'aprobado').length
  const rPend = r.filter(x => x.estado === 'pendiente').length
  const rRech = r.filter(x => x.estado === 'rechazado').length
  const vApro = v.filter(x => x.estado === 'aprobado').length
  const vPend = v.filter(x => x.estado === 'pendiente').length
  const vRech = v.filter(x => x.estado === 'rechazado').length

  // KPIs
  document.getElementById('kpi-total').textContent = r.length + v.length
  document.getElementById('kpi-aprobados').textContent = rApro + vApro
  document.getElementById('kpi-pendientes').textContent = rPend + vPend
  document.getElementById('kpi-rechazados').textContent = rRech + vRech

  // Desglose reuniones
  document.getElementById('dash-total-r').textContent = `${r.length} total`
  document.getElementById('dash-barras-r').innerHTML = htmlBarras(rApro, rPend, rRech, r.length)

  // Desglose votantes
  document.getElementById('dash-total-v').textContent = `${v.length} total`
  document.getElementById('dash-barras-v').innerHTML = htmlBarras(vApro, vPend, vRech, v.length)
}

function htmlBarras(apro, pend, rech, total) {
  const items = [
    { label: 'Aprobados', valor: apro, color: '#16a34a' },
    { label: 'Pendientes', valor: pend, color: '#f59e0b' },
    { label: 'Rechazados', valor: rech, color: '#dc2626' },
  ]

  return items.map(({ label, valor, color }) => {
    const pct = total > 0 ? Math.round((valor / total) * 100) : 0
    return `
      <div class="barra-item">
        <div class="barra-fila">
          <span style="color:var(--texto-sec);font-weight:500">${label}</span>
          <span style="font-weight:700;color:${color}">${valor} <span style="color:var(--texto-muted);font-weight:400">(${pct}%)</span></span>
        </div>
        <div class="barra-fondo">
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

async function cargarVotantes() {
  const { data, error } = await db
    .from('lista_votantes')
    .select('*')
    .eq('subido_por', usuarioActual.id)
    .order('created_at', { ascending: false })

  const tbody = document.getElementById('tabla-votantes-body')

  if (error || !data?.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="tabla-vacia">Sin registros aún.</td></tr>'
    return
  }

  tbody.innerHTML = data.map(v => `
    <tr>
      <td>${v.nombre_completo}</td>
      <td>${v.cedula}</td>
      <td>${v.municipio}</td>
      <td>${v.puesto_votacion}</td>
      <td>${v.mesa}</td>
      <td>${v.amigo_referido}</td>
      <td>${badgeEstado(v.estado)}</td>
    </tr>
  `).join('')
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

async function cargarConsolidado() {
  const [{ data: r, error: errR }, { data: v, error: errV }] = await Promise.all([
    db.from('lista_reuniones').select('*').order('created_at', { ascending: false }),
    db.from('lista_votantes').select('*').order('created_at', { ascending: false }),
  ])

  if (errR || errV) {
    console.error('Error cargando consolidado:', errR || errV)
    return
  }

  datosReuniones = r || []
  datosVotantes = v || []
  renderConsolidado()
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
  const revision  = items.filter(x => x.estado === 'revision').length
  const resuelto  = items.filter(x => x.estado === 'resuelto').length

  document.getElementById('sol-kpi-pendiente').textContent = pendiente
  document.getElementById('sol-kpi-revision').textContent  = revision
  document.getElementById('sol-kpi-resuelto').textContent  = resuelto

  renderSolicitudes(items)

  // Filtros
  const filtroEstado = document.getElementById('sol-filtro-estado')
  const filtroTexto  = document.getElementById('sol-filtro-texto')
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
    .order('created_at', { ascending: false })

  const tbody = document.getElementById('tabla-usuarios-body')

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6" class="tabla-vacia" style="color:var(--rojo)">Error: ${error.message}</td></tr>`
    return
  }

  const items = data || []

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
      email:           form.email.value,
      password:        form.password.value,
      nombre_completo: form.nombre_completo.value,
      rol:             form.rol.value,
      municipio:       form.municipio.value || null,
      telefono:        form.telefono.value || null,
      creado_por:      usuarioActual.id,
    }),
  })

  const resultado = await res.json()

  if (!res.ok) {
    mostrarAlerta(alertaEl, `❌ ${resultado.error || 'Error al crear usuario'}`, 'error')
  } else {
    mostrarAlerta(alertaEl, '✅ Usuario creado correctamente.', 'exito')
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
