#!/usr/bin/env node
/**
 * Repair the Content-Type of lesson audio already in Storage.
 *
 * Most lesson audio was recorded as AAC in an MP4 container but uploaded
 * under a `.mp3` name, so Storage serves it as `audio/mpeg`. iOS believes the
 * Content-Type, tries to parse MPEG frames out of an MP4 file, fails, and the
 * player sits at "loading" forever - which is why audio lessons never played
 * on iPhone. Android and the web sniff the bytes instead and got away with it.
 *
 * This re-uploads each mismatched object's existing bytes under the correct
 * Content-Type. The object path is unchanged, so `lessons.media_url` keeps
 * working and no database rows are touched.
 *
 *   node scripts/fix-audio-content-type.mjs            # report only
 *   node scripts/fix-audio-content-type.mjs --apply    # actually fix
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const APPLY = process.argv.includes("--apply");

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

/** Real container from the first bytes; null when unrecognised. */
function sniff(buf) {
  const ascii = (off, len) => buf.subarray(off, off + len).toString("latin1");
  if (ascii(4, 4) === "ftyp") return "audio/mp4";
  if (ascii(0, 3) === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
  if (ascii(0, 4) === "OggS") return "audio/ogg";
  if (ascii(0, 4) === "fLaC") return "audio/flac";
  return null;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local");
  process.exit(1);
}

// Plain REST rather than @supabase/supabase-js: that client pulls in a
// realtime connection which needs a global WebSocket, and Node 20 has none.
const auth = { apikey: key, authorization: `Bearer ${key}` };

const listed = await fetch(
  `${url}/rest/v1/lessons?select=id,title,media_url&type=eq.audio&media_url=not.is.null`,
  { headers: auth },
);
if (!listed.ok) {
  console.error("Could not list lessons:", listed.status, await listed.text());
  process.exit(1);
}
const lessons = await listed.json();

const BUCKET = "chapter_audio";
const marker = `/public/${BUCKET}/`;
let checked = 0, wrong = 0, fixed = 0, failed = 0;

for (const lesson of lessons) {
  const at = lesson.media_url.indexOf(marker);
  if (at === -1) continue;                       // external link, not ours
  const path = decodeURIComponent(lesson.media_url.slice(at + marker.length));
  checked++;

  const res = await fetch(lesson.media_url);
  if (!res.ok) {
    console.log(`  ! ${path} - fetch ${res.status}`);
    failed++;
    continue;
  }
  const served = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const bytes = Buffer.from(await res.arrayBuffer());
  const real = sniff(bytes);

  if (!real || real === served) continue;
  wrong++;
  console.log(`  ${path}\n    served ${served} -> should be ${real}  (${lesson.title})`);

  if (!APPLY) continue;

  const put = await fetch(
    `${url}/storage/v1/object/${BUCKET}/${path.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "PUT",
      headers: { ...auth, "content-type": real, "x-upsert": "true" },
      body: bytes,
    },
  );
  if (!put.ok) {
    console.log(`    FAILED: ${put.status} ${await put.text()}`);
    failed++;
  } else {
    console.log(`    fixed`);
    fixed++;
  }
}

console.log(
  `\n${checked} checked, ${wrong} mismatched` +
    (APPLY ? `, ${fixed} fixed, ${failed} failed` : " - re-run with --apply to fix"),
);
