"use client";

import { useRef, useState } from "react";
import { input, label } from "@/components/ui";
import { useLessonForm } from "./LessonForm";
import {
  canCompressInBrowser,
  compressVideo,
  type CompressProgress,
} from "@/lib/video/compress";

/**

 */
function probeDuration(src: string, kind: "video" | "audio"): Promise<number> {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind);
    el.preload = "metadata";

    const timer = setTimeout(
      () => finish(() => reject(new Error("timeout"))),
      20000,
    );

    function finish(done: () => void) {
      clearTimeout(timer);
      el.onloadedmetadata = null;
      el.ontimeupdate = null;
      el.onerror = null;
      el.removeAttribute("src");
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

    el.onerror = () => finish(() => reject(new Error("unreadable")));
    el.src = src;
  });
}

function mmss(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function prettySize(bytes: number) {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * File + link + duration inputs for a video/audio lesson.
 *
 * Picking a file only stages it: the duration is read locally and the file is
 * handed to LessonForm, which uploads it when the form is submitted. Nothing
 * leaves the browser until then.
 */
export default function MediaFields({
  type,
  existingUrl,
  defaultDuration,
}: {
  type: "video" | "audio";
  existingUrl?: string | null;
  defaultDuration?: number | null;
}) {
  const { file, setFile, percent, resumed, phase, setPreparing } =
    useLessonForm();

  const [duration, setDuration] = useState(
    defaultDuration != null ? String(defaultDuration) : "",
  );
  const [durationStatus, setDurationStatus] = useState<
    "idle" | "reading" | "done" | "failed"
  >("idle");
  // Only the latest probe may write to state - a slow one must not overwrite the
  // reading for a file the admin picked afterwards.
  const seq = useRef(0);

  const [compression, setCompression] = useState<
    | { state: "idle" }
    | { state: "running"; percent: number | null }
    | { state: "done"; from: number; to: number }
    | { state: "note"; message: string }
  >({ state: "idle" });

  async function readDuration(src: string, revoke: boolean) {
    const id = ++seq.current;
    setDurationStatus("reading");
    try {
      const seconds = await probeDuration(src, type);
      if (seq.current !== id) return;
      setDuration(String(seconds));
      setDurationStatus("done");
    } catch {
      if (seq.current === id) setDurationStatus("failed");
    } finally {
      if (revoke) URL.revokeObjectURL(src);
    }
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] ?? null;
    // Stage the original straight away: if compression fails or is skipped,
    // the admin still has a working upload rather than an empty form.
    setFile(picked);
    setCompression({ state: "idle" });

    if (!picked) {
      seq.current++;
      setDurationStatus("idle");
      return;
    }

    const id = ++seq.current;
    readDuration(URL.createObjectURL(picked), true);

    if (type !== "video") return;

    if (!canCompressInBrowser()) {
      setCompression({
        state: "note",
        message:
          "This browser can't compress video (needs WebCodecs - use Chrome, " +
          "or run `npm run compress-video` on the file first).",
      });
      return;
    }

    setCompression({ state: "running", percent: null });
    setPreparing(true);
    try {
      const compressed = await compressVideo(picked, (p: CompressProgress) => {
        if (seq.current === id) {
          setCompression({ state: "running", percent: p.percent });
        }
      });
      if (seq.current !== id) return; // a newer file was picked meanwhile

      // Phone footage shrinks enormously, but an already-encoded lesson can
      // come out larger - keep whichever is actually smaller.
      if (compressed.size < picked.size) {
        setFile(compressed);
        setCompression({ state: "done", from: picked.size, to: compressed.size });
      } else {
        setCompression({
          state: "note",
          message: "Already well encoded - uploading the original.",
        });
      }
    } catch (err) {
      if (seq.current !== id) return;
      setCompression({
        state: "note",
        message:
          (err instanceof Error ? err.message : "Compression failed.") +
          " Uploading the original instead.",
      });
    } finally {
      if (seq.current === id) setPreparing(false);
    }
  }

  const parsed = parseInt(duration, 10);
  const uploading = phase === "uploading";

  return (
    <>
      <div>
        <label className={label}>
          Upload {type} file {existingUrl ? "(replaces current)" : ""}
        </label>
        {/* Deliberately unnamed: the bytes go straight to Storage from
            LessonForm, so this must never become part of the form body. */}
        <input
          type="file"
          accept={type === "video" ? "video/*" : "audio/*"}
          onChange={onFileChange}
          disabled={phase !== "idle" || compression.state === "running"}
          className={input}
        />

        {!file && (
          <p className="mt-1 text-xs text-neutral-400">
            Nothing is uploaded yet - the file goes up when you press the button
            below.
          </p>
        )}

        {compression.state === "running" && (
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full rounded-full bg-amber-500 transition-all"
                style={{ width: `${compression.percent ?? 3}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-amber-700">
              Compressing for streaming
              {compression.percent != null ? ` - ${compression.percent}%` : "..."}
              {" - don't save until this finishes."}
            </p>
          </div>
        )}

        {compression.state === "done" && (
          <p className="mt-1 text-xs text-green-600">
            Compressed {prettySize(compression.from)} to{" "}
            {prettySize(compression.to)} (
            {(compression.from / compression.to).toFixed(1)}x smaller).
          </p>
        )}

        {compression.state === "note" && (
          <p className="mt-1 text-xs text-amber-600">{compression.message}</p>
        )}

        {file && !uploading && compression.state !== "running" && (
          <p className="mt-1 text-xs text-neutral-500">
            Ready: <span className="font-medium">{file.name}</span> (
            {prettySize(file.size)}) - will upload when you save.
          </p>
        )}

        {uploading && (
          <div className="mt-2">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-200">
              <div
                className="h-full rounded-full bg-red-700 transition-all"
                style={{ width: `${percent ?? 0}%` }}
              />
            </div>
            <p className="mt-1 text-xs text-neutral-500">
              {resumed ? "Resuming" : "Uploading"} {file?.name} - {percent ?? 0}
              %
            </p>
          </div>
        )}
      </div>

      <div>
        <label className={label}>...or paste a media link (http/https)</label>
        <input
          name="mediaUrl"
          className={input}
          placeholder="https://..."
          disabled={!!file || phase !== "idle"}
          onBlur={(e) => {
            const url = e.target.value.trim();
            if (/^https?:\/\//i.test(url)) readDuration(url, false);
          }}
        />
        {file && (
          <p className="mt-1 text-xs text-neutral-400">
            Ignored while a file is selected - clear the file to paste a link
            instead.
          </p>
        )}
        {existingUrl && !file && (
          <p className="mt-1 truncate text-xs text-neutral-400">
            Current:{" "}
            <a
              href={existingUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {existingUrl}
            </a>
          </p>
        )}
      </div>

      <div>
        <label className={label}>
          Duration (seconds - shown as m:ss in the app)
        </label>
        <input
          name="durationSeconds"
          type="number"
          min={0}
          value={duration}
          onChange={(e) => {
            setDuration(e.target.value);
            setDurationStatus("idle");
          }}
          className={input}
          placeholder="Filled in automatically when you pick a file"
        />
        <p className="mt-1 text-xs text-neutral-400">
          {durationStatus === "reading" && "Reading duration from the file..."}
          {durationStatus === "done" && Number.isFinite(parsed) && (
            <span className="text-green-600">
              Detected {mmss(parsed)} - edit it if that looks wrong.
            </span>
          )}
          {durationStatus === "failed" && (
            <span className="text-amber-600">
              Couldn&apos;t read the duration from that {type}. Please type it
              in.
            </span>
          )}
          {durationStatus === "idle" &&
            (Number.isFinite(parsed) && parsed > 0
              ? `${mmss(parsed)} in the app.`
              : "Detected automatically from the file or link you choose.")}
        </p>
      </div>
    </>
  );
}
