import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createChapter, deleteChapter, moveChapter } from './actions';
import { Card, Flash, input, label, btnSecondary } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';
import PendingLink from '@/components/PendingLink';
import type { Chapter } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function ChaptersPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  await requireRole('content');
  const params = await searchParams;

  const db = supabaseAdmin();
  const { data: chapters, error } = await db
    .from('chapters')
    .select('*')
    .order('order_index', { ascending: true });
  if (error) throw error;

  // Lesson counts per chapter in one query.
  const { data: lessonRows } = await db.from('lessons').select('chapter_id');
  const lessonCount = new Map<string, number>();
  (lessonRows ?? []).forEach(l => lessonCount.set(l.chapter_id, (lessonCount.get(l.chapter_id) ?? 0) + 1));

  const list = (chapters ?? []) as Chapter[];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">Learning Path</h1>
        <p className="mt-1 text-sm text-neutral-500">
          Chapters unlock in this order in the app - a chapter opens once the one before it is fully completed.
        </p>
      </div>

      <Flash searchParams={params} />

      <Card title={`Chapters (${list.length})`}>
        <ul className="divide-y divide-neutral-100">
          {list.map((chapter, i) => (
            <li key={chapter.id} className="flex items-center gap-4 py-3">
              <span className="w-8 shrink-0 text-center text-sm font-bold text-neutral-400">{i + 1}</span>

              <div className="min-w-0 flex-1">
                <Link href={`/chapters/${chapter.id}`} className="text-sm font-semibold text-red-800 hover:underline">
                  {chapter.title}
                </Link>
                <p className="truncate text-xs text-neutral-400">
                  {lessonCount.get(chapter.id) ?? 0} lessons
                  {chapter.description ? ` · ${chapter.description}` : ''}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <form action={moveChapter}>
                  <input type="hidden" name="id" value={chapter.id} />
                  <input type="hidden" name="direction" value="up" />
                  <SubmitButton variant="secondary" iconOnly disabled={i === 0} title="Move up">↑</SubmitButton>
                </form>
                <form action={moveChapter}>
                  <input type="hidden" name="id" value={chapter.id} />
                  <input type="hidden" name="direction" value="down" />
                  <SubmitButton variant="secondary" iconOnly disabled={i === list.length - 1} title="Move down">↓</SubmitButton>
                </form>
                <PendingLink href={`/chapters/${chapter.id}`} className={btnSecondary}>Manage lessons</PendingLink>
                <form action={deleteChapter}>
                  <input type="hidden" name="id" value={chapter.id} />
                  <SubmitButton variant="danger" pendingLabel="Deleting..." title="Deletes the chapter and ALL its lessons">Delete</SubmitButton>
                </form>
              </div>
            </li>
          ))}
          {list.length === 0 && (
            <li className="py-8 text-center text-sm text-neutral-400">No chapters yet - create the first one below.</li>
          )}
        </ul>
      </Card>

      <Card title="Add a chapter">
        <form action={createChapter} className="grid max-w-xl gap-4">
          <div>
            <label className={label}>Title</label>
            <input name="title" required className={input} placeholder="e.g. Greetings & Aloha" />
          </div>
          <div>
            <label className={label}>Description (optional)</label>
            <textarea name="description" rows={2} className={input} placeholder="Shown to learners as the chapter summary" />
          </div>
          <SubmitButton className="w-fit" pendingLabel="Creating...">Create chapter</SubmitButton>
        </form>
      </Card>
    </div>
  );
}
