'use client';

import { useState } from 'react';
import MediaFields from './MediaFields';
import { input, label } from '@/components/ui';
import type { LessonType } from '@/lib/types';

const HINT: Record<LessonType, string> = {
  video: 'Upload an MP4 or paste a link. The duration is read from the file automatically.',
  audio: 'Upload an MP3 or paste a link. The duration is read from the file automatically.',
  quiz: 'Quizzes have no media or duration - add the questions afterwards in the Quiz builder.',
};

/**
 * Type picker for the add-lesson form. The media/duration inputs only exist
 * while a media type is selected, so a quiz can't be created carrying an
 * upload or a duration the app would never use.
 *
 * `key={type}` remounts MediaFields on every switch, clearing a file that was
 * chosen for the previous type along with its detected duration.
 */
export default function AddLessonFields() {
  const [type, setType] = useState<LessonType>('video');

  return (
    <>
      <div>
        <label className={label}>Type</label>
        <select
          name="type"
          className={input}
          value={type}
          onChange={e => setType(e.target.value as LessonType)}
        >
          <option value="video">Video</option>
          <option value="audio">Audio</option>
          <option value="quiz">Quiz</option>
        </select>
        <p className="mt-1 text-xs text-neutral-400">{HINT[type]}</p>
      </div>

      <div>
        <label className={label}>Title</label>
        <input name="title" required className={input} placeholder="e.g. Listen: Everyday Aloha" />
      </div>

      <div>
        <label className={label}>Description (text content shown in the lesson)</label>
        <textarea name="description" rows={3} className={input} />
      </div>

      <div>
        <label className={label}>XP value</label>
        <input name="xpValue" type="number" min={0} defaultValue={20} className={input} />
      </div>

      {type !== 'quiz' && <MediaFields key={type} type={type} />}
    </>
  );
}
