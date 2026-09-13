'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { LessonType } from '@/lib/types';

const BUCKET_FOR_TYPE: Record<string, string> = {
  video: 'chapter_video',
  audio: 'chapter_audio',
};

function fail(chapterId: string, message: string): never {
  redirect(`/chapters/${chapterId}?error=${encodeURIComponent(message)}`);
}

/**
 * Resolve the lesson's media_url from the form: an uploaded file wins over a
 * pasted link; empty inputs mean "keep the existing value" (edit) / null (create).
 */
async function resolveMediaUrl(
  chapterId: string,
  type: LessonType,
  formData: FormData,
  existing: string | null,
): Promise<string | null> {
  if (type === 'quiz') return null; // quizzes have no media

  const file = formData.get('mediaFile');
  const pastedUrl = String(formData.get('mediaUrl') ?? '').trim();

  if (file instanceof File && file.size > 0) {
    const bucket = BUCKET_FOR_TYPE[type];
    const ext = (file.name.split('.').pop() || (type === 'video' ? 'mp4' : 'mp3')).toLowerCase();
    const path = `${chapterId}/${Date.now()}.${ext}`;

    const bytes = await file.arrayBuffer();
    const { error } = await supabaseAdmin()
      .storage.from(bucket)
      .upload(path, bytes, { contentType: file.type || undefined, upsert: false });
    if (error) fail(chapterId, `Upload failed: ${error.message}`);

    const { data } = supabaseAdmin().storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  if (pastedUrl) {
    if (!/^https?:\/\//i.test(pastedUrl)) fail(chapterId, 'Media link must be an http(s) URL.');
    return pastedUrl;
  }

  return existing;
}

export async function createLesson(formData: FormData) {
  await requireRole('content');
  const chapterId = String(formData.get('chapterId'));
  const title = String(formData.get('title') ?? '').trim();
  const type = String(formData.get('type')) as LessonType;
  const description = String(formData.get('description') ?? '').trim() || null;
  const xpValue = parseInt(String(formData.get('xpValue') ?? '20'), 10);
  const durationRaw = String(formData.get('durationSeconds') ?? '').trim();
  const duration_seconds = durationRaw ? parseInt(durationRaw, 10) : null;

  if (!title) fail(chapterId, 'Lesson title is required.');
  if (!['quiz', 'video', 'audio'].includes(type)) fail(chapterId, 'Invalid lesson type.');
  if (!Number.isFinite(xpValue) || xpValue < 0) fail(chapterId, 'XP must be a non-negative number.');

  const db = supabaseAdmin();
  const { data: last } = await db
    .from('lessons')
    .select('order_index')
    .eq('chapter_id', chapterId)
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  const order_index = (last?.order_index ?? -1) + 1;

  const media_url = await resolveMediaUrl(chapterId, type, formData, null);

  const { error } = await db.from('lessons').insert({
    chapter_id: chapterId,
    type,
    title,
    description,
    xp_value: xpValue,
    duration_seconds,
    media_url,
    order_index,
  });
  if (error) fail(chapterId, error.message);

  revalidatePath(`/chapters/${chapterId}`);
  redirect(`/chapters/${chapterId}?ok=` + encodeURIComponent('Lesson created.'));
}

export async function updateLesson(formData: FormData) {
  await requireRole('content');
  const chapterId = String(formData.get('chapterId'));
  const lessonId = String(formData.get('lessonId'));
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const xpValue = parseInt(String(formData.get('xpValue') ?? '20'), 10);
  const durationRaw = String(formData.get('durationSeconds') ?? '').trim();
  const duration_seconds = durationRaw ? parseInt(durationRaw, 10) : null;

  if (!title) fail(chapterId, 'Lesson title is required.');
  if (!Number.isFinite(xpValue) || xpValue < 0) fail(chapterId, 'XP must be a non-negative number.');

  const db = supabaseAdmin();
  const { data: existing, error: loadError } = await db
    .from('lessons')
    .select('type, media_url')
    .eq('id', lessonId)
    .single();
  if (loadError) fail(chapterId, loadError.message);

  // Type is immutable after creation: quiz questions / media are type-specific,
  // and completed-progress semantics would silently change. Delete + recreate instead.
  const media_url = await resolveMediaUrl(chapterId, existing.type, formData, existing.media_url);

  const { error } = await db
    .from('lessons')
    .update({ title, description, xp_value: xpValue, duration_seconds, media_url })
    .eq('id', lessonId);
  if (error) fail(chapterId, error.message);

  revalidatePath(`/chapters/${chapterId}`);
  redirect(`/chapters/${chapterId}?ok=` + encodeURIComponent('Lesson updated.'));
}

export async function deleteLesson(formData: FormData) {
  await requireRole('content');
  const chapterId = String(formData.get('chapterId'));
  const lessonId = String(formData.get('lessonId'));

  const { error } = await supabaseAdmin().from('lessons').delete().eq('id', lessonId);
  if (error) fail(chapterId, error.message);

  revalidatePath(`/chapters/${chapterId}`);
  redirect(`/chapters/${chapterId}?ok=` + encodeURIComponent('Lesson deleted.'));
}

export async function moveLesson(formData: FormData) {
  await requireRole('content');
  const chapterId = String(formData.get('chapterId'));
  const lessonId = String(formData.get('lessonId'));
  const direction = String(formData.get('direction'));

  const db = supabaseAdmin();
  const { data: lessons, error } = await db
    .from('lessons')
    .select('id, order_index')
    .eq('chapter_id', chapterId)
    .order('order_index', { ascending: true });
  if (error || !lessons) fail(chapterId, error?.message ?? 'Failed to load lessons.');

  const idx = lessons.findIndex(l => l.id === lessonId);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx === -1 || targetIdx < 0 || targetIdx >= lessons.length) {
    return; // nothing to do at the edges
  }

  const a = lessons[idx];
  const b = lessons[targetIdx];
  const parking = -1 - Math.max(a.order_index, b.order_index);

  const steps = [
    db.from('lessons').update({ order_index: parking }).eq('id', a.id),
    db.from('lessons').update({ order_index: a.order_index }).eq('id', b.id),
    db.from('lessons').update({ order_index: b.order_index }).eq('id', a.id),
  ];
  for (const step of steps) {
    const { error: e } = await step;
    if (e) fail(chapterId, e.message);
  }

  // No redirect: a server action that redirects to the route it's already on
  // makes Next throw away the whole RSC tree and navigate afresh - which is the
  // full-page flash (and lost scroll position) you see on every reorder.
  // revalidatePath alone re-renders the segment and patches it in place.
  revalidatePath(`/chapters/${chapterId}`);
}
