const SUPABASE_URL  = 'https://qmoztpqycrlljonobxqm.supabase.co'
const SUPABASE_ANON = 'sb_publishable_lnbeC0MylQnGVt6Jn_d87Q_hbRwMyJD'

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON)

let _eventosDisponibles = []

// ── Ventana de tiempo válida para un evento ──
function eventoActivo(ev) {
  if (!ev.fecha || !ev.hora_inicio || !ev.hora_cierre) return false
  const ahora = new Date()
  const inicio  = new Date(`${ev.fecha}T${ev.hora_inicio}`)
  const cierre  = new Date(`${ev.fecha}T${ev.hora_cierre}`)
  const desde   = new Date(inicio.getTime() - 60 * 60 * 1000)       // 1h antes
  const hasta   = new Date(cierre.getTime() + 2 * 60 * 60 * 1000)   // 2h después
  return ahora >= desde && ahora <= hasta
}

function mostrarAlerta(msg, tipo) {
  const el = document.getElementById('registro-alerta')
  el.textContent = msg
  el.className = `alerta ${tipo}`
  el.style.display = 'block'
}

function ocultarAlerta() {
  document.getElementById('registro-alerta').style.display = 'none'
}

async function cargarEventos() {
  const { data, error } = await db
    .from('eventos')
    .select('*')
    .order('fecha', { ascending: true })

  document.getElementById('estado-cargando').style.display = 'none'

  if (error || !data?.length) {
    document.getElementById('estado-sin-eventos').style.display = 'flex'
    return
  }

  _eventosDisponibles = data.filter(eventoActivo)

  if (!_eventosDisponibles.length) {
    document.getElementById('estado-sin-eventos').style.display = 'flex'
    return
  }

  // Poblar selector de eventos
  const sel = document.getElementById('select-evento')
  _eventosDisponibles.forEach(ev => {
    const opt = document.createElement('option')
    opt.value = ev.id
    const fecha = new Date(ev.fecha + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'long' })
    opt.textContent = `${ev.nombre_evento} — ${ev.municipio} (${fecha})`
    sel.appendChild(opt)
  })

  document.getElementById('form-registro').style.display = 'block'
}

function onEventoSeleccionado() {
  const sel     = document.getElementById('select-evento')
  const seccion = document.getElementById('seccion-datos')
  const btnReg  = document.getElementById('btn-registrar')
  const selRef  = document.getElementById('select-referido-asistencia')

  const eventoId = sel.value
  if (!eventoId) {
    seccion.style.display = 'none'
    btnReg.style.display = 'none'
    return
  }

  const ev = _eventosDisponibles.find(e => e.id === eventoId)
  if (!ev) return

  // Poblar referidos con los responsables del evento
  const responsables = Array.isArray(ev.responsables) ? ev.responsables : []
  selRef.innerHTML = '<option value="">— Selecciona un organizador —</option>' +
    responsables.map(r => `<option value="${r}">${r}</option>`).join('')

  seccion.style.display = 'flex'
  btnReg.style.display = 'block'
  ocultarAlerta()
}

async function onSubmit(e) {
  e.preventDefault()
  const form = e.target
  const btn  = document.getElementById('btn-registrar')

  const eventoId      = form.evento_id.value
  const nombreCompleto = form.nombre_completo.value.trim()
  const cedula        = form.cedula.value.trim()
  const telefono      = form.telefono.value.trim() || null
  const referido      = form.referido.value

  if (!eventoId || !nombreCompleto || !cedula || !referido) {
    mostrarAlerta('⚠️ Por favor completa todos los campos obligatorios.', 'error')
    return
  }

  btn.disabled = true
  btn.textContent = 'Registrando…'
  ocultarAlerta()

  const { error } = await db.from('asistentes_evento').insert([{
    evento_id:       eventoId,
    nombre_completo: nombreCompleto,
    cedula:          cedula,
    telefono:        telefono,
    referido:        referido,
  }])

  if (error) {
    mostrarAlerta('❌ Error al registrar: ' + error.message, 'error')
    btn.disabled = false
    btn.textContent = 'Registrar asistencia'
    return
  }

  // Éxito
  document.getElementById('form-registro').style.display = 'none'
  document.getElementById('exito-nombre').textContent = `Bienvenido/a, ${nombreCompleto}.`
  document.getElementById('estado-exito').style.display = 'flex'
}

function reiniciarFormulario() {
  document.getElementById('estado-exito').style.display = 'none'
  document.getElementById('form-registro').style.display = 'block'
  document.getElementById('form-registro').reset()
  document.getElementById('seccion-datos').style.display = 'none'
  document.getElementById('btn-registrar').style.display = 'none'
  document.getElementById('btn-registrar').disabled = false
  document.getElementById('btn-registrar').textContent = 'Registrar asistencia'
  ocultarAlerta()
}

// ── Arranque ──
document.addEventListener('DOMContentLoaded', () => {
  cargarEventos()
  document.getElementById('select-evento').addEventListener('change', onEventoSeleccionado)
  document.getElementById('form-registro').addEventListener('submit', onSubmit)
  document.getElementById('btn-otro-registro').addEventListener('click', reiniciarFormulario)
})
