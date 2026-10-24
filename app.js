// =====================================================================
//  APP: navegación, pantallas y conexión entre interfaz y datos
// =====================================================================
import { configurado } from './supabase-client.js';
import { validarCredenciales, iniciarSesion, cerrarSesion, obtenerMiembro, alCerrarSesion } from './auth.js';
import * as docs from './documents.js';
import { MAX_FILE_MB } from './config.js';

const $ = (sel) => document.querySelector(sel);

const estado = {
  miembro: null,
  perfiles: new Map(),   // id -> nombre visible
  categorias: [],
  consulta: 0            // evita mostrar resultados de búsquedas antiguas
};

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
const fmtFecha = new Intl.DateTimeFormat('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' });

function fechaCarga(iso) { return fmtFecha.format(new Date(iso)); }
function fechaClase(yyyyMmDd) {
  const [a, m, d] = yyyyMmDd.split('-').map(Number);
  return fmtFecha.format(new Date(a, m - 1, d)); // fecha local, sin desfase horario
}
function hoyISO() {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-${String(h.getDate()).padStart(2, '0')}`;
}
function iniciales(nombre) {
  return nombre.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');
}
function tamano(bytes) {
  return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1).replace('.', ',')} MB`;
}
function nombreAutor(id) { return estado.perfiles.get(id) || 'Integrante'; }

function aviso(texto, tipo = 'info') {
  const el = document.createElement('div');
  el.className = `aviso aviso-${tipo}`;
  el.textContent = texto;
  $('#avisos').append(el);
  setTimeout(() => el.remove(), tipo === 'error' ? 6000 : 3500);
}

function mostrarEstado(contenedor, titulo, texto = '', conSpinner = false) {
  contenedor.replaceChildren();
  const div = document.createElement('div');
  div.className = 'estado';
  if (conSpinner) {
    const s = document.createElement('span');
    s.className = 'spinner';
    div.append(s);
  }
  const t = document.createElement('strong');
  t.textContent = titulo;
  div.append(t);
  if (texto) div.append(texto);
  contenedor.append(div);
}

function mostrarEsqueletos(contenedor, cantidad) {
  contenedor.replaceChildren(...Array.from({ length: cantidad }, () => {
    const d = document.createElement('div');
    d.className = 'esqueleto';
    return d;
  }));
}

// ---------------------------------------------------------------------
// Acceso
// ---------------------------------------------------------------------
function mostrarLogin() {
  estado.miembro = null;
  $('#pantalla-carga').hidden = true;
  $('#app').hidden = true;
  $('#vista-login').hidden = false;
  cerrarDialogos();
  $('#login-password').value = '';
  if (!configurado) {
    $('#aviso-config').hidden = false;
    $('#login-boton').disabled = true;
  }
}

async function entrarApp(miembro) {
  estado.miembro = miembro;
  $('#usuario-nombre').textContent = miembro.nombre;
  $('#usuario-iniciales').textContent = iniciales(miembro.nombre);
  $('#saludo-nombre').textContent = miembro.nombre.split(/\s+/)[0];

  await cargarCatalogos();

  $('#vista-login').hidden = true;
  $('#pantalla-carga').hidden = true;
  $('#app').hidden = false;
  if (!location.hash) history.replaceState(null, '', '#/inicio');
  enrutar();
}

async function cargarCatalogos() {
  try {
    const [perfiles, categorias] = await Promise.all([docs.cargarPerfiles(), docs.cargarCategorias()]);
    estado.perfiles = new Map(perfiles.map(p => [p.id, p.display_name]));
    estado.categorias = categorias;
  } catch {
    aviso('No se pudieron cargar las listas de integrantes y asignaturas.', 'error');
  }
  llenarSelect($('#f-autor'), [...estado.perfiles].map(([id, n]) => [id, n]), 'Todos los integrantes');
  llenarSelect($('#f-categoria'), estado.categorias.map(c => [c, c]), 'Todas las asignaturas');
  llenarSelect($('#s-categoria'), estado.categorias.map(c => [c, c]), 'Selecciona…');
}

function llenarSelect(select, opciones, primera) {
  const actual = select.value;
  const ops = [new Option(primera, ''), ...opciones.map(([v, t]) => new Option(t, v))];
  select.replaceChildren(...ops);
  if (opciones.some(([v]) => v === actual)) select.value = actual;
}

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('#login-email');
  const pass = $('#login-password');
  const error = $('#login-error');
  const boton = $('#login-boton');

  error.hidden = true;
  [email, pass].forEach(i => i.removeAttribute('aria-invalid'));

  const correo = email.value.trim().toLowerCase();
  const fallo = validarCredenciales(correo, pass.value);
  if (fallo) {
    const campo = fallo.campo === 'email' ? email : pass;
    campo.setAttribute('aria-invalid', 'true');
    campo.focus();
    error.textContent = fallo.mensaje;
    error.hidden = false;
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Verificando…';
  try {
    const miembro = await iniciarSesion(correo, pass.value);
    pass.value = '';
    await entrarApp(miembro);
  } catch (err) {
    pass.value = '';
    error.textContent = err.message;
    error.hidden = false;
  } finally {
    boton.disabled = false;
    boton.textContent = 'Entrar';
  }
});

