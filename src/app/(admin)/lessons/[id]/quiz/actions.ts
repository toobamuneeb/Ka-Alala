'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { QuizOption } from '@/lib/types';

const OPTION_IDS = ['a', 'b', 'c', 'd'] as const;

function fail(lessonId: string, message: string): never {
  redirect(`/lessons/${lessonId}/quiz?error=${encodeURIComponent(message)}`);
}

/** Build the options jsonb in exactly the shape the mobile QuizCard expects. */
function parseOptions(lessonId: string, formData: FormData): { options: QuizOption[]; correct: string } {
  const options: QuizOption[] = OPTION_IDS.map(id => ({
    id,
    label: id.toUpperCase(),
    text: String(formData.get(`option_${id}`) ?? '').trim(),
  }));
  if (options.some(o => !o.text)) fail(lessonId, 'All four options need text.');

  const correct = String(formData.get('correct') ?? '');
  if (!OPTION_IDS.includes(correct as (typeof OPTION_IDS)[number])) {
    fail(lessonId, 'Pick which option is correct.');
  }
  return { options, correct };
}

export async function createQuestion(formData: FormData) {
  await requireRole('content');
  const lessonId = String(formData.get('lessonId'));
  const question = String(formData.get('question') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || null;
  if (!question) fail(lessonId, 'Question text is required.');

  const { options, correct } = parseOptions(lessonId, formData);

  const db = supabaseAdmin();
  const { data: last } = await db
    .from('quiz_questions')
    .select('order_index')
    .eq('lesson_id', lessonId)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  const order_index = (last?.order_index ?? -1) + 1;

  const { error } = await db.from('quiz_questions').insert({
    lesson_id: lessonId,
    question,
    category,
    options,
    correct_answer: correct,
    order_index,
  });
  if (error) fail(lessonId, error.message);

  revalidatePath(`/lessons/${lessonId}/quiz`);
  redirect(`/lessons/${lessonId}/quiz?ok=` + encodeURIComponent('Question added.'));
}

export async function updateQuestion(formData: FormData) {
  await requireRole('content');
  const lessonId = String(formData.get('lessonId'));
  const questionId = String(formData.get('questionId'));
  const question = String(formData.get('question') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || null;
  if (!question) fail(lessonId, 'Question text is required.');

  const { options, correct } = parseOptions(lessonId, formData);

  const { error } = await supabaseAdmin()
    .from('quiz_questions')
    .update({ question, category, options, correct_answer: correct })
    .eq('id', questionId);
  if (error) fail(lessonId, error.message);

  revalidatePath(`/lessons/${lessonId}/quiz`);
  redirect(`/lessons/${lessonId}/quiz?ok=` + encodeURIComponent('Question updated.'));
}

export async function deleteQuestion(formData: FormData) {
  await requireRole('content');
  const lessonId = String(formData.get('lessonId'));
  const questionId = String(formData.get('questionId'));

  const { error } = await supabaseAdmin().from('quiz_questions').delete().eq('id', questionId);
  if (error) fail(lessonId, error.message);

  revalidatePath(`/lessons/${lessonId}/quiz`);
  redirect(`/lessons/${lessonId}/quiz?ok=` + encodeURIComponent('Question deleted.'));
}
