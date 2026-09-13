'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin, requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

function fail(userId: string, message: string): never {
  redirect(`/users/${userId}?error=${encodeURIComponent(message)}`);
}

/** Manually grant a badge (any admin who can see users may do this). */
export async function awardBadge(formData: FormData) {
  await requireRole('users');
  const userId = String(formData.get('userId'));
  const badgeId = String(formData.get('badgeId'));
  if (!badgeId) fail(userId, 'Pick a badge to award.');

  // Idempotent: (user_id, badge_id) is unique - "already has it" is not an error.
  const { error } = await supabaseAdmin()
    .from('user_badges')
    .insert({ user_id: userId, badge_id: badgeId });
  if (error && error.code !== '23505') fail(userId, error.message);

  revalidatePath(`/users/${userId}`);
  redirect(
    `/users/${userId}?ok=` +
      encodeURIComponent(error?.code === '23505' ? 'User already has that badge.' : 'Badge awarded.'),
  );
}

/**
 * Set/replace the user's subscription. Super-admin only.
 *
 * Currently unwired: the user page shows subscriptions read-only. Kept so the
 * editor can be restored by putting the form back - the guards below are what
 * make that safe, so don't drop them if you do.
 */
export async function setSubscription(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get('userId'));
  if (admin.role !== 'super_admin') fail(userId, 'Only a super admin can change subscriptions.');

  const plan = String(formData.get('plan'));
  const status = String(formData.get('status'));
  const expiresRaw = String(formData.get('expiresAt') ?? '').trim();

  if (!['free', 'monthly', 'yearly', 'lifetime'].includes(plan)) fail(userId, 'Invalid plan.');
  if (!['active', 'trial', 'canceled', 'expired'].includes(status)) fail(userId, 'Invalid status.');

  const expires_at = expiresRaw ? new Date(expiresRaw).toISOString() : null;

  const { error } = await supabaseAdmin()
    .from('subscriptions')
    .upsert({ user_id: userId, plan, status, expires_at }, { onConflict: 'user_id' });
  if (error) fail(userId, error.message);

  revalidatePath(`/users/${userId}`);
  revalidatePath('/subscriptions');
  redirect(`/users/${userId}?ok=` + encodeURIComponent('Subscription updated.'));
}
