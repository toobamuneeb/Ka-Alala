"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { Spinner, btnPrimary } from "@/components/ui";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { LessonType } from "@/lib/types";
import { createUploadTarget } from "./upload-actions";
import { resumableUpload } from "./resumable-upload";

type Phase = "idle" | "uploading" | "saving";

function isStaleAction(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /Server Action .*(was not found|not found on the server)|Failed to find Server Action/i.test(
    message,
  );
}

/**
 * Next signals redirect/notFound by throwing, and these actions always redirect
 * - on success and on failure. Swallowing that would show a bogus "something
 * went wrong" on every successful save, so it has to be re-thrown for the
 * router to act on.
 */
function isNextControlFlow(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "digest" in err &&
    typeof (err as { digest: unknown }).digest === "string" &&
    (err as { digest: string }).digest.startsWith("NEXT_")
  );
}

const Ctx = createContext<{
  type: LessonType;
  setType: (t: LessonType) => void;
  file: File | null;
  setFile: (f: File | null) => void;
  percent: number | null;
  resumed: boolean;
  phase: Phase;
}>({
  type: "video",
  setType: () => {},
  file: null,
  setFile: () => {},
  percent: null,
  resumed: false,
  phase: "idle",
});

export function useLessonForm() {
  return useContext(Ctx);
}

/**
 * The add/edit lesson form.
 *
 * Client-side on purpose: picking a file only *stages* it, and the upload runs
 * when Create/Save is pressed. That means intercepting submit, uploading, then
 * calling the server action with `mediaUrl` filled in - the bytes themselves
 * can't go through the action at all (Next fails to parse a multipart body over
 * ~10MB whatever `serverActions.bodySizeLimit` says).
 *
 * The action is invoked directly rather than via the form's `action` attribute,
 * so the FormData can be amended after the upload. `useFormStatus` therefore
 * reports nothing here and `phase` drives the button instead.
 */
export function LessonForm({
  action,
  chapterId,
  fixedType,
  submitLabel,
  children,
  id,
}: {
  action: (formData: FormData) => Promise<void>;
  chapterId: string;
  /** Edit mode: lesson type is immutable after creation. */
  fixedType?: LessonType;
  submitLabel: string;
  children: ReactNode;
  id?: string;
}) {
  const [type, setType] = useState<LessonType>(fixedType ?? "video");
  const [file, setFile] = useState<File | null>(null);
  const [percent, setPercent] = useState<number | null>(null);
  const [resumed, setResumed] = useState(false);
  // Saving is React's to track, not ours: these actions always redirect, and a
  // redirect means `await action(...)` never settles - a hand-rolled "saving"
  // flag would stay stuck on after the lesson had already been written.
  const [isSaving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const abortRef = useRef<(() => void) | null>(null);

  const uploading = percent !== null;
  const busy = uploading || isSaving;
  const phase: Phase = uploading ? "uploading" : isSaving ? "saving" : "idle";

  async function uploadStaged(stagedFile: File): Promise<string> {
    const target = await createUploadTarget(chapterId, type, stagedFile.name);
    if (!target.ok) throw new Error(target.error);

    // TUS authenticates as the uploading admin - there is no signed resumable
    // URL - so it needs this session's access token.
    const { data } = await supabaseBrowser().auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken)
      throw new Error("Your session expired. Reload and sign in again.");

    const { done, abort } = resumableUpload({
      file: stagedFile,
      bucket: target.bucket,
      path: target.path,
      accessToken,
      onResumed: () => setResumed(true),
      onProgress: setPercent,
    });
    abortRef.current = abort;

    await done;
    return target.publicUrl;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;

    // Built before any await - the form is read synchronously.
    const formData = new FormData(e.currentTarget);
    setError(null);
    setStale(false);

    if (file) {
      try {
        setPercent(0);
        setResumed(false);
        formData.set("mediaUrl", await uploadStaged(file));
      } catch (err) {
        setPercent(null);
        setError(err instanceof Error ? err.message : "Upload failed.");
        return; // nothing was saved - let them retry without losing the form
      }
      setPercent(null);
    }

    startSaving(async () => {
      try {
        await action(formData);
      } catch (err) {
        if (isNextControlFlow(err)) throw err; // a redirect, not a failure
        if (isStaleAction(err)) setStale(true);
        else
          setError(
            err instanceof Error ? err.message : "Something went wrong.",
          );
      }
    });
  }

  const label = uploading
    ? `${resumed ? "Resuming" : "Uploading"} ${percent ?? 0}%...`
    : isSaving
      ? "Saving..."
      : submitLabel;

  return (
    <Ctx.Provider
      value={{ type, setType, file, setFile, percent, resumed, phase }}
    >
      <form id={id} onSubmit={handleSubmit} className="grid max-w-xl gap-4">
        {children}

        {stale && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <p className="font-medium">This page is out of date.</p>
            <p className="mt-0.5 text-amber-800">
              The server has been updated since the page loaded, so it was still
              pointing at the old version. Nothing was saved - reload and submit
              again.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 inline-flex items-center justify-center rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-sm font-medium text-amber-900 hover:bg-amber-100"
            >
              Reload the page
            </button>
          </div>
        )}

        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="w-fit">
          <button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className={`${btnPrimary} ${busy ? "cursor-wait" : ""}`}
          >
            {busy && <Spinner className="mr-2" />}
            {label}
          </button>
          {uploading && (
            <button
              type="button"
              onClick={() => abortRef.current?.()}
              className="ml-3 text-xs text-neutral-500 underline hover:text-red-700"
            >
              Cancel upload
            </button>
          )}
        </div>
      </form>
    </Ctx.Provider>
  );
}
