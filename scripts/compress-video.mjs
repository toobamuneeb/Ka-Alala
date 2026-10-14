import { spawn, spawnSync } from "node:child_process";
import { statSync, existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

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
    if (a === "--height") opts.height = Number(argv[++i]);
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
    return false;
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
    return false;
  }
  const after = statSync(output).size;
  console.log(
    `  -> ${basename(output)}  ${mb(after)} MB  ` +
      `(${(before / after).toFixed(1)}x smaller, ${(100 - (after / before) * 100).toFixed(1)}% saved)`,
  );
  return true;
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

let ok = 0;
for (const input of opts.inputs) if (await compress(input, opts, encoder)) ok++;
console.log(`\n${ok}/${opts.inputs.length} compressed.`);
process.exit(ok === opts.inputs.length ? 0 : 1);
