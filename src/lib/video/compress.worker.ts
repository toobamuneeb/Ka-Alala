/// <reference lib="webworker" />

import {
  createFile,
  DataStream,
  Endianness,
  Log,
  MP4BoxBuffer,
  type ISOFile,
  type Movie,
  type Sample,
} from "mp4box";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

Log.error = (module: string, msg?: string) =>
  console.warn(`[mp4box:${module}]`, msg);

const TARGET_HEIGHT = 1080;

/**
 * Height used when the source is 4K or larger.

 */
const TARGET_HEIGHT_LARGE = 720;
const LARGE_SOURCE_HEIGHT = 1440;
const TARGET_FPS = 30;
const TARGET_BITRATE = 2_500_000;
const TARGET_BITRATE_720 = 1_600_000;

/** Bytes fed to the demuxer at a time. Small enough to stay off the heap. */
const READ_CHUNK = 16 * 1024 * 1024;

/**
 * How deep the codec queues are allowed to run.
 *
 * Hardware encoders work on batches of frames, so a shallow queue starves
 * them: the pump spends its time sleeping while the GPU sits idle. Deep
 * enough to stay saturated, bounded so a long file can't pile up in memory.
 */
const MAX_QUEUE = 48;

/**
 * Decoder errors to recover from before giving up on the file. Each one
 * costs at most a keyframe interval of picture; more than a handful means
 * the file itself is broken rather than the odd frame.
 */
const MAX_DECODER_RECOVERIES = 20;

/**
 * How long to let the decoder catch up before feeding it more anyway.
 *
 * Long enough to bound memory when the decoder is draining normally, short
 * enough that a decoder which emits nothing until flush can never wedge the
 * pump.
 */
const DECODER_BACKOFF_MS = 2_000;

type CompressProgress = {
  phase: "probing" | "transcoding" | "finishing";
  /** 0-100, or null while the duration is still unknown. */
  percent: number | null;
  /** Seconds left at the current rate, or null before there's a rate. */
  etaSeconds?: number | null;
};

class UnsupportedVideoError extends Error {}

/** Only the slice of the esds box we read the AAC config out of. */
type EsdsBox = {
  esd?: {
    findDescriptor?: (tag: number) =>
      | {
          findDescriptor?: (
            tag: number,
          ) => { data?: ArrayLike<number> } | undefined;
        }
      | undefined;
  };
};

/** Pull the codec-private data (avcC/hvcC/...) a VideoDecoder needs. */
function codecDescription(file: ISOFile, trackId: number): Uint8Array {
  const trak = file.getTrackById(trackId);
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    // The codec-private boxes hang off the concrete sample entry subclasses,
    // which the published SampleEntry type doesn't enumerate.
    const e = entry as unknown as Record<
      string,
      { write(s: DataStream): void }
    >;
    const box = e.avcC ?? e.hvcC ?? e.vpcC ?? e.av1C;
    if (!box) continue;
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    box.write(stream);

    return new Uint8Array(stream.buffer.slice(8, stream.byteLength));
  }
  throw new UnsupportedVideoError("No codec description in this file.");
}

/** AAC's esds payload, so the muxer can describe the copied audio track. */
function audioDescription(file: ISOFile, trackId: number): Uint8Array | null {
  const trak = file.getTrackById(trackId);
  for (const entry of trak?.mdia?.minf?.stbl?.stsd?.entries ?? []) {
    const esds = (entry as unknown as { esds?: EsdsBox }).esds;
    if (!esds?.esd) continue;
    const info = esds.esd.findDescriptor?.(0x04)?.findDescriptor?.(0x05);
    if (info?.data) return new Uint8Array(info.data);
  }
  return null;
}

/** Fit inside the target box without upscaling, keeping both sides even. */
function targetSize(width: number, height: number) {
  const target =
    height >= LARGE_SOURCE_HEIGHT ? TARGET_HEIGHT_LARGE : TARGET_HEIGHT;
  const scale = Math.min(1, target / height);
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}

