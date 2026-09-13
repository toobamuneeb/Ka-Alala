'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { siteOrigin } from '@/lib/site-url';

/** Identical wording whether or not the email exists - see below. */
const SENT_MESSAGE =
  'If that email belongs to an admin account, a 6-digit code is on its way. Check your inbox (and spam).';

/**
 * Step 1 - email a 6-digit recovery code.
 *
 * The code comes from `{{ .Token }}` in the Supabase "Reset Password" email
 * template; `redirectTo` only matters if that template also still renders the
 * old link, which /auth/callback keeps working as a fallback.
 *
 * Two deliberate rules:
 *  - Only emails present in `admin_users` get an email. This panel shares its
 *    Supabase project with the mobile app, so without the check it would
 *    happily send codes to ordinary app users.
 *  - The response never says whether the email matched, so the login page
 *    can't be used to enumerate admin accounts.
 */
export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();

  if (!email) {
    redirect('/forgot-password?error=' + encodeURIComponent('Email is required.'));
  }

  const { data: admin } = await supabaseAdmin()
    .from('admin_users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (admin) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${await siteOrigin()}/auth/callback?next=/reset-password`,
    });
    // Real failures (SMTP down, rate limit hit) are worth showing - staying
    // silent here would leave the admin waiting for a code that never comes.
    if (error) {
      redirect(
        `/forgot-password?email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`,
      );
    }
  }

  // `email` carries the form to its code-entry step for everyone, matched or not.
  redirect(
    `/forgot-password?email=${encodeURIComponent(email)}&ok=${encodeURIComponent(SENT_MESSAGE)}`,
  );
}

/**
 * Step 2 - exchange the 6-digit code for a session, which is what lets
 * /reset-password call updateUser() as that admin.
 */
export async function verifyResetCode(formData: FormData) {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const token = String(formData.get('token') ?? '').replace(/\D/g, '');

  function back(message: string): never {
    redirect(
      `/forgot-password?email=${encodeURIComponent(email)}&error=${encodeURIComponent(message)}`,
    );
  }

  if (!email) {
    redirect('/forgot-password?error=' + encodeURIComponent('Start again - the email is missing.'));
  }
  if (token.length !== 6) back('Enter the 6-digit code from the email.');

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' });

  if (error || !data.user) {
    back('That code is invalid or has expired. Request a new one.');
  }

  // The code proves the email, not admin status - a mobile-app account holding
  // a valid recovery code must not get a panel session.
  const { data: admin } = await supabaseAdmin()
    .from('admin_users')
    .select('id')
    .eq('id', data.user.id)
    .maybeSingle();

  if (!admin) {
    await supabase.auth.signOut();
    redirect('/login?error=' + encodeURIComponent('This account does not have admin access.'));
  }

  redirect('/reset-password');
}
