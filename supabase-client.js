// Cliente único de Supabase, compartido por auth.js y documents.js.
// Versión fijada (la probada): evita que una actualización cambie el comportamiento.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configurado =
  SUPABASE_URL.startsWith('https://') &&
  !SUPABASE_URL.includes('TU-PROYECTO') &&
  !SUPABASE_ANON_KEY.startsWith('TU-');

export const supabase = createClient(
  configurado ? SUPABASE_URL : 'https://sin-configurar.supabase.co',
  configurado ? SUPABASE_ANON_KEY : 'sin-configurar',
  {
    auth: {
      persistSession: true,      // la sesión sobrevive a recargas
      autoRefreshToken: true,    // renueva el token antes de que expire
      detectSessionInUrl: false  // no hay registro ni recuperación por enlace
    }
  }
);
