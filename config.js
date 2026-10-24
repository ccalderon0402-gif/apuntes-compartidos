// =====================================================================
//  CONFIGURACIÓN PÚBLICA
//  Copia aquí los datos de Supabase > Project Settings > API.
//
//  La "anon public key" es PÚBLICA por diseño: cualquiera puede verla en
//  el navegador. Lo que protege los apuntes son las políticas RLS del
//  archivo supabase-schema.sql.
//  NUNCA pongas aquí la "service_role key" ni contraseñas.
// =====================================================================
export const SUPABASE_URL = 'https://imktiwrosxnkmovnmwhw.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_v2JEMaLueCpccQ33yDhJJg_j5XkExom';

// Nombre del bucket privado (debe coincidir con supabase-schema.sql).
export const BUCKET = 'documents';

// Tamaño máximo por archivo, en MB. Si lo cambias, ajusta también
// file_size_limit en supabase-schema.sql (10 MB = 10485760 bytes).
export const MAX_FILE_MB = 10;

// Duración de los enlaces temporales para ver o descargar (segundos).
export const SIGNED_URL_SECONDS = 300;

// Formatos admitidos: extensión -> tipo MIME.
export const ALLOWED_TYPES = {
  pdf:  'application/pdf',
  doc:  'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  png:  'image/png'
};
