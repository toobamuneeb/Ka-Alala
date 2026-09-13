/* eslint-disable @next/next/no-img-element */
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { hidePost, unhidePost, deletePost, dismissReports } from './actions';
import { Card, Flash, input, btnSecondary } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';
import PendingLink from '@/components/PendingLink';
import Pagination from '@/components/Pagination';
import type { Post, PostReport, ReportReason } from '@/lib/types';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 20;

const TABS = ['flagged', 'all', 'hidden'] as const;
type Tab = (typeof TABS)[number];

const REASON_LABEL: Record<ReportReason, string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  hate_speech: 'Hate speech',
  sexual_content: 'Sexual content',
  misinformation: 'Misinformation',
  other: 'Other',
};

type Author = { id: string; email: string; display_name: string | null };

/** posts.user_id is an FK to profiles.id, so the author rides along with the
 *  post instead of costing a second round trip keyed on this page's ids. */
type PostRow = Post & { profiles: Author | Author[] | null };

const POST_SELECT = '*, profiles(id, email, display_name)';

const authorOf = (row: PostRow): Author | null =>
  (Array.isArray(row.profiles) ? row.profiles[0] : row.profiles) ?? null;

export default async function CommunityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string; ok?: string; error?: string }>;
}) {
  await requireRole('community');
  const query = await searchParams;
  const tab: Tab = TABS.includes(query.tab as Tab) ? (query.tab as Tab) : 'flagged';
  const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const pageHref = (n: number) => `/community?tab=${tab}${n > 1 ? `&page=${n}` : ''}`;

  const db = supabaseAdmin();

  // Open reports drive the Flagged tab and the tab's badge count, so they're
  // loaded whichever tab is showing.
  const { data: openReports, error: reportError } = await db
    .from('post_reports')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false });
  if (reportError) throw reportError;

  const reports = (openReports ?? []) as PostReport[];
  const reportsByPost = new Map<string, PostReport[]>();
  for (const r of reports) {
    reportsByPost.set(r.post_id, [...(reportsByPost.get(r.post_id) ?? []), r]);
  }

  let posts: Post[] = [];
  let total = 0;
  const authors = new Map<string, Author | null>();

  if (tab === 'flagged') {
    // Ordering lives in the reports, not the posts, so the page is sliced from
    // the sorted id list first and only those posts are fetched.
    const orderedIds = [...reportsByPost.entries()]
      .sort(
        ([, a], [, b]) => b.length - a.length || b[0].created_at.localeCompare(a[0].created_at),
      )
      .map(([id]) => id);

    total = orderedIds.length;
    const pageIds = orderedIds.slice(from, from + PAGE_SIZE);

    if (pageIds.length) {
      const { data, error } = await db.from('posts').select(POST_SELECT).in('id', pageIds);
      if (error) throw error;
      const rows = data as unknown as PostRow[];
      rows.forEach(r => authors.set(r.user_id, authorOf(r)));
      const byId = new Map(rows.map(p => [p.id, p as Post]));
      posts = pageIds.map(id => byId.get(id)).filter((p): p is Post => !!p);
    }
  } else {
    let q = db
      .from('posts')
      .select(POST_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    q = tab === 'hidden' ? q.not('hidden_at', 'is', null) : q.is('hidden_at', null);

    const { data, count, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as unknown as PostRow[];
    rows.forEach(r => authors.set(r.user_id, authorOf(r)));
    posts = rows as Post[];
    total = count ?? 0;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const flaggedCount = reportsByPost.size;

  const TAB_LABEL: Record<Tab, string> = {
    flagged: `Flagged${flaggedCount ? ` (${flaggedCount})` : ''}`,
    all: 'All posts',
    hidden: 'Hidden',
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Community</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Hiding a post removes it from the app but keeps the row - it can be restored. Deleting is permanent.
        </p>
      </div>

      <Flash searchParams={query} />

      <div className="flex gap-2">
        {TABS.map(t => (
          <PendingLink
            key={t}
            href={`/community?tab=${t}`}
            className={
              t === tab
                ? 'inline-flex items-center rounded-lg bg-red-700 px-3 py-1.5 text-sm font-semibold text-white'
                : btnSecondary
            }
          >
            {TAB_LABEL[t]}
          </PendingLink>
        ))}
      </div>

      <Card>
        <ul className="divide-y divide-neutral-100">
          {posts.map(post => {
            const author = authors.get(post.user_id);
            const postReports = reportsByPost.get(post.id) ?? [];
            return (
              <li key={post.id} className="py-4">
                <div className="flex gap-4">
                  {post.image_url && (
                    <img src={post.image_url} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="whitespace-pre-wrap text-sm text-neutral-800">{post.content}</p>
                    <p className="mt-1 text-xs text-neutral-400">
                      {author?.display_name || 'Unnamed'} · {author?.email ?? post.user_id} ·{' '}
                      {new Date(post.created_at).toLocaleString()} · {post.likes_count} likes ·{' '}
                      {post.comments_count} comments
                    </p>

                    {post.hidden_at && (
                      <p className="mt-2 inline-block rounded-md bg-neutral-100 px-2 py-1 text-xs text-neutral-600">
                        Hidden {new Date(post.hidden_at).toLocaleDateString()}
                        {post.hidden_reason ? ` — ${post.hidden_reason}` : ''}
                      </p>
                    )}

                    {postReports.length > 0 && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-semibold text-amber-900">
                          {postReports.length} open report{postReports.length === 1 ? '' : 's'}
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {postReports.map(r => (
                            <li key={r.id} className="text-xs text-amber-800">
                              {REASON_LABEL[r.reason] ?? r.reason}
                              {r.details ? ` — "${r.details}"` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-end gap-2">
                  {post.hidden_at ? (
                    <form action={unhidePost}>
                      <input type="hidden" name="postId" value={post.id} />
                      <input type="hidden" name="tab" value={tab} />
                      <SubmitButton variant="secondary" pendingLabel="Restoring...">Restore to feed</SubmitButton>
                    </form>
                  ) : (
                    <form action={hidePost} className="flex items-end gap-2">
                      <input type="hidden" name="postId" value={post.id} />
                      <input type="hidden" name="tab" value={tab} />
                      <input
                        name="hiddenReason"
                        className={`${input} w-56`}
                        placeholder="Reason (optional, internal)"
                      />
                      <SubmitButton variant="secondary" pendingLabel="Hiding...">Hide post</SubmitButton>
                    </form>
                  )}

                  {postReports.length > 0 && (
                    <form action={dismissReports}>
                      <input type="hidden" name="postId" value={post.id} />
                      <input type="hidden" name="tab" value={tab} />
                      <SubmitButton variant="secondary" pendingLabel="Dismissing...">
                        Dismiss reports
                      </SubmitButton>
                    </form>
                  )}

                  <form action={deletePost}>
                    <input type="hidden" name="postId" value={post.id} />
                    <input type="hidden" name="tab" value={tab} />
                    <SubmitButton
                      variant="danger"
                      pendingLabel="Deleting..."
                      title="Permanent. Also removes the post's likes, comments and reports."
                    >
                      Delete permanently
                    </SubmitButton>
                  </form>
                </div>
              </li>
            );
          })}

          {posts.length === 0 && (
            <li className="py-10 text-center text-sm text-neutral-400">
              {tab === 'flagged'
                ? 'Nothing flagged. Reports from the app land here.'
                : tab === 'hidden'
                  ? 'No hidden posts.'
                  : 'No posts yet.'}
            </li>
          )}
        </ul>

        <Pagination
          page={page}
          totalPages={totalPages}
          from={from}
          shown={posts.length}
          total={total}
          hrefFor={pageHref}
          noun="posts"
        />
      </Card>
    </div>
  );
}
