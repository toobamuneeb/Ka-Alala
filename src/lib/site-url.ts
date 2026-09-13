import 'server-only';
import { headers } from 'next/headers';

/**
 * Absolute origin of this panel, used to build the `redirectTo` that Supabase
 * puts in the password-reset email. Set NEXT_PUBLIC_SITE_URL in production;
 * otherwise we derive it from the incoming request (works for `next dev`).
 *
 * Whatever this resolves to must be listed under Supabase Dashboard ->
 * Authentication -> URL Configuration -> Redirect URLs, or the link in the
 * email will bounce back to the site URL instead of reaching /auth/callback.
 */
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  // Proxies may send a comma-separated list - the first entry is the client's.
  const proto =
    h.get('x-forwarded-proto')?.split(',')[0].trim() ??
    (host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https');

  return `${proto}://${host}`;
}
