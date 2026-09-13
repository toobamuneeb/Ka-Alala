import 'server-only';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client - bypasses RLS. SERVER ONLY (the 'server-only'
 * import makes any accidental client-side import a build error).
 *
 * Every call site must be behind requireAdmin()/requireRole() from lib/auth -
 * this client is what lets the panel write to the content tables that are
 * deliberately locked against the mobile app's `authenticated` role.
 *
 * Lazily initialized so `next build` doesn't need the real key at build time.
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey || serviceKey.startsWith('PASTE_')) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. Paste it into .env.local (Supabase Dashboard -> Project Settings -> API).',
    );
  }

  cached = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cached;
}
