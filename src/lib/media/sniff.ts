"use client";

/**
 * Work out what a media file actually is, from its bytes.
 *
 * A filename is a claim, not a fact. Recordings exported from a phone or a
 * voice-memo app routinely arrive as AAC inside an MP4 container but named
 * `.mp3`, and the browser copies that wrong name into the upload's
 * Content-Type. Storage then serves AAC-in-MP4 as `audio/mpeg`, and iOS -
 * which believes the Content-Type - tries to parse it as MPEG audio, fails,
 * and leaves the player stuck loading forever with no error.
 *
 * Sniffing the container up front keeps the stored object honest, so the app
 * gets a type it can actually decode.
 */

export type SniffedType = {
  /** Media type to store the object with. */
  contentType: string;
  /** Extension matching the real container, without the dot. */
  extension: string;
};

/** Bytes needed to recognise every container below. */
const HEADER_BYTES = 16;

function matches(bytes: Uint8Array, offset: number, ascii: string): boolean {
  for (let i = 0; i < ascii.length; i++) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Returns the real type, or null when the container isn't one we recognise -
 * in which case the caller should leave the file as the browser reported it.
 */
export async function sniffMediaType(
  file: File,
  kind: "video" | "audio",
): Promise<SniffedType | null> {
  const head = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
  if (head.length < HEADER_BYTES) return null;

  // ISO base media (MP4/M4A/MOV): a `ftyp` box at offset 4, with the brand
  // following it. `qt  ` is QuickTime, everything else here is MP4-family.
  if (matches(head, 4, "ftyp")) {
    const brand = String.fromCharCode(head[8], head[9], head[10], head[11]);
    if (kind === "audio") {
      return { contentType: "audio/mp4", extension: "m4a" };
    }
    return brand === "qt  "
      ? { contentType: "video/quicktime", extension: "mov" }
      : { contentType: "video/mp4", extension: "mp4" };
  }

  // MPEG audio: an ID3 tag, or a raw frame sync (11 set bits).
  if (
    matches(head, 0, "ID3") ||
    (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
  ) {
    return { contentType: "audio/mpeg", extension: "mp3" };
  }

  if (matches(head, 0, "RIFF") && matches(head, 8, "WAVE")) {
    return { contentType: "audio/wav", extension: "wav" };
  }

  if (matches(head, 0, "OggS")) {
    return kind === "audio"
      ? { contentType: "audio/ogg", extension: "ogg" }
      : { contentType: "video/ogg", extension: "ogv" };
  }

  // WebM/Matroska (EBML header).
  if (
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  ) {
    return kind === "audio"
      ? { contentType: "audio/webm", extension: "webm" }
      : { contentType: "video/webm", extension: "webm" };
  }

  if (matches(head, 0, "fLaC")) {
    return { contentType: "audio/flac", extension: "flac" };
  }

  return null;
}

/**
 * Hand back a File whose name and type match its contents.
 *
 * Returns the original when nothing needs correcting, so callers can compare
 * by identity to tell whether anything changed.
 */
export async function withCorrectedType(
  file: File,
  kind: "video" | "audio",
): Promise<File> {
  const real = await sniffMediaType(file, kind);
  if (!real) return file;

  const currentExt = (file.name.split(".").pop() ?? "").toLowerCase();
  if (currentExt === real.extension && file.type === real.contentType) {
    return file;
  }

  const base = file.name.replace(/\.[^.]+$/, "") || "media";
  return new File([file], `${base}.${real.extension}`, {
    type: real.contentType,
    lastModified: file.lastModified,
  });
}
