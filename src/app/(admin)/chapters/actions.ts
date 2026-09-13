'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createChapter(formData: FormData) {
  await requireRole('content');
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  if (!title) fail('/chapters', 'Chapter title is required.');

  const db = supabaseAdmin();
  // Append at the end of the path.
  const { data: last } = await db
    .from('chapters')
    .select('order_index')
    .order('order_index', { ascending: false })
    .limit(1)
    .maybeSingle();
  const order_index = (last?.order_index ?? -1) + 1;

  const { error } = await db.from('chapters').insert({ title, description, order_index });
  if (error) fail('/chapters', error.message);

  revalidatePath('/chapters');
  redirect('/chapters?ok=' + encodeURIComponent('Chapter created.'));
}

export async function updateChapter(formData: FormData) {
  await requireRole('content');
  const id = String(formData.get('id'));
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  if (!title) fail('/chapters', 'Chapter title is required.');

  const { error } = await supabaseAdmin().from('chapters').update({ title, description }).eq('id', id);
  if (error) fail('/chapters', error.message);

  revalidatePath('/chapters');
  redirect('/chapters?ok=' + encodeURIComponent('Chapter updated.'));
}

export async function deleteChapter(formData: FormData) {
  await requireRole('content');
  const id = String(formData.get('id'));

  // Cascades to lessons -> quiz_questions/lesson_progress via FKs.
  const { error } = await supabaseAdmin().from('chapters').delete().eq('id', id);
  if (error) fail('/chapters', error.message);

  revalidatePath('/chapters');
  redirect('/chapters?ok=' + encodeURIComponent('Chapter deleted.'));
}

/**
 * Swap this chapter's order_index with its neighbor. order_index is unique,
 * so the swap goes through a temporary parking value.
 */
export async function moveChapter(formData: FormData) {
  await requireRole('content');
  const id = String(formData.get('id'));
  const direction = String(formData.get('direction')); // 'up' | 'down'

  const db = supabaseAdmin();
  const { data: chapters, error } = await db
    .from('chapters')
    .select('id, order_index')
    .order('order_index', { ascending: true });
  if (error || !chapters) fail('/chapters', error?.message ?? 'Failed to load chapters.');

  const idx = chapters.findIndex(c => c.id === id);
  const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (idx === -1 || targetIdx < 0 || targetIdx >= chapters.length) {
    return; // nothing to do at the edges
  }

  const a = chapters[idx];
  const b = chapters[targetIdx];
  const parking = -1 - Math.max(a.order_index, b.order_index); // guaranteed unused (< 0)

  const steps = [
    db.from('chapters').update({ order_index: parking }).eq('id', a.id),
    db.from('chapters').update({ order_index: a.order_index }).eq('id', b.id),
    db.from('chapters').update({ order_index: b.order_index }).eq('id', a.id),
  ];
  for (const step of steps) {
    const { error: e } = await step;
    if (e) fail('/chapters', e.message);
  }

  // No redirect: a server action that redirects to the route it's already on
  // makes Next throw away the whole RSC tree and navigate afresh - which is the
  // full-page flash (and lost scroll position) you see on every reorder.
  // revalidatePath alone re-renders the segment and patches it in place.
  revalidatePath('/chapters');
}
