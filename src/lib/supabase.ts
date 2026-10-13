import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';
const hasRealValues = Boolean(url && anonKey && !url.includes('YOUR_PROJECT_REF') && !anonKey.includes('YOUR_SUPABASE'));

let client: any = null;
let configError = '';

if (hasRealValues) {
  try {
    const parsedUrl = new URL(url);
    if (!['https:', 'http:'].includes(parsedUrl.protocol)) {
      throw new Error('URL harus menggunakan HTTPS atau HTTP.');
    }
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      realtime: { params: { eventsPerSecond: 10 } },
    });
  } catch {
    configError = 'Konfigurasi Supabase tidak valid. Periksa VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY di Vercel.';
  }
}

export const supabaseConfigError = configError;
export const isSupabaseConfigured = Boolean(client);
export const supabase: any = client;

export function requireSupabase(): any {
  if (!supabase) {
    throw new Error(supabaseConfigError || 'Supabase belum dikonfigurasi. Isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY.');
  }
  return supabase;
}
