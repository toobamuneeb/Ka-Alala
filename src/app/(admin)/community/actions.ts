'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

function back(tab: string, key: 'ok' | 'error', message: string): never {
  redirect(`/community?tab=${tab}&${key}=${encodeURIComponent(message)}`);
}

/**
 * Hide a post from every client. Reversible - the row stays, and so do the
 * reports, which is why this is the default action rather than deleting.
 * Any open reports on the post are closed as 'actioned' in the same step.
 */
export async function hidePost(formData: FormData) {
  const admin = await requireRole('community');
  const postId = String(formData.get('postId'));
  const tab = String(formData.get('tab') ?? 'flagged');
  const reason = String(formData.get('hiddenReason') ?? '').trim() || null;

  const db = supabaseAdmin();
  const { error } = await db
    .from('posts')
    .update({ hidden_at: new Date().toISOString(), hidden_by: admin.id, hidden_reason: reason })
    .eq('id', postId);
  if (error) back(tab, 'error', error.message);

  const { error: reportError } = await db
    .from('post_reports')
    .update({ status: 'actioned', resolved_at: new Date().toISOString(), resolved_by: admin.id })
    .eq('post_id', postId)
    .eq('status', 'open');
  if (reportError) back(tab, 'error', reportError.message);

  revalidatePath('/community');
  back(tab, 'ok', 'Post hidden. It is no longer visible in the app.');
}

/** Put a hidden post back in the feed. */
export async function unhidePost(formData: FormData) {
  await requireRole('community');
  const postId = String(formData.get('postId'));
  const tab = String(formData.get('tab') ?? 'hidden');

  const { error } = await supabaseAdmin()
    .from('posts')
    .update({ hidden_at: null, hidden_by: null, hidden_reason: null })
    .eq('id', postId);
  if (error) back(tab, 'error', error.message);

  revalidatePath('/community');
  back(tab, 'ok', 'Post restored to the feed.');
}

/**
 * Permanently remove a post. Its likes, comments, pins and reports all go with
 * it (every one of those tables cascades on posts.id) - there is no undo.
 */
export async function deletePost(formData: FormData) {
  await requireRole('community');
  const postId = String(formData.get('postId'));
  const tab = String(formData.get('tab') ?? 'flagged');

  const { error } = await supabaseAdmin().from('posts').delete().eq('id', postId);
  if (error) back(tab, 'error', error.message);

  revalidatePath('/community');
  back(tab, 'ok', 'Post deleted permanently, along with its likes and comments.');
}

/** Close the open reports on a post without touching the post itself. */
export async function dismissReports(formData: FormData) {
  const admin = await requireRole('community');
  const postId = String(formData.get('postId'));
  const tab = String(formData.get('tab') ?? 'flagged');

  const { error } = await supabaseAdmin()
    .from('post_reports')
    .update({ status: 'dismissed', resolved_at: new Date().toISOString(), resolved_by: admin.id })
    .eq('post_id', postId)
    .eq('status', 'open');
  if (error) back(tab, 'error', error.message);

  revalidatePath('/community');
  back(tab, 'ok', 'Reports dismissed. The post stays in the feed.');
}
