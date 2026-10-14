"use client";

import {
  createFile,
  DataStream,
  Endianness,
  MP4BoxBuffer,
  type ISOFile,
  type Movie,
  type Sample,
} from "mp4box";
import { Muxer, ArrayBufferTarget } from "mp4-muxer";

const TARGET_HEIGHT = 1080;
const TARGET_FPS = 30;
const TARGET_BITRATE = 2_500_000;

/** Bytes fed to the demuxer at a time. Small enough to stay off the heap. */
const READ_CHUNK = 16 * 1024 * 1024;

/** How much of each end to read while hunting for the moov box. */
const HEADER_PROBE = 32 * 1024 * 1024;
const TAIL_PROBE = 64 * 1024 * 1024;

/** Keep the codecs fed without letting their queues grow without bound. */
const MAX_QUEUE = 8;

export type CompressProgress = {
  phase: "probing" | "transcoding" | "finishing";
  /** 0-100, or null while the duration is still unknown. */
  percent: number | null;
};

export class UnsupportedVideoError extends Error {}

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

/** WebCodecs plus the bits of it we actually rely on. */
export function canCompressInBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.VideoEncoder === "function" &&
    typeof window.VideoDecoder === "function" &&
    typeof window.OffscreenCanvas === "function"
  );
}

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
    // write() emits the full box; the decoder wants only its payload.
    return new Uint8Array(stream.buffer.slice(8));
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
  const scale = Math.min(1, TARGET_HEIGHT / height);
  return {
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}

export async function compressVideo(
  file: File,
  onProgress?: (p: CompressProgress) => void,
): Promise<File> {
  if (!canCompressInBrowser()) {
    throw new UnsupportedVideoError("This browser has no WebCodecs support.");
  }

  onProgress?.({ phase: "probing", percent: null });

  const demuxer = createFile();

  // --- demux ------------------------------------------------------------
  let ready = false;

  /** Hand one slice of the file to the demuxer at its true offset. */
  async function feed(start: number, end: number) {
    const raw = await file.slice(start, Math.min(end, file.size)).arrayBuffer();
    demuxer.appendBuffer(MP4BoxBuffer.fromArrayBuffer(raw, start));
  }

  const info = await new Promise<Movie>((resolve, reject) => {
    demuxer.onReady = (i: Movie) => {
      ready = true;
      resolve(i);
    };
    demuxer.onError = (e: string) => reject(new UnsupportedVideoError(e));

    (async () => {
      // The header usually sits at the front, so try that first.
      await feed(0, HEADER_PROBE);
      if (ready) return;

      // Phone recordings are typically written with moov at the *end*, and
      // mp4box only reports a track list once it has seen it. Reading
      // forwards to find it would pull the entire file into memory - the
      // exact failure this whole approach exists to avoid - so jump to the
      // tail instead and let mp4box stitch the two ranges together.
      if (file.size > HEADER_PROBE) {
        await feed(Math.max(HEADER_PROBE, file.size - TAIL_PROBE), file.size);
      }
      if (ready) return;

      reject(
        new UnsupportedVideoError(
          "Couldn't read this file's structure - it may not be a standard MP4/MOV.",
        ),
      );
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
  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encoderError = e),
  });
  encoder.configure({
    codec: "avc1.640028", // H.264 High @ 4.0 - what every iPhone decodes
    width: out.width,
    height: out.height,
    bitrate: TARGET_BITRATE,
    framerate: TARGET_FPS,
    avc: { format: "avc" },
  });

  const canvas = new OffscreenCanvas(out.width, out.height);
  const ctx = canvas.getContext("2d", { alpha: false })!;

  const minFrameGapUs = 1_000_000 / TARGET_FPS;
  let lastKeptUs = -Infinity;
  let processedUs = 0;

  const decoder = new VideoDecoder({
    output: (frame) => {
      // Drop frames to reach the target rate: 60fps source halves here, and
      // keeping them would cost bytes for motion nobody sees on a phone.
      if (frame.timestamp - lastKeptUs + 1 < minFrameGapUs) {
        frame.close();
        return;
      }
      lastKeptUs = frame.timestamp;
      processedUs = frame.timestamp;

      ctx.drawImage(frame, 0, 0, out.width, out.height);
      frame.close();

      const scaled = new VideoFrame(canvas, {
        timestamp: lastKeptUs,
        duration: minFrameGapUs,
      });
      encoder.encode(scaled);
      scaled.close();

      if (durationUs > 0) {
        onProgress?.({
          phase: "transcoding",
          percent: Math.min(99, Math.round((processedUs / durationUs) * 100)),
        });
      }
    },
    error: (e) => (encoderError = e),
  });

  decoder.configure({
    codec: videoTrack.codec,
    codedWidth: source.width,
    codedHeight: source.height,
    description: codecDescription(demuxer, videoTrack.id),
  });

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
      while (offset < file.size) {
        await feed(offset, offset + READ_CHUNK);
        offset += READ_CHUNK;

        while (
          !encoderError &&
          (decoder.decodeQueueSize > MAX_QUEUE ||
            encoder.encodeQueueSize > MAX_QUEUE)
        ) {
          await new Promise((r) => setTimeout(r, 15));
        }
        if (encoderError) throw encoderError;
      }
      demuxer.flush();
      done();
    } catch (e) {
      failed(e as Error);
    }
  })();

  await drained;

  onProgress?.({ phase: "finishing", percent: 99 });
  await decoder.flush();
  await encoder.flush();
  if (encoderError) throw encoderError;

  decoder.close();
  encoder.close();
  muxer.finalize();

  const { buffer } = muxer.target as ArrayBufferTarget;
  const name = file.name.replace(/\.[^.]+$/, "") + ".mp4";
  onProgress?.({ phase: "finishing", percent: 100 });
  return new File([buffer], name, { type: "video/mp4" });
}
