'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';

function fail(message: string): never {
  redirect(`/badges?error=${encodeURIComponent(message)}`);
}

async function resolveIconUrl(formData: FormData, existing: string | null): Promise<string | null> {
  const file = formData.get('iconFile');
  if (file instanceof File && file.size > 0) {
    const ext = (file.name.split('.').pop() || 'png').toLowerCase();
    const path = `${Date.now()}.${ext}`;
    const bytes = await file.arrayBuffer();

    const { error } = await supabaseAdmin()
      .storage.from('badge_url')
      .upload(path, bytes, { contentType: file.type || 'image/png' });
    if (error) fail(`Icon upload failed: ${error.message}`);

    const { data } = supabaseAdmin().storage.from('badge_url').getPublicUrl(path);
    return data.publicUrl;
  }
  return existing;
}

/**
 * Every badge in this panel unlocks on total XP, and the app awards purely by
 * requirement_value - two badges on the same number would both fire at once,
 * so the tier has to be unique.
 *
 * `badges.code` is unique and we derive it as `xp_<value>`, but that only
 * catches inserts whose neighbours follow the same convention, and it never
 * fires on update. This checks the value itself, and can name the badge that
 * is already sitting on the tier.
 */
async function assertXpTierFree(requirement_value: number, excludeId?: string) {
  let query = supabaseAdmin()
    .from('badges')
    .select('id, title')
    .eq('requirement_type', 'total_xp')
    .eq('requirement_value', requirement_value);

  if (excludeId) query = query.neq('id', excludeId);

  const { data, error } = await query.limit(1);
  if (error) fail(error.message);
  if (data && data.length > 0) {
    fail(
      `"${data[0].title}" already unlocks at ${requirement_value} XP. ` +
        'Pick a different XP value, or edit that badge instead.',
    );
  }
}

function parseCommon(formData: FormData) {
  const title = String(formData.get('title') ?? '').trim();
  const description = String(formData.get('description') ?? '').trim() || null;
  const bg_color = String(formData.get('bgColor') ?? '#FFEBEE').trim() || '#FFEBEE';
  const requirement_value = parseInt(String(formData.get('requirementValue') ?? ''), 10);
  const is_active = formData.get('isActive') === 'on';

  if (!title) fail('Badge title is required.');
  if (!Number.isFinite(requirement_value) || requirement_value <= 0) {
    fail('XP requirement must be a positive number.');
  }
  return { title, description, bg_color, requirement_value, is_active };
}

export async function createBadge(formData: FormData) {
  await requireRole('content');
  const common = parseCommon(formData);
  // Before resolveIconUrl - a rejected badge must not leave its upload behind.
  await assertXpTierFree(common.requirement_value);
  const icon_url = await resolveIconUrl(formData, null);
  // Stable unique code derived from the XP tier (matches the seed convention).
  const code = `xp_${common.requirement_value}`;

  const { error } = await supabaseAdmin().from('badges').insert({
    ...common,
    code,
    icon_url,
    // icon_key is legacy (bundled app icons are no longer used as fallback)
    // but the column is NOT NULL, so store a harmless placeholder.
    icon_key: 'BADGE',
    requirement_type: 'total_xp',
  });
  if (error) {
    fail(error.code === '23505' ? `A badge for ${common.requirement_value} XP already exists.` : error.message);
  }

  revalidatePath('/badges');
  redirect('/badges?ok=' + encodeURIComponent('Badge created.'));
}

export async function updateBadge(formData: FormData) {
  await requireRole('content');
  const id = String(formData.get('id'));
  const common = parseCommon(formData);
  await assertXpTierFree(common.requirement_value, id);

  const db = supabaseAdmin();
  const { data: existing, error: loadError } = await db
    .from('badges')
    .select('icon_url')
    .eq('id', id)
    .single();
  if (loadError) fail(loadError.message);

  const icon_url = await resolveIconUrl(formData, existing.icon_url);

  // Keep `code` matching the tier, the way createBadge writes it - otherwise a
  // badge edited from 150 to 200 XP keeps a stale `xp_150` code and the unique
  // index stops being a backstop for the tier at all.
  const code = `xp_${common.requirement_value}`;

  const { error } = await db.from('badges').update({ ...common, code, icon_url }).eq('id', id);
  if (error) {
    fail(
      error.code === '23505'
        ? `Another badge already uses the ${common.requirement_value} XP tier.`
        : error.message,
    );
  }

  revalidatePath('/badges');
  redirect('/badges?ok=' + encodeURIComponent('Badge updated.'));
}

export async function deleteBadge(formData: FormData) {
  await requireRole('content');
  const id = String(formData.get('id'));

  // Deleting cascades into user_badges (earned history is lost). Deactivating
  // (is_active=false via Edit) is usually the better call - the button label warns.
  const { error } = await supabaseAdmin().from('badges').delete().eq('id', id);
  if (error) fail(error.message);

  revalidatePath('/badges');
  redirect('/badges?ok=' + encodeURIComponent('Badge deleted.'));
}
