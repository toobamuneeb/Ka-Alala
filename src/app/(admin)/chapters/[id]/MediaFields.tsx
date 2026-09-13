'use client';

import { useRef, useState } from 'react';
import { input, label } from '@/components/ui';

/**
 * Reads a media file's duration in the browser by letting a throwaway
 * <video>/<audio> element load just its metadata. Nothing is played and
 * nothing is uploaded - this runs before the form is even submitted.
 */
function probeDuration(src: string, kind: 'video' | 'audio'): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = 'metadata';

    const timer = setTimeout(() => finish(() => reject(new Error('timeout'))), 20000);

    function finish(done: () => void) {
      clearTimeout(timer);
      el.onloadedmetadata = null;
      el.ontimeupdate = null;
      el.onerror = null;
      el.removeAttribute('src');
      el.load();
      done();
    }

    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) {
        const seconds = Math.round(el.duration);
        finish(() => resolve(seconds));
        return;
      }
      // Streamed webm/ogg often report Infinity until forced to seek to the end.
      el.ontimeupdate = () => {
        if (Number.isFinite(el.duration) && el.duration > 0) {
          const seconds = Math.round(el.duration);
          finish(() => resolve(seconds));
        }
      };
      el.currentTime = 1e101;
    };

    el.onerror = () => finish(() => reject(new Error('unreadable')));
    el.src = src;
  });
}

function mmss(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * File + link + duration inputs for a video/audio lesson. The duration box
 * fills itself in from whichever source the admin picks, and stays editable
 * so an odd reading can always be corrected by hand.
 */
export default function MediaFields({
  type,
  existingUrl,
  defaultDuration,
}: {
  type: 'video' | 'audio';
  existingUrl?: string | null;
  defaultDuration?: number | null;
}) {
  const [duration, setDuration] = useState(defaultDuration != null ? String(defaultDuration) : '');
  const [status, setStatus] = useState<'idle' | 'reading' | 'done' | 'failed'>('idle');
  // Only the latest probe may write to state - a slow URL must not overwrite
  // the duration read from a file the admin picked afterwards.
  const probeId = useRef(0);

  async function runProbe(src: string, revoke: boolean) {
    const id = ++probeId.current;
    setStatus('reading');
    try {
      const seconds = await probeDuration(src, type);
      if (probeId.current !== id) return;
      setDuration(String(seconds));
      setStatus('done');
    } catch {
      if (probeId.current !== id) return;
      setStatus('failed');
    } finally {
      if (revoke) URL.revokeObjectURL(src);
    }
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      probeId.current++;
      setStatus('idle');
      return;
    }
    runProbe(URL.createObjectURL(file), true);
  }

  function onUrlBlur(e: React.FocusEvent<HTMLInputElement>) {
    const url = e.target.value.trim();
    if (!/^https?:\/\//i.test(url)) return;
    runProbe(url, false);
  }

  const parsed = parseInt(duration, 10);

  return (
    <>
      <div>
        <label className={label}>
          Upload {type} file {existingUrl ? '(replaces current)' : ''}
        </label>
        <input
          type="file"
          name="mediaFile"
          accept={type === 'video' ? 'video/*' : 'audio/*'}
          onChange={onFileChange}
          className={input}
        />
        <p className="mt-1 text-xs text-neutral-400">
          Large files can take a few minutes. The submit button spins and stays
          disabled until the upload finishes - don&apos;t close the tab.
        </p>
      </div>

      <div>
        <label className={label}>...or paste a media link (http/https)</label>
        <input name="mediaUrl" className={input} placeholder="https://..." onBlur={onUrlBlur} />
        {existingUrl && (
          <p className="mt-1 truncate text-xs text-neutral-400">
            Current:{' '}
            <a href={existingUrl} target="_blank" rel="noreferrer" className="underline">
              {existingUrl}
            </a>
          </p>
        )}
      </div>

      <div>
        <label className={label}>Duration (seconds - shown as m:ss in the app)</label>
        <input
          name="durationSeconds"
          type="number"
          min={0}
          value={duration}
          onChange={e => {
            setDuration(e.target.value);
            setStatus('idle');
          }}
          className={input}
          placeholder="Filled in automatically when you pick a file"
        />
        <p className="mt-1 text-xs text-neutral-400">
          {status === 'reading' && 'Reading duration from the file...'}
          {status === 'done' && Number.isFinite(parsed) && (
            <span className="text-green-600">Detected {mmss(parsed)} - edit it if that looks wrong.</span>
          )}
          {status === 'failed' && (
            <span className="text-amber-600">
              Couldn&apos;t read the duration from that {type}. Please type it in.
            </span>
          )}
          {status === 'idle' &&
            (Number.isFinite(parsed) && parsed > 0
              ? `${mmss(parsed)} in the app.`
              : 'Detected automatically from the file or link you choose.')}
        </p>
      </div>
    </>
  );
}
