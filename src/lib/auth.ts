import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { supabaseServer } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { AdminUser, AdminRole } from '@/lib/types';

/**
 * Which roles may access which area. super_admin can do everything;
 * content_manager owns learning content; support has read access to
 * users/subscriptions (edits there stay super_admin-only in the actions).
 */
export const AREA_ROLES: Record<string, AdminRole[]> = {
  dashboard: ['super_admin', 'content_manager', 'support'],
  content: ['super_admin', 'content_manager'],
  users: ['super_admin', 'support'],
  community: ['super_admin', 'support'],
  subscriptions: ['super_admin', 'support'],
  admins: ['super_admin'],
};

/**
 * The signed-in admin, or redirect to /login. Every page/action starts here.
 *
 * Wrapped in React's `cache` because the layout and the page it renders both
 * call this in the same request - without it every page load paid for two
 * auth.getUser() round trips and two admin_users lookups instead of one.
 * The cache is per-request, so it never leaks one admin's identity to another.
 */
export const requireAdmin = cache(async (): Promise<AdminUser> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect('/login');

  const { data: admin, error } = await supabaseAdmin()
    .from('admin_users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (error) throw error;
  if (!admin) {
    // A valid Supabase user but not an admin (e.g. a mobile app account).
    await supabase.auth.signOut();
    redirect('/login?error=not-admin');
  }

  return admin as AdminUser;
});

/** requireAdmin + role gate for an area. Unauthorized roles land on the dashboard. */
export async function requireRole(area: keyof typeof AREA_ROLES): Promise<AdminUser> {
  const admin = await requireAdmin();
  if (!AREA_ROLES[area].includes(admin.role)) redirect('/');
  return admin;
}
