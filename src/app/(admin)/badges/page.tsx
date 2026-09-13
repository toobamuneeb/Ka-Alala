/* eslint-disable @next/next/no-img-element */
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createBadge, updateBadge, deleteBadge } from './actions';
import { Card, Flash, btnSecondary } from '@/components/ui';
import type { Badge } from '@/lib/types';
import SubmitButton from '@/components/SubmitButton';
import PendingLink from '@/components/PendingLink';
import BadgeForm, { type XpTier } from './BadgeForm';

export const dynamic = 'force-dynamic';

export default async function BadgesPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; edit?: string }>;
}) {
  await requireRole('content');
  const query = await searchParams;

  const { data: badges, error } = await supabaseAdmin()
    .from('badges')
    .select('*')
    .order('requirement_value', { ascending: true });
  if (error) throw error;

  const list = (badges ?? []) as Badge[];
  const editing = list.find(b => b.id === query.edit);

  // Only total_xp badges compete for a tier; streak/lesson badges count their
  // own thing and may legitimately share a number.
  const tiersExcluding = (id?: string): XpTier[] =>
    list
      .filter(b => b.requirement_type === 'total_xp' && b.id !== id)
      .map(b => ({ value: b.requirement_value, title: b.title }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Badges</h1>
        <p className="mt-1 text-sm text-neutral-500">
          All badges unlock automatically by total XP. Manual awards are on each user&apos;s page.
        </p>
      </div>

      <Flash searchParams={query} />

      <Card title={`Badges (${list.length})`}>
        <ul className="divide-y divide-neutral-100">
          {list.map(badge => (
            <li key={badge.id} className="flex items-center gap-4 py-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-neutral-200"
                style={{ backgroundColor: badge.bg_color }}
              >
                {badge.icon_url ? (
                  <img src={badge.icon_url} alt="" className="h-8 w-8 object-contain" />
                ) : (
                  <span className="text-xs text-neutral-400">—</span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-neutral-800">
                  {badge.title}
                  {!badge.is_active && (
                    <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-500">
                      inactive
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-neutral-400">
                  {badge.requirement_type === 'total_xp'
                    ? `${badge.requirement_value} XP`
                    : `${badge.requirement_type}: ${badge.requirement_value}`}
                  {badge.description ? ` · ${badge.description}` : ''}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <PendingLink href={`/badges?edit=${badge.id}#badge-form`} className={btnSecondary}>Edit</PendingLink>
                <form action={deleteBadge}>
                  <input type="hidden" name="id" value={badge.id} />
                  <SubmitButton
                    variant="danger"
                    pendingLabel="Deleting..."
                    title="Also removes it from every user who earned it - prefer deactivating"
                  >
                    Delete
                  </SubmitButton>
                </form>
              </div>
            </li>
          ))}
          {list.length === 0 && <li className="py-8 text-center text-sm text-neutral-400">No badges yet.</li>}
        </ul>
      </Card>

      <div id="badge-form">
        {editing ? (
          <Card title={`Edit badge: ${editing.title}`} actions={<PendingLink href="/badges" className={btnSecondary}>Cancel</PendingLink>}>
            <BadgeForm
              action={updateBadge}
              existing={editing}
              submitLabel="Save badge"
              takenTiers={tiersExcluding(editing.id)}
            />
          </Card>
        ) : (
          <Card title="Add a badge">
            <BadgeForm action={createBadge} submitLabel="Create badge" takenTiers={tiersExcluding()} />
          </Card>
        )}
      </div>
    </div>
  );
}
