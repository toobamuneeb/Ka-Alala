import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { Card, btnSecondary, th, td, EmptyRow } from '@/components/ui';
import type { Profile, Subscription } from '@/lib/types';

/**
 * `subscriptions.user_id` is a unique FK to `profiles.id`, so PostgREST embeds
 * it as a single object (or null) - one round trip instead of a second query
 * keyed on this page's ids.
 */
type UserRow = Pick<
  Profile,
  'id' | 'email' | 'display_name' | 'total_xp' | 'current_streak' | 'badges_count' | 'created_at'
> & { subscriptions: Pick<Subscription, 'plan' | 'status'> | null };
import PendingLink from '@/components/PendingLink';
import Pagination from '@/components/Pagination';
import SearchForm from './SearchForm';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireRole('users');
  const { q, page: pageParam } = await searchParams;

  const term = q?.trim() ?? '';
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const db = supabaseAdmin();
  let queryBuilder = db
    .from('profiles')
    // count: 'exact' gives the total matching rows, not just this page's slice.
    .select(
      'id, email, display_name, total_xp, current_streak, badges_count, created_at, subscriptions(plan, status)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (term) {
    queryBuilder = queryBuilder.or(`email.ilike.%${term}%,display_name.ilike.%${term}%`);
  }

  const { data: users, count, error } = await queryBuilder;
  if (error) throw error;

  // supabase-js has no generated DB types here, so it types every embed as an
  // array; the unique FK means PostgREST actually sends one object or null.
  // Normalising both shapes is safer than asserting either one.
  const list: UserRow[] = (users ?? []).map(u => ({
    ...u,
    subscriptions: (Array.isArray(u.subscriptions) ? u.subscriptions[0] : u.subscriptions) ?? null,
  }));
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const pageHref = (n: number) => {
    const sp = new URLSearchParams();
    if (term) sp.set('q', term);
    if (n > 1) sp.set('page', String(n));
    const qs = sp.toString();
    return qs ? `/users?${qs}` : '/users';
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Users</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {total === 0
            ? term
              ? 'No users match that search.'
              : 'No users yet.'
            : `${total} user${total === 1 ? '' : 's'}${term ? ' matching your search' : ''} - newest first.`}
        </p>
      </div>

      <SearchForm defaultQuery={q ?? ''} />

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-neutral-100">
                <th className={th}>User</th>
                <th className={th}>XP</th>
                <th className={th}>Streak</th>
                <th className={th}>Badges</th>
                <th className={th}>Plan</th>
                <th className={th}>Joined</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50">
              {list.map(user => {
                const sub = user.subscriptions;
                return (
                  <tr key={user.id}>
                    <td className={td}>
                      <p className="font-medium">{user.display_name || 'Unnamed'}</p>
                      <p className="text-xs text-neutral-400">{user.email}</p>
                    </td>
                    <td className={td}>{user.total_xp}</td>
                    <td className={td}>{user.current_streak}🔥</td>
                    <td className={td}>{user.badges_count}</td>
                    <td className={td}>
                      {sub ? `${sub.plan} (${sub.status})` : <span className="text-neutral-400">free</span>}
                    </td>
                    <td className={td}>{new Date(user.created_at).toLocaleDateString()}</td>
                    <td className={td}>
                      <PendingLink href={`/users/${user.id}`} className={btnSecondary}>Manage</PendingLink>
                    </td>
                  </tr>
                );
              })}
              {list.length === 0 && (
                <EmptyRow colSpan={7} text={term ? 'No users match that search.' : 'No users yet.'} />
              )}
            </tbody>
          </table>
        </div>

        <Pagination
          page={page}
          totalPages={totalPages}
          from={from}
          shown={list.length}
          total={total}
          hrefFor={pageHref}
          noun="users"
        />
      </Card>
    </div>
  );
}
