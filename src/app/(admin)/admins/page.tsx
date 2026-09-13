import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { addAdmin, changeAdminRole, removeAdmin } from './actions';
import { Card, Flash, input, label, th, td, EmptyRow } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';
import type { AdminUser } from '@/lib/types';

export const dynamic = 'force-dynamic';

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  content_manager: 'Content Manager',
  support: 'Support',
};

export default async function AdminsPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const me = await requireRole('admins');
  const query = await searchParams;

  const { data, error } = await supabaseAdmin()
    .from('admin_users')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;

  const admins = (data ?? []) as AdminUser[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Admin Accounts</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Super Admin: everything · Content Manager: content only · Support: users &amp; subscriptions (read-only subs).
        </p>
      </div>

      <Flash searchParams={query} />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className={th}>Admin</th>
                <th className={th}>Role</th>
                <th className={th}>Added</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {admins.map(admin => {
                const isMe = admin.id === me.id;
                return (
                  <tr key={admin.id}>
                    <td className={td}>
                      <p className="font-medium">
                        {admin.display_name || 'Unnamed'}
                        {isMe && <span className="ml-2 text-xs font-semibold text-blue-600">(you)</span>}
                      </p>
                      <p className="text-xs text-neutral-400">{admin.email}</p>
                    </td>
                    <td className={td}>
                      {isMe ? (
                        <span className="text-sm">{ROLE_LABELS[admin.role] ?? admin.role}</span>
                      ) : (
                        <form action={changeAdminRole} className="flex items-center gap-2">
                          <input type="hidden" name="id" value={admin.id} />
                          <select name="role" defaultValue={admin.role} className={`${input} w-44`}>
                            <option value="super_admin">Super Admin</option>
                            <option value="content_manager">Content Manager</option>
                            <option value="support">Support</option>
                          </select>
                          <SubmitButton pendingLabel="Saving...">Save</SubmitButton>
                        </form>
                      )}
                    </td>
                    <td className={td}>{new Date(admin.created_at).toLocaleDateString()}</td>
                    <td className={td}>
                      {!isMe && (
                        <form action={removeAdmin}>
                          <input type="hidden" name="id" value={admin.id} />
                          <SubmitButton variant="danger" pendingLabel="Removing...">Remove</SubmitButton>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
              {admins.length === 0 && <EmptyRow colSpan={4} text="No admins found." />}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Add admin">
        <p className="mb-4 text-xs text-neutral-500">
          If the email already has an account (app user or admin), it is reused and the password field is ignored.
          Otherwise a new pre-confirmed account is created with the password you set.
        </p>
        <form action={addAdmin} className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <div>
            <label className={label}>Email</label>
            <input name="email" type="email" required className={input} placeholder="admin@example.com" />
          </div>
          <div>
            <label className={label}>Display name (optional)</label>
            <input name="displayName" className={input} placeholder="Jane" />
          </div>
          <div>
            <label className={label}>Password (only for new accounts, min 8)</label>
            <input name="password" type="password" minLength={8} className={input} placeholder="••••••••" />
          </div>
          <div>
            <label className={label}>Role</label>
            <input type="hidden" name="role" value="super_admin" />
            {/* Styled like a disabled field. Not reusing `input` - its bg-white
                and text-neutral-900 would fight these and Tailwind, not the
                class string, decides which wins. */}
            <p className="w-full rounded-lg border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-500">
              Super Admin
            </p>
            <p className="mt-1 text-xs text-neutral-400">
              Only Super Admins are being created for now.
            </p>
          </div>
          <div className="sm:col-span-2">
            <SubmitButton pendingLabel="Adding...">Add admin</SubmitButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
