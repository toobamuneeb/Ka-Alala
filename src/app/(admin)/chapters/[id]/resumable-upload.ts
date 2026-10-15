import * as tus from "tus-js-client";

// Supabase's resumable endpoint requires exactly 6MB chunks.
const CHUNK_SIZE = 6 * 1024 * 1024;

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled.");
    this.name = "UploadCancelledError";
  }
}

/**
 * Resumable (TUS) upload straight to Supabase Storage.
 */
export function resumableUpload({
  file,
  bucket,
  path,
  accessToken,
  onProgress,
  onResumed,
}: {
  file: File;
  bucket: string;
  path: string;
  accessToken: string;
  onProgress: (percent: number) => void;
  onResumed: () => void;
}): { done: Promise<void>; abort: () => void } {
  let upload: tus.Upload;
  let cancel: () => void = () => {};

  const done = new Promise<void>((resolve, reject) => {
    // tus's abort() stops sending but fires neither onSuccess nor onError, so
    // without this the caller's await never returns and the form sits on
    // "Uploading..." forever.
    cancel = () => {
      // true also deletes the partial upload, so it isn't resumed next time.
      upload?.abort(true).catch(() => {});
      reject(new UploadCancelledError());
    };
    upload = new tus.Upload(file, {
      endpoint: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/upload/resumable`,
      // Back off rather than give up on a flaky connection.
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      headers: { authorization: `Bearer ${accessToken}`, "x-upsert": "true" },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: CHUNK_SIZE,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: "3600",
      },
      onProgress: (sent, total) => onProgress(Math.round((sent / total) * 100)),
      onSuccess: () => resolve(),
      onError: (err) =>
        reject(err instanceof Error ? err : new Error(String(err))),
    });

    upload.findPreviousUploads().then((previous) => {
      if (previous.length) {
        upload.resumeFromPreviousUpload(previous[0]);
        onResumed();
      }
      upload.start();
    });
  });

  return { done, abort: () => cancel() };
}
