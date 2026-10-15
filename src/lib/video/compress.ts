"use client";

export type CompressProgress = {
  phase: "probing" | "transcoding" | "finishing";

  percent: number | null;

  etaSeconds?: number | null;
};

export class UnsupportedVideoError extends Error {}

export function canCompressInBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.Worker === "function" &&
    typeof window.VideoEncoder === "function" &&
    typeof window.VideoDecoder === "function" &&
    typeof window.OffscreenCanvas === "function"
  );
}

type WorkerReply =
  | { type: "hello" }
  | { type: "progress"; progress: CompressProgress }
  | { type: "done"; buffer: ArrayBuffer; name: string }
  | { type: "error"; message: string; unsupported: boolean };

export function compressVideo(
  file: File,
  onProgress?: (p: CompressProgress) => void,
): Promise<File> {
  if (!canCompressInBrowser()) {
    return Promise.reject(
      new UnsupportedVideoError("This browser has no WebCodecs support."),
    );
  }

  return new Promise<File>((resolve, reject) => {
    const worker = new Worker(
      new URL("./compress.worker.ts", import.meta.url),
      { type: "module" },
    );

    let started = false;
    const finish = (fn: () => void) => {
      clearTimeout(startupTimer);
      worker.terminate();
      fn();
    };

    const startupTimer = setTimeout(() => {
      if (!started) {
        finish(() =>
          reject(
            new Error(
              "The compression worker didn't start. Reload the page and try again.",
            ),
          ),
        );
      }
    }, 10_000);

    worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      switch (data.type) {
        case "hello":
          started = true;
          clearTimeout(startupTimer);
          break;
        case "progress":
          onProgress?.(data.progress);
          break;
        case "done":
          finish(() =>
            resolve(new File([data.buffer], data.name, { type: "video/mp4" })),
          );
          break;
        case "error":
          finish(() =>
            reject(
              data.unsupported
                ? new UnsupportedVideoError(data.message)
                : new Error(data.message),
            ),
          );
          break;
      }
    };

    worker.onerror = (e) =>
      finish(() =>
        reject(new Error(e.message || "Compression worker failed.")),
      );

    worker.postMessage({ file });
  });
}