async function transcode(
  file: File,
  onProgress?: (p: CompressProgress) => void,
): Promise<File> {
  onProgress?.({ phase: "probing", percent: null });

  const demuxer = createFile();

  // --- demux ------------------------------------------------------------
  let ready = false;

  /**
   * Hand one slice to the demuxer and report where it wants to read next.
   *
  
   */
  async function feed(start: number): Promise<number> {
    const end = Math.min(start + READ_CHUNK, file.size);
    const raw = await file.slice(start, end).arrayBuffer();
    probedBytes += end - start;
    onProgress?.({
      phase: "probing",
      percent: Math.min(99, Math.round((end / file.size) * 100)),
    });
    const next = demuxer.appendBuffer(MP4BoxBuffer.fromArrayBuffer(raw, start));
    // Guard against a parser that asks for nothing new, so the loop can't spin.
    return typeof next === "number" && next > start ? next : end;
  }

  let probedBytes = 0;
  const info = await new Promise<Movie>((resolve, reject) => {
    demuxer.onReady = (i: Movie) => {
      ready = true;
      resolve(i);
    };
    demuxer.onError = (e: string) => reject(new UnsupportedVideoError(e));

    (async () => {
      // Phone recordings usually put moov after the mdat, so this walk can
      // span the whole file - but it only *reads* the boxes it is sent to.
      let pos = 0;
      while (pos < file.size && !ready) pos = await feed(pos);
      if (!ready) {
        demuxer.flush();
        reject(
          new UnsupportedVideoError(
            "Couldn't read this file's structure - it may not be a standard MP4/MOV.",
          ),
        );
      }
    })().catch(reject);
  });

  const videoTrack = info.videoTracks[0];
  if (!videoTrack?.video) {
    throw new UnsupportedVideoError("No video track found.");
  }
  const videoInfo = videoTrack.video;

  const first = info.audioTracks[0];
  const audioTrack = first?.audio ? first : null;
  const audioInfo = audioTrack?.audio ?? null;

  const source = { width: videoInfo.width, height: videoInfo.height };
  const out = targetSize(source.width, source.height);
  const durationUs = (info.duration / info.timescale) * 1_000_000;

  // --- muxer ------------------------------------------------------------
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: out.width, height: out.height },
    ...(audioTrack
      ? {
          audio: {
            codec: "aac" as const,
            numberOfChannels: audioInfo!.channel_count,
            sampleRate: audioInfo!.sample_rate,
          },
        }
      : {}),
    // Puts the moov box up front so the app can start playing before the
    // whole file has downloaded - the other half of the stutter fix.
    fastStart: "in-memory",
  });

  // --- encode -----------------------------------------------------------

  let codecError: Error | null = null;
  const recordError = (e: Error) => {
    if (codecError) return;

    const where =
      samplesIn === 0
        ? "before any sample was fed"
        : framesOut === 0
          ? `after ${samplesIn} samples, none decoded`
          : `after ${samplesIn} samples / ${framesOut} frames ` +
            `(${Math.round(processedUs / 1e6)}s in)`;
    codecError = new Error(
      `${e.message || e.name || "Codec error"} - ${where}`,
    );
  };
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => recordError(e),
  });
  encoder.configure({
    codec: "avc1.640028", // H.264 High @ 4.0 - what every iPhone decodes
    width: out.width,
    height: out.height,
    bitrate:
      out.height <= TARGET_HEIGHT_LARGE ? TARGET_BITRATE_720 : TARGET_BITRATE,
    framerate: TARGET_FPS,
    avc: { format: "avc" },
    // Without this Chrome may quietly pick its software encoder, which turns
    // a thirty-second job into a several-minute one on 4K source.
    hardwareAcceleration: "prefer-hardware",
    latencyMode: "quality",
  });

  const canvas = new OffscreenCanvas(out.width, out.height);
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const minFrameGapUs = 1_000_000 / TARGET_FPS;
  let lastKeptUs = -Infinity;
  let processedUs = 0;
  let lastProgressAt = 0;
  let framesOut = 0;
  let samplesIn = 0;
  const startedAt = Date.now();

  let decoderRecoveries = 0;
  let decoderNeedsKey = false;
  const onFrame = (frame: VideoFrame) => {
    if (frame.timestamp - lastKeptUs + 1 < minFrameGapUs) {
      frame.close();
      return;
    }

    if (encoder.state !== "configured") {
      frame.close();
      return;
    }

    lastKeptUs = frame.timestamp;
    processedUs = frame.timestamp;
    framesOut++;

    let scaled: VideoFrame | null = null;
    try {
      ctx.drawImage(frame, 0, 0, out.width, out.height);
      scaled = new VideoFrame(canvas, {
        timestamp: lastKeptUs,
        duration: minFrameGapUs,
      });
      encoder.encode(scaled);
    } catch (e) {
      recordError(e instanceof Error ? e : new Error(String(e)));
    } finally {
      frame.close();
      scaled?.close();
    }

    const now = Date.now();
    if (durationUs > 0 && now - lastProgressAt > 250) {
      lastProgressAt = now;
      const fraction = processedUs / durationUs;
      const elapsed = (now - startedAt) / 1000;
      onProgress?.({
        phase: "transcoding",
        percent: Math.min(99, Math.round(fraction * 100)),
        etaSeconds:
          fraction > 0.01 ? Math.round(elapsed / fraction - elapsed) : null,
      });
    }
  };
  const onDecoderError = (e: Error) => {
    if (decoderRecoveries >= MAX_DECODER_RECOVERIES) {
      recordError(e);
      return;
    }
    decoderRecoveries++;
    decoderNeedsKey = true;
    console.warn(
      `[compress] decoder error at ~${Math.round(processedUs / 1e6)}s, ` +
        `restarting at next keyframe (${decoderRecoveries}/${MAX_DECODER_RECOVERIES})`,
      e,
    );
  };
  const makeDecoder = () => {
    const d = new VideoDecoder({ output: onFrame, error: onDecoderError });
    d.configure(decoderConfig);
    return d;
  };

  const decoderConfig: VideoDecoderConfig = {
    codec: videoTrack.codec,
    codedWidth: source.width,
    codedHeight: source.height,
    description: codecDescription(demuxer, videoTrack.id),
    // 4K60 HEVC is far too heavy to unpack in software at any useful rate.
    hardwareAcceleration: "prefer-hardware",
  };

  const support = await VideoDecoder.isConfigSupported(decoderConfig);
  if (!support.supported) {
    throw new UnsupportedVideoError(
      `This browser can't decode ${videoTrack.codec} in hardware. ` +
        `Compress the file with \`npm run compress-video\` instead.`,
    );
  }

  let decoder = makeDecoder();

  // --- pump samples through ---------------------------------------------
  const audioDesc = audioTrack
    ? audioDescription(demuxer, audioTrack.id)
    : null;
  let audioMetaSent = false;
  let done!: () => void;
  let failed!: (e: Error) => void;
  const drained = new Promise<void>((res, rej) => {
    done = res;
    failed = rej;
  });

  demuxer.onSamples = (id: number, _user: unknown, samples: Sample[]) => {
    try {
      for (const s of samples) {
        if (!s.data) continue;
        const timestamp = (s.cts / s.timescale) * 1_000_000;
        const duration = (s.duration / s.timescale) * 1_000_000;

        if (id === videoTrack.id) {
          if (codecError) continue;
          if (decoderNeedsKey) {
            if (!s.is_sync) continue;
            if (decoder.state !== "closed") decoder.close();
            decoder = makeDecoder();
            decoderNeedsKey = false;
          }
          if (decoder.state !== "configured") continue;
          samplesIn++;
          decoder.decode(
            new EncodedVideoChunk({
              type: s.is_sync ? "key" : "delta",
              timestamp,
              duration,
              data: s.data,
            }),
          );
        } else if (audioTrack && id === audioTrack.id) {
          muxer.addAudioChunkRaw(
            s.data,
            s.is_sync ? "key" : "delta",
            timestamp,
            duration,
            audioMetaSent || !audioDesc
              ? undefined
              : {
                  decoderConfig: {
                    codec: audioTrack.codec,
                    sampleRate: audioInfo!.sample_rate,
                    numberOfChannels: audioInfo!.channel_count,
                    description: audioDesc,
                  },
                },
          );
          audioMetaSent = true;
        }
      }
      // Samples are copied into the codecs above, so let the demuxer drop
      // them - without this the whole file accumulates in memory.
      demuxer.releaseUsedSamples(id, samples[samples.length - 1].number + 1);
    } catch (e) {
      failed(e as Error);
    }
  };

  demuxer.setExtractionOptions(videoTrack.id, null, { nbSamples: 60 });
  if (audioTrack) {
    demuxer.setExtractionOptions(audioTrack.id, null, { nbSamples: 200 });
  }
  demuxer.start();

  // Feed the rest of the file, pausing whenever the codecs fall behind.
  (async () => {
    try {
      let offset = 0;
      try {
        offset = demuxer.seek(0, true).offset ?? 0;
      } catch {
        /* no seek table - fall back to walking from the top */
      }
      while (offset < file.size) {
        offset = await feed(offset);

        while (!codecError && encoder.encodeQueueSize > MAX_QUEUE) {
          await new Promise((r) => setTimeout(r, 0));
        }

        const until = Date.now() + DECODER_BACKOFF_MS;
        while (
          !codecError &&
          decoder.decodeQueueSize > MAX_QUEUE &&
          Date.now() < until
        ) {
          await new Promise((r) => setTimeout(r, 0));
        }
        if (codecError) throw codecError;
      }
      demuxer.flush();
      done();
    } catch (e) {
      failed(e as Error);
    }
  })();

  await drained;

  onProgress?.({ phase: "finishing", percent: 99 });

  if (decoder.state === "configured") {
    await decoder.flush().catch(() => {});
  }

  if (framesOut === 0) {
    throw new UnsupportedVideoError(
      samplesIn === 0
        ? "No video samples could be read from this file."
        : `The browser accepted ${videoTrack.codec} but decoded none of the ` +
            `${samplesIn} frames in it. Compress this file with ` +
            "`npm run compress-video` instead.",
    );
  }
  await encoder.flush();
  if (codecError) throw codecError;

  if (decoder.state !== "closed") decoder.close();
  encoder.close();
  muxer.finalize();

  const { buffer } = muxer.target as ArrayBufferTarget;
  const name = file.name.replace(/\.[^.]+$/, "") + ".mp4";
  onProgress?.({ phase: "finishing", percent: 100 });
  return new File([buffer], name, { type: "video/mp4" });
}

// --- worker entry ------------------------------------------------------
//
// The whole transcode runs here rather than on the page's thread. Decoding
// 4K video and drawing every frame is heavy enough that sharing a thread with
// React means the two starve each other: progress state updates block frame
// work, and frame work blocks the UI. Off the main thread, the page stays
// responsive and the codecs get the thread to themselves.

declare const self: DedicatedWorkerGlobalScope;

self.postMessage({ type: "hello" });

self.onmessage = async (event: MessageEvent<{ file: File }>) => {
  try {
    const out = await transcode(event.data.file, (p) =>
      self.postMessage({ type: "progress", progress: p }),
    );
    const buffer = await out.arrayBuffer();
    self.postMessage({ type: "done", buffer, name: out.name }, [buffer]);
  } catch (err) {
    self.postMessage({
      type: "error",
      message: err instanceof Error ? err.message : String(err),
      unsupported: err instanceof UnsupportedVideoError,
    });
  }
};
