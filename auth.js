// =====================================================================
//  AUTENTICACIÓN Y SESIÓN
// =====================================================================
import { supabase } from './supabase-client.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// Valida el formulario antes de llamar al servidor.
// Devuelve null si está bien, o { campo, mensaje }.
export function validarCredenciales(email, password) {
  if (!email) return { campo: 'email', mensaje: 'Ingresa tu correo electrónico.' };
  if (!EMAIL_RE.test(email)) return { campo: 'email', mensaje: 'El formato del correo no es válido.' };
  if (!password) return { campo: 'password', mensaje: 'Ingresa tu contraseña.' };
  return null;
}

// Traduce errores sin revelar si un correo existe o no.
function mensajeAmigable(error) {
  const m = String(error?.message || '').toLowerCase();
  if (error?.status === 429 || m.includes('rate limit') || m.includes('too many')) {
    return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  }
  if (m.includes('failed to fetch') || m.includes('network') || m.includes('load failed')) {
    return 'No se pudo conectar. Revisa tu conexión a internet.';
  }
  return 'Correo o contraseña incorrectos.';
}

// Devuelve el integrante de la sesión actual o null.
// Verifica con el servidor (getUser) y contra la lista de perfiles.
export async function obtenerMiembro() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;

  const { data: perfil, error: errPerfil } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id', user.id)
    .maybeSingle();

  if (errPerfil || !perfil) return null;
  return { id: perfil.id, nombre: perfil.display_name, email: user.email };
}

// Inicia sesión. Devuelve el integrante o lanza un Error con mensaje para mostrar.
export async function iniciarSesion(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(mensajeAmigable(error));

  const miembro = await obtenerMiembro();
  if (!miembro) {
    // Cuenta válida pero no autorizada: se cierra de inmediato.
    await supabase.auth.signOut({ scope: 'local' });
    throw new Error('Tu cuenta no tiene acceso a esta aplicación.');
  }
  return miembro;
}

// Cierra la sesión en este navegador y revoca el token en el servidor.
export async function cerrarSesion() {
  const { error } = await supabase.auth.signOut();
  if (error) await supabase.auth.signOut({ scope: 'local' }); // al menos borra la sesión local
}

// Avisa cuando la sesión termina (cierre en otra pestaña o expiración).
export function alCerrarSesion(callback) {
  supabase.auth.onAuthStateChange((evento) => {
    if (evento === 'SIGNED_OUT') callback();
  });
}