$('#ver-clave').addEventListener('click', (e) => {
  const input = $('#login-password');
  const mostrar = input.type === 'password';
  input.type = mostrar ? 'text' : 'password';
  e.currentTarget.textContent = mostrar ? 'Ocultar' : 'Mostrar';
  e.currentTarget.setAttribute('aria-pressed', String(mostrar));
});

$('#btn-salir').addEventListener('click', async () => {
  await cerrarSesion();
  history.replaceState(null, '', location.pathname);
  mostrarLogin();
});

// ---------------------------------------------------------------------
// Navegación (#/inicio, #/biblioteca, #/subir)
// ---------------------------------------------------------------------
const RUTAS = { inicio: cargarInicio, biblioteca: cargarBiblioteca, subir: prepararSubida };

function enrutar() {
  if (!estado.miembro) return;
  let ruta = location.hash.replace(/^#\//, '');
  if (!RUTAS[ruta]) { ruta = 'inicio'; history.replaceState(null, '', '#/inicio'); }

  document.querySelectorAll('[data-vista]').forEach(v => { v.hidden = v.dataset.vista !== ruta; });
  document.querySelectorAll('[data-ruta]').forEach(a => {
    if (a.dataset.ruta === ruta) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
  RUTAS[ruta]();
}
window.addEventListener('hashchange', enrutar);

function rutaActual() { return location.hash.replace(/^#\//, '') || 'inicio'; }

// ---------------------------------------------------------------------
// Tarjetas de documento
// ---------------------------------------------------------------------
const TIPOS = {
  'application/pdf': ['PDF', 'tipo-pdf'],
  'application/msword': ['DOC', 'tipo-word'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['DOCX', 'tipo-word'],
  'image/jpeg': ['JPG', 'tipo-img'],
  'image/png': ['PNG', 'tipo-img']
};

function crearTarjeta(doc) {
  const nodo = $('#tpl-tarjeta').content.firstElementChild.cloneNode(true);
  const [etiqueta, clase] = TIPOS[doc.mime_type] || ['DOC', 'tipo-word'];

  const tipo = nodo.querySelector('.tarjeta-tipo');
  tipo.textContent = etiqueta;
  tipo.classList.add(clase);

  nodo.querySelector('.chip').textContent = doc.category;
  nodo.querySelector('.tarjeta-titulo').textContent = doc.title;

  const desc = nodo.querySelector('.tarjeta-desc');
  if (doc.description) desc.textContent = doc.description; else desc.remove();

  const meta = [`${nombreAutor(doc.owner_id)}`, `Subido el ${fechaCarga(doc.created_at)}`];
  if (doc.class_date) meta.push(`Clase del ${fechaClase(doc.class_date)}`);
  nodo.querySelector('.tarjeta-meta').textContent = meta.join(' · ');

  const ver = nodo.querySelector('.accion-ver');
  if (docs.esVisualizable(doc)) ver.addEventListener('click', () => abrirVisor(doc));
  else ver.remove();

  nodo.querySelector('.accion-descargar').addEventListener('click', (e) => descargar(doc, e.currentTarget));

  const borrar = nodo.querySelector('.accion-eliminar');
  if (doc.owner_id === estado.miembro.id) borrar.addEventListener('click', () => confirmarEliminar(doc));
  else borrar.remove(); // la seguridad real está en RLS; esto solo evita confusión

  return nodo;
}

// ---------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------
async function cargarInicio() {
  const lista = $('#ultimos');
  mostrarEsqueletos(lista, 3);
  try {
    const [stats, recientes] = await Promise.all([
      docs.estadisticas(estado.miembro.id),
      docs.ultimos(5)
    ]);
    $('#stat-total').textContent = stats.total.toLocaleString('es-CL');
    $('#stat-propios').textContent = stats.propios.toLocaleString('es-CL');
    if (recientes.length === 0) {
      mostrarEstado(lista, 'La biblioteca está vacía', 'Sube el primer apunte del grupo.');
    } else {
      lista.replaceChildren(...recientes.map(crearTarjeta));
    }
  } catch {
    $('#stat-total').textContent = '–';
    $('#stat-propios').textContent = '–';
    mostrarEstado(lista, 'No se pudo cargar el inicio', 'Revisa tu conexión y recarga la página.');
  }
}

// ---------------------------------------------------------------------
// Biblioteca
// ---------------------------------------------------------------------
async function cargarBiblioteca() {
  const n = ++estado.consulta;
  const cont = $('#resultados');
  const resumen = $('#resumen-resultados');
  mostrarEsqueletos(cont, 4);
  resumen.textContent = 'Buscando…';

  const filtros = {
    texto: $('#f-texto').value,
    autor: $('#f-autor').value,
    categoria: $('#f-categoria').value,
    ascendente: $('#f-orden').value === 'asc'
  };

  try {
    const lista = await docs.buscar(filtros);
    if (n !== estado.consulta) return; // llegó una búsqueda más nueva
    const hayFiltros = filtros.texto.trim() || filtros.autor || filtros.categoria;
    if (lista.length === 0) {
      resumen.textContent = '';
      if (hayFiltros) mostrarEstado(cont, 'Sin resultados', 'Prueba con otras palabras o quita algún filtro.');
      else mostrarEstado(cont, 'Aún no hay apuntes', 'Cuando alguien suba uno, aparecerá aquí.');
      return;
    }
    resumen.textContent = lista.length === 1 ? '1 documento' : `${lista.length} documentos`;
    cont.replaceChildren(...lista.map(crearTarjeta));
  } catch {
    if (n !== estado.consulta) return;
    resumen.textContent = '';
    mostrarEstado(cont, 'No se pudo cargar la biblioteca', 'Revisa tu conexión e inténtalo de nuevo.');
  }
}

let espera;
$('#f-texto').addEventListener('input', () => {
  clearTimeout(espera);
  espera = setTimeout(cargarBiblioteca, 300);
});
['#f-autor', '#f-categoria', '#f-orden'].forEach(s => $(s).addEventListener('change', cargarBiblioteca));

// ---------------------------------------------------------------------
// Subir
// ---------------------------------------------------------------------
const zona = $('#zona-archivo');
const inputArchivo = $('#s-archivo');
let archivoValido = null;

function prepararSubida() {
  $('#s-fecha').max = hoyISO();
  $('#zona-ayuda').textContent = `PDF, DOCX, DOC, JPG o PNG · máximo ${MAX_FILE_MB} MB`;
  if (estado.categorias.length === 0) {
    mensajeSubida('Aún no hay asignaturas configuradas. Pide que se agreguen en Supabase.', 'error');
  }
}

async function elegirArchivo(file) {
  archivoValido = null;
  zona.classList.remove('con-archivo', 'con-error');
  $('#subir-mensaje').hidden = true;
  if (!file) { $('#zona-texto').innerHTML = '<strong>Elige un archivo</strong> o arrástralo aquí'; return; }

  try {
    await docs.validarArchivo(file);
    archivoValido = file;
    zona.classList.add('con-archivo');
    $('#zona-texto').textContent = `${file.name} · ${tamano(file.size)}`;
    // Sugerir título a partir del nombre si está vacío
    const titulo = $('#s-titulo');
    if (!titulo.value.trim()) titulo.value = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 150);
  } catch (err) {
    zona.classList.add('con-error');
    $('#zona-texto').textContent = err.message;
    inputArchivo.value = '';
  }
}

inputArchivo.addEventListener('change', () => elegirArchivo(inputArchivo.files[0]));
['dragenter', 'dragover'].forEach(ev => zona.addEventListener(ev, (e) => { e.preventDefault(); zona.classList.add('arrastrando'); }));
['dragleave', 'drop'].forEach(ev => zona.addEventListener(ev, () => zona.classList.remove('arrastrando')));
zona.addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (file) elegirArchivo(file);
});

function mensajeSubida(texto, tipo) {
  const m = $('#subir-mensaje');
  m.className = `alerta alerta-${tipo}`;
  m.textContent = texto;
  m.hidden = false;
}

$('#form-subir').addEventListener('submit', async (e) => {
  e.preventDefault();
  const titulo = $('#s-titulo');
  const categoria = $('#s-categoria');
  const fecha = $('#s-fecha');
  [titulo, categoria, fecha].forEach(c => c.removeAttribute('aria-invalid'));

  const errores = [];
  if (!archivoValido) { errores.push('Selecciona un archivo válido.'); zona.classList.add('con-error'); }
  if (!titulo.value.trim()) { errores.push('Escribe un título.'); titulo.setAttribute('aria-invalid', 'true'); }
  if (!categoria.value) { errores.push('Elige una asignatura o tema.'); categoria.setAttribute('aria-invalid', 'true'); }
  if (fecha.value && fecha.value > hoyISO()) { errores.push('La fecha de clase no puede ser futura.'); fecha.setAttribute('aria-invalid', 'true'); }
  if (errores.length) { mensajeSubida(errores.join(' '), 'error'); return; }

  const boton = $('#subir-boton');
  boton.disabled = true;
  boton.lastChild.textContent = 'Subiendo…';
  mensajeSubida('Subiendo el archivo, no cierres esta página…', 'info');

  try {
    const doc = await docs.subir({
      file: archivoValido,
      titulo: titulo.value,
      descripcion: $('#s-descripcion').value,
      categoria: categoria.value,
      fechaClase: fecha.value
    }, estado.miembro.id);

    e.target.reset();
    await elegirArchivo(null);
    mensajeSubida(`Listo: «${doc.title}» ya está disponible en la biblioteca.`, 'exito');
    aviso('Apunte subido correctamente.', 'exito');
  } catch (err) {
    mensajeSubida(err.message, 'error');
  } finally {
    boton.disabled = false;
    boton.lastChild.textContent = 'Subir apunte';
  }
});

// ---------------------------------------------------------------------
// Ver y descargar
// ---------------------------------------------------------------------
const visor = $('#visor');
let docEnVisor = null;

async function abrirVisor(doc) {
  docEnVisor = doc;
  const cuerpo = $('#visor-cuerpo');
  const externo = $('#visor-externo');
  $('#visor-titulo').textContent = doc.title;
  externo.hidden = true;
  mostrarEstado(cuerpo, 'Abriendo documento…', '', true);
  visor.showModal();

  try {
    const url = await docs.enlaceTemporal(doc);
    if (docEnVisor !== doc || !visor.open) return;
    let el;
    if (doc.mime_type === 'application/pdf') {
      el = document.createElement('iframe');
      el.title = doc.title;
    } else {
      el = document.createElement('img');
      el.alt = doc.title;
      el.addEventListener('error', () => mostrarEstado(cuerpo, 'No se pudo mostrar la imagen', 'Prueba descargándola.'));
    }
    el.src = url;
    cuerpo.replaceChildren(el);
    externo.href = url;   // en celulares el PDF suele verse mejor en otra pestaña
    externo.hidden = false;
  } catch (err) {
    mostrarEstado(cuerpo, 'No se pudo abrir', err.message);
  }
}

function cerrarVisor() {
  if (visor.open) visor.close();
}
visor.addEventListener('close', () => {
  docEnVisor = null;
  $('#visor-cuerpo').replaceChildren();   // descarta el enlace temporal
  $('#visor-externo').removeAttribute('href');
});
$('#visor-cerrar').addEventListener('click', cerrarVisor);
$('#visor-descargar').addEventListener('click', (e) => docEnVisor && descargar(docEnVisor, e.currentTarget));

async function descargar(doc, boton) {
  boton.disabled = true;
  try {
    const url = await docs.enlaceTemporal(doc, { descargar: true });
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    document.body.append(a);
    a.click();
    a.remove();
  } catch (err) {
    aviso(err.message, 'error');
  } finally {
    boton.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------
const dlgConfirmar = $('#confirmar');
let docAEliminar = null;

function confirmarEliminar(doc) {
  docAEliminar = doc;
  $('#confirmar-nombre').textContent = `«${doc.title}»`;
  dlgConfirmar.showModal();
  $('#confirmar-no').focus();
}
$('#confirmar-no').addEventListener('click', () => dlgConfirmar.close());
$('#confirmar-si').addEventListener('click', async (e) => {
  const boton = e.currentTarget;
  const doc = docAEliminar;
  if (!doc) return;
  boton.disabled = true;
  boton.textContent = 'Eliminando…';
  try {
    const { archivoPendiente } = await docs.eliminar(doc);
    dlgConfirmar.close();
    aviso(archivoPendiente
      ? 'Apunte eliminado. El archivo quedó pendiente de limpieza.'
      : 'Apunte eliminado.', 'exito');
    RUTAS[rutaActual()]?.();   // refresca la vista actual
  } catch (err) {
    dlgConfirmar.close();
    aviso(err.message, 'error');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Eliminar';
    docAEliminar = null;
  }
});

function cerrarDialogos() {
  if (visor.open) visor.close();
  if (dlgConfirmar.open) dlgConfirmar.close();
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
alCerrarSesion(() => { if (estado.miembro) mostrarLogin(); });

(async function iniciar() {
  if (!configurado) { mostrarLogin(); return; }
  try {
    const miembro = await obtenerMiembro();
    if (miembro) await entrarApp(miembro);
    else { await cerrarSesion().catch(() => {}); mostrarLogin(); }
  } catch {
    mostrarLogin();
  }
})();
