import { spawn, spawnSync } from "node:child_process";
import { statSync, existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_HEIGHT = 1080;
const MAX_FPS = 30;
const VIDEO_BITRATE = "2500k";
const AUDIO_BITRATE = "128k";

function parseArgs(argv) {
  const opts = {
    height: MAX_HEIGHT,
    bitrate: VIDEO_BITRATE,
    quality: false,
    inputs: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lesson") opts.lesson = argv[++i];
    else if (a === "--height") opts.height = Number(argv[++i]);
    else if (a === "--bitrate") opts.bitrate = argv[++i];
    else if (a === "--quality") opts.quality = true;
    else if (a.startsWith("--")) throw new Error(`Unknown flag: ${a}`);
    else opts.inputs.push(a);
  }
  return opts;
}

function have(bin) {
  return spawnSync(bin, ["-version"], { stdio: "ignore" }).status === 0;
}

/** Probe one stream value; returns null when ffprobe can't answer. */
function probe(file, stream, field) {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      stream,
      "-show_entries",
      `stream=${field}`,
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      file,
    ],
    { encoding: "utf8" },
  );
  const out = (r.stdout || "").trim().split("\n")[0];
  return out || null;
}

function sourceFps(file) {
  const raw = probe(file, "v:0", "r_frame_rate"); // e.g. "60/1"
  if (!raw) return null;
  const [n, d] = raw.split("/").map(Number);
  return d ? n / d : null;
}

const mb = (bytes) => (bytes / 1048576).toFixed(1);

function buildArgs(input, output, opts, encoder) {
  // Cap the long edge without upscaling, and keep both dimensions even -
  // H.264 rejects odd ones.
  const filters = [
    `scale=w='min(${Math.round((opts.height * 16) / 9)},iw)':h='min(${opts.height},ih)'` +
      `:force_original_aspect_ratio=decrease:force_divisible_by=2`,
  ];

  // Only touch the frame rate when the source is above the cap. Forcing 30 on
  // 24fps footage would duplicate frames and cost bytes for nothing.
  const fps = sourceFps(input);
  if (fps && fps > MAX_FPS + 0.01) filters.push(`fps=${MAX_FPS}`);

  const args = ["-hide_banner", "-y", "-i", input, "-vf", filters.join(",")];

  if (encoder === "libx264") {
    // CRF gives the best size-for-quality, at the cost of CPU time.
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "23",
      "-maxrate",
      opts.bitrate,
      "-bufsize",
      "6000k",
      "-profile:v",
      "high",
    );
  } else {
    // Apple's hardware encoder: far faster, no CRF mode, so pin the bitrate.
    args.push(
      "-c:v",
      "h264_videotoolbox",
      "-b:v",
      opts.bitrate,
      "-maxrate",
      opts.bitrate,
      "-bufsize",
      "6000k",
      "-profile:v",
      "high",
    );
  }

  args.push(
    "-pix_fmt",
    "yuv420p", // the only chroma layout every player decodes
    "-c:a",
    "aac",
    "-b:a",
    AUDIO_BITRATE,
    "-ac",
    "2",
    "-movflags",
    "+faststart", // lets playback begin before the download ends
    output,
  );
  return args;
}

async function compress(input, opts, encoder) {
  if (!existsSync(input)) {
    console.error(`  skipped - no such file: ${input}`);
    return null;
  }
  const before = statSync(input).size;
  const output = join(
    dirname(input),
    `${basename(input, extname(input))}.compressed.mp4`,
  );

  console.log(`\n${basename(input)}  (${mb(before)} MB)`);
  const code = await new Promise((resolve) => {
    const p = spawn("ffmpeg", buildArgs(input, output, opts, encoder), {
      stdio: ["ignore", "ignore", "inherit"],
    });
    p.on("close", resolve);
  });

  if (code !== 0 || !existsSync(output)) {
    console.error(`  FAILED (ffmpeg exit ${code})`);
    return null;
  }
  const after = statSync(output).size;
  console.log(
    `  -> ${basename(output)}  ${mb(after)} MB  ` +
      `(${(before / after).toFixed(1)}x smaller, ${(100 - (after / before) * 100).toFixed(1)}% saved)`,
  );
  return true;
}


/** Read .env.local without pulling in a dotenv dependency. */
function loadEnv() {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const env = {};
  for (const name of [".env.local", ".env"]) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in env)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return env;
}

function probeDuration(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file], { encoding: "utf8" });
  const seconds = Math.round(Number((r.stdout || "").trim()));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

/**
 * Put the compressed file in Storage and point the lesson row at it.
 *
 * Object naming matches createUploadTarget in the admin panel
 * ({chapterId}/{timestamp}.mp4) so both routes produce the same layout.
 */
async function uploadForLesson(lessonId, file) {
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  }

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false } });

  const { data: lesson, error: readErr } = await db
    .from("lessons").select("id, chapter_id, type").eq("id", lessonId).single();
  if (readErr || !lesson) throw new Error(`No lesson ${lessonId}: ${readErr?.message ?? "not found"}`);
  if (lesson.type !== "video") throw new Error(`Lesson ${lessonId} is a ${lesson.type} lesson, not video.`);

  const path = `${lesson.chapter_id}/${Date.now()}.mp4`;
  console.log(`  uploading to chapter_video/${path} ...`);
  const { error: upErr } = await db.storage
    .from("chapter_video")
    .upload(path, await readFile(file), { contentType: "video/mp4", upsert: true });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

  const publicUrl = db.storage.from("chapter_video").getPublicUrl(path).data.publicUrl;
  const patch = { media_url: publicUrl };
  const seconds = probeDuration(file);
  if (seconds) patch.duration_seconds = seconds;

  const { error: updErr } = await db.from("lessons").update(patch).eq("id", lessonId);
  if (updErr) throw new Error(`Lesson update failed: ${updErr.message}`);

  console.log(`  lesson updated -> ${publicUrl}`);
}

const opts = parseArgs(process.argv.slice(2));

if (!opts.inputs.length) {
  console.error(
    "usage: node scripts/compress-video.mjs [--height 1080] [--bitrate 2500k] [--quality] <video> ...",
  );
  process.exit(1);
}
if (!have("ffmpeg") || !have("ffprobe")) {
  console.error(
    "ffmpeg and ffprobe are required - install with: brew install ffmpeg",
  );
  process.exit(1);
}

// VideoToolbox is an Apple framework; everywhere else falls back to libx264.
const encoder =
  opts.quality || process.platform !== "darwin"
    ? "libx264"
    : "h264_videotoolbox";
console.log(
  `encoder: ${encoder}   target: ${opts.height}p / ${opts.bitrate} / ${MAX_FPS}fps max`,
);

if (opts.lesson && opts.inputs.length !== 1) {
  console.error("--lesson takes exactly one input file.");
  process.exit(1);
}

let ok = 0;
for (const input of opts.inputs) {
  const output = await compress(input, opts, encoder);
  if (!output) continue;
  if (opts.lesson) {
    try {
      await uploadForLesson(opts.lesson, output);
    } catch (e) {
      console.error(`  ${e.message}`);
      continue;
    }
  }
  ok++;
}
console.log(`\n${ok}/${opts.inputs.length} ${opts.lesson ? "compressed and uploaded" : "compressed"}.`);
process.exit(ok === opts.inputs.length ? 0 : 1);
