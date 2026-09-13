import { requireAdmin } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { StatTile, Card } from '@/components/ui';

export const dynamic = 'force-dynamic';

async function count(table: string): Promise<number> {
  const { count: n, error } = await supabaseAdmin()
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return n ?? 0;
}

export default async function DashboardPage() {
  await requireAdmin();

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  // Admins get an auth account, and the on_auth_user_created trigger mirrors
  // every auth account into `profiles` - so without this they'd show up here as
  // learners. The dashboard reports on the app's audience, so they're excluded.
  //
  // Every query here costs a round trip of roughly the same latency whatever it
  // returns, so the page is arranged as two waves rather than one query at a
  // time: everything that doesn't need the admin ids goes out with the ids
  // themselves, and only the two profile queries wait for them.
  const [adminRowsResult, chapters, lessons, questions, badges, posts, completions, todaysXpResult] =
    await Promise.all([
      supabaseAdmin().from('admin_users').select('id'),
      count('chapters'),
      count('lessons'),
      count('quiz_questions'),
      count('user_badges'),
      count('posts'),
      count('lesson_progress'),
      supabaseAdmin().from('xp_transactions').select('amount').gte('created_at', todayStart.toISOString()),
    ]);

  if (adminRowsResult.error) throw adminRowsResult.error;
  const adminIds = (adminRowsResult.data ?? []).map(a => a.id as string);
  const notAdmin = `(${adminIds.join(',')})`;

  const xpToday = (todaysXpResult.data ?? []).reduce((sum, t) => sum + (t.amount as number), 0);

  let usersQuery = supabaseAdmin().from('profiles').select('*', { count: 'exact', head: true });
  if (adminIds.length) usersQuery = usersQuery.not('id', 'in', notAdmin);

  let recentQuery = supabaseAdmin()
    .from('profiles')
    .select('id, email, display_name, created_at, total_xp')
    .order('created_at', { ascending: false })
    .limit(6);
  if (adminIds.length) recentQuery = recentQuery.not('id', 'in', notAdmin);

  const [usersResult, recentResult] = await Promise.all([usersQuery, recentQuery]);

  if (usersResult.error) throw usersResult.error;
  const users = usersResult.count ?? 0;

  if (recentResult.error) throw recentResult.error;
  const recentUsers = recentResult.data;

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-bold text-neutral-900">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Users" value={users} />
        <StatTile label="Chapters" value={chapters} />
        <StatTile label="Lessons" value={lessons} />
        <StatTile label="Quiz Questions" value={questions} />
        <StatTile label="Lessons Completed" value={completions} />
        <StatTile label="Badges Awarded" value={badges} />
        <StatTile label="Community Posts" value={posts} />
        <StatTile label="XP Earned Today" value={xpToday} />
      </div>

      <Card title="Newest users">
        <ul className="divide-y divide-neutral-100">
          {(recentUsers ?? []).map(u => (
            <li key={u.id as string} className="flex items-center justify-between py-2.5">
              <div>
                <p className="text-sm font-medium text-neutral-800">{u.display_name || 'Unnamed'}</p>
                <p className="text-xs text-neutral-400">{u.email}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-neutral-700">{u.total_xp} XP</p>
                <p className="text-xs text-neutral-400">
                  {new Date(u.created_at).toLocaleDateString()}
                </p>
              </div>
            </li>
          ))}
          {(recentUsers ?? []).length === 0 && (
            <li className="py-6 text-center text-sm text-neutral-400">No users yet</li>
          )}
        </ul>
      </Card>
    </div>
  );
}
