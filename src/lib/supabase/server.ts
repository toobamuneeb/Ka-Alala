import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';

/**
 * Cookie-bound Supabase client (anon key) for the CURRENT admin's session -
 * used only for auth (login/logout/who-am-I). Data reads/writes go through
 * the service-role client in lib/supabase/admin.ts after the role check.
 */
export async function supabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component where cookies are read-only -
            // safe to ignore; middleware refreshes the session instead.
          }
        },
      },
    },
  );
}
