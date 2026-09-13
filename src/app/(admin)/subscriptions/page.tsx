import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { Card, StatTile, btnSecondary, th, td, EmptyRow } from '@/components/ui';
import type { Subscription } from '@/lib/types';
import PendingLink from '@/components/PendingLink';

export const dynamic = 'force-dynamic';

type SubRow = Subscription & { profiles: { email: string; display_name: string | null } | null };

export default async function SubscriptionsPage() {
  await requireRole('subscriptions');

  const db = supabaseAdmin();
  const [{ data: subs, error }, { count: totalUsers }] = await Promise.all([
    db
      .from('subscriptions')
      .select('*, profiles!inner(email, display_name)')
      .order('updated_at', { ascending: false }),
    db.from('profiles').select('*', { count: 'exact', head: true }),
  ]);
  if (error) throw error;

  const list = (subs ?? []) as SubRow[];
  const paid = list.filter(s => s.plan !== 'free' && s.status === 'active').length;
  const trials = list.filter(s => s.status === 'trial').length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Subscriptions</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Users without a row here are on the free plan. Edit a subscription from the user&apos;s page.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total Users" value={totalUsers ?? 0} />
        <StatTile label="Active Paid" value={paid} />
        <StatTile label="On Trial" value={trials} />
        <StatTile label="Free" value={(totalUsers ?? 0) - paid - trials} />
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className={th}>User</th>
                <th className={th}>Plan</th>
                <th className={th}>Status</th>
                <th className={th}>Started</th>
                <th className={th}>Expires</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {list.map(sub => (
                <tr key={sub.id}>
                  <td className={td}>
                    <p className="font-medium">{sub.profiles?.display_name || 'Unnamed'}</p>
                    <p className="text-xs text-neutral-400">{sub.profiles?.email}</p>
                  </td>
                  <td className={td}>{sub.plan}</td>
                  <td className={td}>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                        sub.status === 'active'
                          ? 'bg-green-100 text-green-800'
                          : sub.status === 'trial'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-neutral-100 text-neutral-600'
                      }`}
                    >
                      {sub.status}
                    </span>
                  </td>
                  <td className={td}>{new Date(sub.started_at).toLocaleDateString()}</td>
                  <td className={td}>{sub.expires_at ? new Date(sub.expires_at).toLocaleDateString() : '—'}</td>
                  <td className={td}>
                    <PendingLink href={`/users/${sub.user_id}`} className={btnSecondary}>Manage</PendingLink>
                  </td>
                </tr>
              ))}
              {list.length === 0 && (
                <EmptyRow colSpan={6} text="No subscriptions yet - everyone is on the free plan." />
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
