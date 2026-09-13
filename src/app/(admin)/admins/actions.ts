'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { AdminRole } from '@/lib/types';

const ROLES: AdminRole[] = ['super_admin', 'content_manager', 'support'];

/**
 * New admins are super admins only for now. The other roles still exist in the
 * enum, in AREA_ROLES and on admins that already hold them - this only limits
 * what the Add admin form may create. To offer them again, widen this list and
 * put the <select> back in page.tsx; changing one without the other silently
 * rejects the form.
 */
const CREATABLE_ROLES: AdminRole[] = ['super_admin'];

function fail(message: string): never {
  redirect(`/admins?error=${encodeURIComponent(message)}`);
}

/**
 * Add an admin. If the email already has an auth account (e.g. an app user or
 * a previously created admin) we reuse it; otherwise we create a fresh,
 * pre-confirmed auth user with the given password.
 */
export async function addAdmin(formData: FormData) {
  await requireRole('admins');
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const role = String(formData.get('role')) as AdminRole;
  const display_name = String(formData.get('displayName') ?? '').trim() || null;

  if (!email) fail('Email is required.');
  if (!CREATABLE_ROLES.includes(role)) fail('New admins can only be created as Super Admin.');

  const db = supabaseAdmin();

  // profiles mirrors auth.users (created by the signup trigger), so it's our
  // reliable way to find an existing auth user id by email.
  const { data: existingProfile } = await db
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  let userId = existingProfile?.id as string | undefined;

  if (!userId) {
    if (password.length < 8) fail('New accounts need a password of at least 8 characters.');
    const { data: created, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !created.user) fail(error?.message || 'Failed to create the account.');
    userId = created.user.id;
  }

  const { error: insertError } = await db
    .from('admin_users')
    .upsert({ id: userId, email, role, display_name }, { onConflict: 'id' });
  if (insertError) fail(insertError.message);

  revalidatePath('/admins');
  redirect('/admins?ok=' + encodeURIComponent(`${email} is now ${role.replace('_', ' ')}.`));
}

export async function changeAdminRole(formData: FormData) {
  const me = await requireRole('admins');
  const id = String(formData.get('id'));
  const role = String(formData.get('role')) as AdminRole;
  if (!ROLES.includes(role)) fail('Invalid role.');
  if (id === me.id) fail('You cannot change your own role.');

  const { error } = await supabaseAdmin().from('admin_users').update({ role }).eq('id', id);
  if (error) fail(error.message);

  revalidatePath('/admins');
  redirect('/admins?ok=' + encodeURIComponent('Role updated.'));
}

/**
 * Revoke admin access. Only removes the admin_users row - the underlying auth
 * account (and any app data) stays untouched.
 */
export async function removeAdmin(formData: FormData) {
  const me = await requireRole('admins');
  const id = String(formData.get('id'));
  if (id === me.id) fail('You cannot remove your own admin access.');

  const { error } = await supabaseAdmin().from('admin_users').delete().eq('id', id);
  if (error) fail(error.message);

  revalidatePath('/admins');
  redirect('/admins?ok=' + encodeURIComponent('Admin access revoked.'));
}
