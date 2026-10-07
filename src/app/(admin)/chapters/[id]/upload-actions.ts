'use server';

import { requireRole } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { LessonType } from '@/lib/types';

const BUCKET_FOR_TYPE: Record<string, string> = {
  video: 'chapter_video',
  audio: 'chapter_audio',
};

export type UploadTarget =
  | { ok: true; bucket: string; path: string; publicUrl: string }
  | { ok: false; error: string };

/**
 * Reserve the storage key the browser should upload to, and hand back the URL
 * the lesson row will store.
 *
 * No bytes cross the Next server. They can't: a server action fails to parse a
 * multipart body over ~10MB whatever `serverActions.bodySizeLimit` says
 * (measured - 8MB parses, 10MB dies with "Unexpected end of form"). The browser
 * uploads straight to Storage instead, resumably, as the signed-in admin.
 *
 * Naming stays here rather than in the client so every object keeps the
 * `{chapterId}/{timestamp}.{ext}` shape the rest of the panel expects.
 */
export async function createUploadTarget(
  chapterId: string,
  type: LessonType,
  filename: string,
): Promise<UploadTarget> {
  await requireRole('content');

  const bucket = BUCKET_FOR_TYPE[type];
  if (!bucket) return { ok: false, error: 'Only video and audio lessons take an upload.' };

  const ext = (filename.split('.').pop() || (type === 'video' ? 'mp4' : 'mp3'))
    .toLowerCase()
    // Goes straight into the object key, so keep it a plain suffix.
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  const path = `${chapterId}/${Date.now()}.${ext || 'bin'}`;

  return {
    ok: true,
    bucket,
    path,
    publicUrl: supabaseAdmin().storage.from(bucket).getPublicUrl(path).data.publicUrl,
  };
}
