import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { createQuestion, updateQuestion, deleteQuestion } from './actions';
import { Card, Flash, input, label, btnSecondary } from '@/components/ui';
import type { Lesson, QuizQuestion } from '@/lib/types';
import SubmitButton from '@/components/SubmitButton';
import PendingLink from '@/components/PendingLink';

export const dynamic = 'force-dynamic';

const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;

function QuestionForm({
  action,
  lessonId,
  existing,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  lessonId: string;
  existing?: QuizQuestion;
  submitLabel: string;
}) {
  return (
    <form action={action} className="grid max-w-2xl gap-4">
      <input type="hidden" name="lessonId" value={lessonId} />
      {existing && <input type="hidden" name="questionId" value={existing.id} />}

      <div>
        <label className={label}>Question</label>
        <input name="question" required defaultValue={existing?.question ?? ''} className={input}
          placeholder='e.g. What does "Aloha" mean?' />
      </div>
      <div>
        <label className={label}>Category (optional, shown above the question)</label>
        <input name="category" defaultValue={existing?.category ?? ''} className={input} placeholder="e.g. Greetings" />
      </div>

      <div className="grid gap-3">
        {OPTION_IDS.map(id => {
          const existingOption = existing?.options.find(o => o.id === id);
          return (
            <div key={id} className="flex items-center gap-3">
              <label className="flex shrink-0 items-center gap-1.5 text-sm text-neutral-600">
                <input
                  type="radio"
                  name="correct"
                  value={id}
                  defaultChecked={existing ? existing.correct_answer === id : id === 'a'}
                  className="accent-red-700"
                />
                <span className="w-4 font-bold">{id.toUpperCase()}</span>
              </label>
              <input
                name={`option_${id}`}
                required
                defaultValue={existingOption?.text ?? ''}
                className={input}
                placeholder={`Option ${id.toUpperCase()}`}
              />
            </div>
          );
        })}
        <p className="text-xs text-neutral-400">Select the radio button next to the correct answer.</p>
      </div>

      <SubmitButton className="w-fit" pendingLabel="Saving...">{submitLabel}</SubmitButton>
    </form>
  );
}

export default async function QuizBuilderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; edit?: string }>;
}) {
  await requireRole('content');
  const { id } = await params;
  const query = await searchParams;

  const db = supabaseAdmin();
  const { data: lesson } = await db
    .from('lessons')
    .select('*, chapters(title)')
    .eq('id', id)
    .maybeSingle();
  if (!lesson || lesson.type !== 'quiz') notFound();

  const { data: questions, error } = await db
    .from('quiz_questions')
    .select('*')
    .eq('lesson_id', id)
    .order('order_index', { ascending: true });
  if (error) throw error;

  const list = (questions ?? []) as QuizQuestion[];
  const editing = list.find(q => q.id === query.edit);
  const typedLesson = lesson as Lesson & { chapters: { title: string } | null };

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/chapters/${typedLesson.chapter_id}`}
          className="text-xs font-medium text-neutral-400 hover:text-neutral-600"
        >
          ← {typedLesson.chapters?.title ?? 'Chapter'}
        </Link>
        <h1 className="mt-1 text-xl font-bold text-neutral-900">Quiz builder: {typedLesson.title}</h1>
        <p className="mt-1 text-sm text-neutral-500">
          {list.length} questions · learners earn up to {typedLesson.xp_value} XP (score-proportional, first attempt only).
          Correct answers are never sent to the app - scoring happens server-side.
        </p>
      </div>

      <Flash searchParams={query} />

      <Card title="Questions">
        <ul className="divide-y divide-neutral-100">
          {list.map((q, i) => (
            <li key={q.id} className="py-3">
              <div className="flex items-start gap-4">
                <span className="w-8 shrink-0 text-center text-sm font-bold text-neutral-400">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-neutral-800">{q.question}</p>
                  <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
                    {q.options.map(o => (
                      <p
                        key={o.id}
                        className={`text-xs ${
                          o.id === q.correct_answer ? 'font-bold text-green-700' : 'text-neutral-500'
                        }`}
                      >
                        {o.label}. {o.text} {o.id === q.correct_answer ? '✓' : ''}
                      </p>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <PendingLink href={`/lessons/${id}/quiz?edit=${q.id}#question-form`} className={btnSecondary}>Edit</PendingLink>
                  <form action={deleteQuestion}>
                    <input type="hidden" name="lessonId" value={id} />
                    <input type="hidden" name="questionId" value={q.id} />
                    <SubmitButton variant="danger" pendingLabel="Deleting...">Delete</SubmitButton>
                  </form>
                </div>
              </div>
            </li>
          ))}
          {list.length === 0 && (
            <li className="py-8 text-center text-sm text-neutral-400">
              No questions yet - the app will show placeholder questions until you add some.
            </li>
          )}
        </ul>
      </Card>

      <div id="question-form">
        {editing ? (
          <Card
            title="Edit question"
            actions={<PendingLink href={`/lessons/${id}/quiz`} className={btnSecondary}>Cancel</PendingLink>}
          >
            <QuestionForm action={updateQuestion} lessonId={id} existing={editing} submitLabel="Save question" />
          </Card>
        ) : (
          <Card title="Add a question">
            <QuestionForm action={createQuestion} lessonId={id} submitLabel="Add question" />
          </Card>
        )}
      </div>
    </div>
  );
}
