import { NextResponse, type NextRequest } from 'next/server';
import { supabaseServer } from '@/lib/supabase/server';

/**
 * Landing point for the link in the password-reset email. Supabase sends the
 * browser here with a one-time `code`; exchanging it sets the session cookies,
 * which is what lets /reset-password call updateUser() as that admin.
 *
 * The code verifier lives in a cookie set when the email was requested, so the
 * link has to be opened in the same browser that asked for the reset.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const emailError = searchParams.get('error_description') ?? searchParams.get('error');

  // Only same-origin paths - never let the email decide an external redirect.
  const requestedNext = searchParams.get('next') ?? '/';
  const next =
    requestedNext.startsWith('/') && !requestedNext.startsWith('//') ? requestedNext : '/';

  const bounce = (message: string) =>
    NextResponse.redirect(
      new URL(`/forgot-password?error=${encodeURIComponent(message)}`, origin),
    );

  if (emailError) return bounce(emailError);
  if (!code) return bounce('That reset link is missing its code. Please request a new one.');

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return bounce(
      'That reset link has expired or was already used. Please request a new one.',
    );
  }

  return NextResponse.redirect(new URL(next, origin));
}
