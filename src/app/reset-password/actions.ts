'use server';

import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';

function fail(message: string): never {
  redirect(`/reset-password?error=${encodeURIComponent(message)}`);
}

/**
 * Set a new password for the session created by the reset link (or for the
 * currently signed-in admin). Ends with a sign-out so the new password is
 * proved on the way back in, and so a stale recovery session can't linger.
 */
export async function updatePassword(formData: FormData) {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  if (password.length < 8) fail('Password must be at least 8 characters.');
  if (password !== confirm) fail('The two passwords do not match.');

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      '/forgot-password?error=' +
        encodeURIComponent('Your reset link has expired. Please request a new one.'),
    );
  }

  // The link proves the email, not admin status - re-check before allowing it.
  const { data: admin } = await supabaseAdmin()
    .from('admin_users')
    .select('id')
    .eq('id', user.id)
    .maybeSingle();

  if (!admin) {
    await supabase.auth.signOut();
    redirect(
      '/login?error=' + encodeURIComponent('This account does not have admin access.'),
    );
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail(error.message);

  await supabase.auth.signOut();
  redirect(
    '/login?ok=' + encodeURIComponent('Password updated. Sign in with your new password.'),
  );
}
