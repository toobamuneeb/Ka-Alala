import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createLesson, updateLesson, deleteLesson, moveLesson } from './actions';
import AddLessonFields from './AddLessonFields';
import MediaFields from './MediaFields';
import { updateChapter } from '../actions';
import { Card, Flash, input, label, btnSecondary } from '@/components/ui';
import SubmitButton from '@/components/SubmitButton';
import PendingLink from '@/components/PendingLink';
import type { Chapter, Lesson } from '@/lib/types';

export const dynamic = 'force-dynamic';

const TYPE_BADGE: Record<string, string> = {
  quiz: 'bg-amber-100 text-amber-800',
  video: 'bg-blue-100 text-blue-800',
  audio: 'bg-purple-100 text-purple-800',
};

export default async function ChapterDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; edit?: string }>;
}) {
  await requireRole('content');
  const { id } = await params;
  const query = await searchParams;

  // The chapter and its lessons come back together - two sequential round trips
  // here cost twice the latency for no extra information.
  const db = supabaseAdmin();
  const { data: chapter, error } = await db
    .from('chapters')
    .select('*, lessons(*)')
    .eq('id', id)
    .order('order_index', { ascending: true, referencedTable: 'lessons' })
    .maybeSingle();
  if (error) throw error;
  if (!chapter) notFound();

  const list = ((chapter.lessons ?? []) as Lesson[]);
  const editing = list.find(l => l.id === query.edit);
  const typedChapter = chapter as Chapter;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/chapters" className="text-xs font-medium text-neutral-400 hover:text-neutral-600">
          ← Learning Path
        </Link>
        <h1 className="mt-1 text-xl font-bold text-neutral-900">{typedChapter.title}</h1>
      </div>

      <Flash searchParams={query} />

      <Card title="Chapter details">
        <form action={updateChapter} className="grid max-w-xl gap-4">
          <input type="hidden" name="id" value={typedChapter.id} />
          <div>
            <label className={label}>Title</label>
            <input name="title" required defaultValue={typedChapter.title} className={input} />
          </div>
          <div>
            <label className={label}>Description</label>
            <textarea name="description" rows={2} defaultValue={typedChapter.description ?? ''} className={input} />
          </div>
          <SubmitButton className="w-fit" pendingLabel="Saving...">Save chapter</SubmitButton>
        </form>
      </Card>

      <Card title={`Lessons (${list.length})`}>
        <ul className="divide-y divide-neutral-100">
          {list.map((lesson, i) => (
            <li key={lesson.id} className="flex items-center gap-4 py-3">
              <span className="w-8 shrink-0 text-center text-sm font-bold text-neutral-400">{i + 1}</span>
              <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TYPE_BADGE[lesson.type]}`}>
                {lesson.type}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-neutral-800">{lesson.title}</p>
                <p className="truncate text-xs text-neutral-400">
                  {lesson.xp_value} XP
                  {lesson.duration_seconds ? ` · ${Math.floor(lesson.duration_seconds / 60)}:${String(lesson.duration_seconds % 60).padStart(2, '0')}` : ''}
                  {lesson.media_url ? ' · media linked' : lesson.type !== 'quiz' ? ' · NO MEDIA (app falls back to test file)' : ''}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <form action={moveLesson}>
                  <input type="hidden" name="chapterId" value={id} />
                  <input type="hidden" name="lessonId" value={lesson.id} />
                  <input type="hidden" name="direction" value="up" />
                  <SubmitButton variant="secondary" iconOnly disabled={i === 0} title="Move up">↑</SubmitButton>
                </form>
                <form action={moveLesson}>
                  <input type="hidden" name="chapterId" value={id} />
                  <input type="hidden" name="lessonId" value={lesson.id} />
                  <input type="hidden" name="direction" value="down" />
                  <SubmitButton variant="secondary" iconOnly disabled={i === list.length - 1} title="Move down">↓</SubmitButton>
                </form>
                {lesson.type === 'quiz' && (
                  <PendingLink href={`/lessons/${lesson.id}/quiz`} className={btnSecondary}>Quiz builder</PendingLink>
                )}
                <PendingLink href={`/chapters/${id}?edit=${lesson.id}#edit-lesson`} className={btnSecondary}>Edit</PendingLink>
                <form action={deleteLesson}>
                  <input type="hidden" name="chapterId" value={id} />
                  <input type="hidden" name="lessonId" value={lesson.id} />
                  <SubmitButton variant="danger" pendingLabel="Deleting..." title="Deletes the lesson, its questions and user progress on it">Delete</SubmitButton>
                </form>
              </div>
            </li>
          ))}
          {list.length === 0 && (
            <li className="py-8 text-center text-sm text-neutral-400">No lessons yet - add the first one below.</li>
          )}
        </ul>
      </Card>

      {editing ? (
        <Card
          title={`Edit lesson: ${editing.title}`}
          actions={<PendingLink href={`/chapters/${id}`} className={btnSecondary}>Cancel</PendingLink>}
        >
          <form id="edit-lesson" action={updateLesson} className="grid max-w-xl gap-4">
            <input type="hidden" name="chapterId" value={id} />
            <input type="hidden" name="lessonId" value={editing.id} />
            <div>
              <label className={label}>Title</label>
              <input name="title" required defaultValue={editing.title} className={input} />
            </div>
            <div>
              <label className={label}>Description (text content shown in the lesson)</label>
              <textarea name="description" rows={3} defaultValue={editing.description ?? ''} className={input} />
            </div>
            <div>
              <label className={label}>XP value</label>
              <input name="xpValue" type="number" min={0} required defaultValue={editing.xp_value} className={input} />
            </div>
            {editing.type !== 'quiz' && (
              <MediaFields
                type={editing.type}
                existingUrl={editing.media_url}
                defaultDuration={editing.duration_seconds}
              />
            )}
            <p className="text-xs text-neutral-400">
              Lesson type ({editing.type}) can&apos;t be changed after creation - delete and recreate instead.
            </p>
            <SubmitButton className="w-fit" pendingLabel="Saving...">Save lesson</SubmitButton>
          </form>
        </Card>
      ) : (
        <Card title="Add a lesson">
          <form action={createLesson} className="grid max-w-xl gap-4">
            <input type="hidden" name="chapterId" value={id} />
            <AddLessonFields />
            <SubmitButton className="w-fit" pendingLabel="Creating...">Create lesson</SubmitButton>
          </form>
        </Card>
      )}
    </div>
  );
}
