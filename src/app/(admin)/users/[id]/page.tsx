/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { awardBadge } from './actions';
import { Card, Flash, StatTile, input, label } from '@/components/ui';
import type { Badge, Profile, Subscription } from '@/lib/types';
import SubmitButton from '@/components/SubmitButton';

export const dynamic = 'force-dynamic';

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole('users');
  const { id } = await params;
  const query = await searchParams;

  const db = supabaseAdmin();
  const { data: user } = await db.from('profiles').select('*').eq('id', id).maybeSingle();
  if (!user) notFound();
  const profile = user as Profile;

  const [{ data: sub }, { data: earned }, { data: allBadges }, { count: lessonsDone }] = await Promise.all([
    db.from('subscriptions').select('*').eq('user_id', id).maybeSingle(),
    db.from('user_badges').select('badge_id, unlocked_at, badges!inner(title, icon_url)').eq('user_id', id).order('unlocked_at', { ascending: false }),
    db.from('badges').select('id, title, requirement_value').eq('is_active', true).order('requirement_value'),
    db.from('lesson_progress').select('*', { count: 'exact', head: true }).eq('user_id', id),
  ]);

  const subscription = sub as Subscription | null;
  const earnedIds = new Set((earned ?? []).map(e => e.badge_id as string));
  const awardable = ((allBadges ?? []) as Pick<Badge, 'id' | 'title' | 'requirement_value'>[]).filter(
    b => !earnedIds.has(b.id),
  );
  return (
    <div className="space-y-8">
      <div>
        <Link href="/users" className="text-xs font-medium text-neutral-400 hover:text-neutral-600">← Users</Link>
        <h1 className="mt-1 text-xl font-bold text-neutral-900">{profile.display_name || 'Unnamed user'}</h1>
        <p className="text-sm text-neutral-500">{profile.email}</p>
      </div>

      <Flash searchParams={query} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Total XP" value={profile.total_xp} />
        <StatTile label="Current Streak" value={`${profile.current_streak} days`} />
        <StatTile label="Lessons Completed" value={lessonsDone ?? 0} />
        <StatTile label="Badges" value={profile.badges_count} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Card title="Earned badges">
          <ul className="space-y-2">
            {(earned ?? []).map(e => {
              const badge = e.badges as unknown as { title: string; icon_url: string | null };
              return (
                <li key={e.badge_id as string} className="flex items-center gap-3">
                  {badge.icon_url ? (
                    <img src={badge.icon_url} alt="" className="h-7 w-7 object-contain" />
                  ) : (
                    <span className="inline-block h-7 w-7 rounded-full bg-neutral-100" />
                  )}
                  <span className="text-sm text-neutral-800">{badge.title}</span>
                  <span className="ml-auto text-xs text-neutral-400">
                    {new Date(e.unlocked_at as string).toLocaleDateString()}
                  </span>
                </li>
              );
            })}
            {(earned ?? []).length === 0 && <li className="text-sm text-neutral-400">No badges earned yet.</li>}
          </ul>

          {awardable.length > 0 && (
            <form action={awardBadge} className="mt-5 flex items-end gap-2 border-t border-neutral-100 pt-4">
              <input type="hidden" name="userId" value={id} />
              <div className="flex-1">
                <label className={label}>Manually award a badge</label>
                <select name="badgeId" className={input} defaultValue="">
                  <option value="" disabled>Choose a badge...</option>
                  {awardable.map(b => (
                    <option key={b.id} value={b.id}>
                      {b.title} ({b.requirement_value} XP tier)
                    </option>
                  ))}
                </select>
              </div>
              <SubmitButton pendingLabel="Awarding...">Award</SubmitButton>
            </form>
          )}
        </Card>

        <Card title="Subscription">
          <div className="text-sm text-neutral-700">
            <p>
              Plan: <strong>{subscription?.plan ?? 'free'}</strong> &middot; Status:{' '}
              <strong>{subscription?.status ?? 'active'}</strong>
            </p>
            {subscription?.expires_at && (
              <p className="mt-1">Expires: {new Date(subscription.expires_at).toLocaleDateString()}</p>
            )}
            <p className="mt-3 text-xs text-neutral-400">
              Read-only. Subscriptions are not editable from the admin panel.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
