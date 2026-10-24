// =====================================================================
//  DOCUMENTOS: carga, consulta, visualización, descarga y eliminación
//  Este archivo no toca la interfaz: solo habla con Supabase.
// =====================================================================
import { supabase } from './supabase-client.js';
import { BUCKET, MAX_FILE_MB, SIGNED_URL_SECONDS, ALLOWED_TYPES } from './config.js';

const MAX_BYTES = MAX_FILE_MB * 1024 * 1024;

// Firmas binarias: los primeros bytes reales de cada formato.
// Evita que un archivo peligroso se suba solo cambiándole la extensión.
const FIRMAS = {
  pdf:  (b) => buscarTexto(b, '%PDF'),
  png:  (b) => empieza(b, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  jpg:  (b) => empieza(b, [0xFF, 0xD8, 0xFF]),
  jpeg: (b) => empieza(b, [0xFF, 0xD8, 0xFF]),
  docx: (b) => empieza(b, [0x50, 0x4B, 0x03, 0x04]),
  doc:  (b) => empieza(b, [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1])
};

function empieza(bytes, firma) {
  return firma.every((v, i) => bytes[i] === v);
}
function buscarTexto(bytes, texto) {
  const cod = [...texto].map(c => c.charCodeAt(0));
  for (let i = 0; i + cod.length <= Math.min(bytes.length, 1024); i++) {
    if (cod.every((v, j) => bytes[i + j] === v)) return true;
  }
  return false;
}

export function extensionDe(nombre) {
  const partes = String(nombre).toLowerCase().split('.');
  return partes.length > 1 ? partes.pop() : '';
}

export function esVisualizable(doc) {
  return doc.mime_type === 'application/pdf' || doc.mime_type.startsWith('image/');
}

// Valida tipo, tamaño y contenido real. Devuelve { ext, mime } o lanza Error.
export async function validarArchivo(file) {
  if (!file) throw new Error('Selecciona un archivo.');
  const ext = extensionDe(file.name);
  const mime = ALLOWED_TYPES[ext];
  if (!mime) throw new Error('Formato no admitido. Usa PDF, DOCX, DOC, JPG o PNG.');
  if (file.size === 0) throw new Error('El archivo está vacío.');
  if (file.size > MAX_BYTES) throw new Error(`El archivo supera el máximo de ${MAX_FILE_MB} MB.`);

  const cabecera = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (!FIRMAS[ext](cabecera)) {
    throw new Error('El contenido del archivo no corresponde a su extensión.');
  }
  return { ext: ext === 'jpeg' ? 'jpg' : ext, mime };
}

// ---------- Consultas ----------

export async function cargarPerfiles() {
  const { data, error } = await supabase
    .from('profiles').select('id, display_name').order('display_name');
  if (error) throw error;
  return data;
}

export async function cargarCategorias() {
  const { data, error } = await supabase
    .from('categories').select('name').order('name');
  if (error) throw error;
  return data.map(c => c.name);
}

export async function estadisticas(userId) {
  const total = supabase.from('documents').select('id', { count: 'exact', head: true });
  const propios = supabase.from('documents').select('id', { count: 'exact', head: true })
    .eq('owner_id', userId);
  const [t, p] = await Promise.all([total, propios]);
  if (t.error) throw t.error;
  if (p.error) throw p.error;
  return { total: t.count ?? 0, propios: p.count ?? 0 };
}

export async function ultimos(cantidad = 5) {
  const { data, error } = await supabase
    .from('documents').select('*')
    .order('created_at', { ascending: false })
    .limit(cantidad);
  if (error) throw error;
  return data;
}

export async function buscar({ texto = '', autor = null, categoria = null, ascendente = false } = {}) {
  const { data, error } = await supabase.rpc('search_documents', {
    p_query: texto.trim() || null,
    p_owner: autor || null,
    p_category: categoria || null,
    p_ascending: ascendente,
    p_limit: 200
  });
  if (error) throw error;
  return data;
}

// ---------- Carga ----------
// 1) sube el archivo  2) guarda los metadatos
// Si el paso 2 falla, se borra el archivo del paso 1 (sin huérfanos).
export async function subir({ file, titulo, descripcion, categoria, fechaClase }, userId) {
  const { ext, mime } = await validarArchivo(file);
  const ruta = `${userId}/${crypto.randomUUID()}.${ext}`;

  // Se reenvuelve el archivo con su tipo MIME correcto: algunos sistemas
  // entregan .doc o .docx sin tipo y el bucket los rechazaría.
  const cuerpo = new Blob([file], { type: mime });
  const { error: errSubida } = await supabase.storage.from(BUCKET)
    .upload(ruta, cuerpo, { contentType: mime, upsert: false, cacheControl: '3600' });
  if (errSubida) throw traducirError(errSubida, 'No se pudo subir el archivo.');

  const { data, error } = await supabase.from('documents').insert({
    title: titulo.trim(),
    description: descripcion.trim() || null,
    category: categoria,
    original_filename: file.name.slice(0, 255),
    storage_path: ruta,
    mime_type: mime,
    size_bytes: file.size,
    class_date: fechaClase || null
  }).select().single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([ruta]); // deshacer paso 1
    throw traducirError(error, 'No se pudieron guardar los datos del apunte.');
  }
  return data;
}

// ---------- Ver y descargar (enlaces temporales) ----------

export async function enlaceTemporal(doc, { descargar = false } = {}) {
  const opciones = descargar ? { download: doc.original_filename } : undefined;
  const { data, error } = await supabase.storage.from(BUCKET)
    .createSignedUrl(doc.storage_path, SIGNED_URL_SECONDS, opciones);
  if (error || !data?.signedUrl) {
    throw traducirError(error, 'No se pudo obtener el archivo. Puede que ya no exista.');
  }
  return data.signedUrl;
}

// ---------- Eliminación ----------
// 1) borra los metadatos (el apunte desaparece de la biblioteca)
// 2) borra el archivo, con reintentos.
// Este orden evita registros que apunten a archivos inexistentes.
export async function eliminar(doc) {
  const { data, error } = await supabase.from('documents')
    .delete().eq('id', doc.id).select('id');
  if (error) throw traducirError(error, 'No se pudo eliminar el apunte.');
  if (!data || data.length === 0) {
    throw new Error('No tienes permiso para eliminar este apunte o ya no existe.');
  }

  for (let intento = 1; intento <= 3; intento++) {
    const { data: borrados, error: errArchivo } = await supabase.storage.from(BUCKET)
      .remove([doc.storage_path]);
    if (!errArchivo && borrados?.length === 1) return { archivoPendiente: false };
    await new Promise(r => setTimeout(r, 500 * intento));
  }
  // El apunte ya no aparece; el archivo quedó sin borrar (ver README: limpieza).
  console.warn('Archivo pendiente de limpieza:', doc.storage_path);
  return { archivoPendiente: true };
}

function traducirError(error, porDefecto) {
  const m = String(error?.message || '').toLowerCase();
  if (m.includes('failed to fetch') || m.includes('network')) {
    return new Error('No se pudo conectar. Revisa tu conexión a internet.');
  }
  if (m.includes('jwt') || m.includes('expired')) {
    return new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
  }
  if (m.includes('exceeded') || m.includes('too large') || m.includes('payload')) {
    return new Error(`El archivo supera el máximo de ${MAX_FILE_MB} MB.`);
  }
  if (m.includes('mime') || m.includes('not supported')) {
    return new Error('Formato no admitido.');
  }
  return new Error(porDefecto);
}
