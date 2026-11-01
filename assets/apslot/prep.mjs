#!/usr/bin/env node
/**
 * prep.mjs — lay out a project's public/ for an APSlot house build.
 *
 *   node assets/apslot/prep.mjs --source <project>/source.mp4 --project <project> --style <style> \
 *        [--band-y 200] [--clips clips.json] [--bed ~/studio/music/lofi.wav]
 *
 * Makes public/{fonts,vendor,assets,sfx,music}, copies the house fonts and gsap, and encodes the two
 * crops every composition expects (keyframe every second: the renderer seeks per frame):
 *   input-video.mp4       the band James sits in (1080x840, or 1080x960 for kallaway-news), with audio
 *   input-video-vert.mp4  the full 9:16 frame, with audio (receipts and cinematic play this one)
 * A vertical source is scaled to 1080x1920 and the band is cut from it at --band-y (default 200: the
 * MiniMax H3 / Wan desk looks put the head around y 450..800). A 16:9 source gets the branded-ad-edit crops
 * (band and 9:16 centre). Clips (--clips: [{line, src, kind}]) are copied into public/assets, videos
 * re-encoded with dense keyframes and no audio, and <project>/clips.json is written with public-relative
 * paths for build.mjs. --bed encodes the music bed to public/music/bed.mp3 (full length; build.mjs clamps it).
 */
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(HERE, "..", "..");
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";
const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith("--")) args[a.slice(2)] = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "true"; }
const need = (k) => { if (!args[k]) { console.error(`missing --${k}`); process.exit(1); } return args[k]; };
const source = path.resolve(need("source"));
const project = path.resolve(need("project"));
const style = need("style");
const pub = path.join(project, "public");
for (const d of ["fonts", "vendor", "assets", "sfx", "music"]) mkdirSync(path.join(pub, d), { recursive: true });

for (const f of readdirSync(path.join(HERE, "fonts"))) copyFileSync(path.join(HERE, "fonts", f), path.join(pub, "fonts", f));
const gsapCandidates = [path.join(HERE, "vendor", "gsap.min.js"), path.join(PACK, ".claude/skills/talking-head-image-overlays/assets/gsap.min.js")];
const gsap = gsapCandidates.find(existsSync);
if (!gsap) { console.error("gsap.min.js not found; run `npx hyperframes skills update talking-head-recut` or put it at assets/apslot/vendor/gsap.min.js"); process.exit(1); }
copyFileSync(gsap, path.join(pub, "vendor", "gsap.min.js"));

const probe = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-show_entries", "format=duration", "-of", "json", source], { encoding: "utf8" }));
const W = probe.streams[0].width, H = probe.streams[0].height, dur = Number(probe.format.duration);
const bandH = style === "kallaway-news" ? 960 : 840;
const bandY = Number(args["band-y"] ?? 200);
const enc = ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-g", "30", "-keyint_min", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"];
let vfBand, vfVert;
if (H > W) {   // vertical source (AI James pieces)
  vfVert = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30";
  vfBand = `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,crop=1080:${bandH}:0:${Math.min(bandY, 1920 - bandH)},fps=30`;
} else {       // 16:9: the branded-ad-edit crops (face centred by default; tune --band-x if needed)
  const bx = Number(args["band-x"] ?? Math.round((W - H * 1080 / bandH) / 2));
  const vx = Number(args["vert-x"] ?? Math.round((W - H * 1080 / 1920) / 2));
  vfBand = `crop=${Math.round(H * 1080 / bandH)}:${H}:${bx}:0,scale=1080:${bandH},fps=30`;
  vfVert = `crop=${Math.round(H * 1080 / 1920)}:${H}:${vx}:0,scale=1080:1920,fps=30`;
}
console.log(`source ${W}x${H} ${dur.toFixed(2)}s → band 1080x${bandH} (${vfBand}) + vert`);
execFileSync(FFMPEG, ["-y", "-v", "error", "-i", source, "-vf", vfBand, ...enc, path.join(pub, "input-video.mp4")], { stdio: "inherit" });
execFileSync(FFMPEG, ["-y", "-v", "error", "-i", source, "-vf", vfVert, ...enc, path.join(pub, "input-video-vert.mp4")], { stdio: "inherit" });

if (args.clips) {
  const list = JSON.parse(readFileSync(args.clips, "utf8"));
  const out = [];
  for (const c of list) {
    const src = path.resolve(c.src);
    if (!existsSync(src)) { console.warn(`clip missing: ${src}`); continue; }
    const base = path.basename(src).replace(/[^a-z0-9._-]/gi, "_").toLowerCase();
    const isVideo = /\.(mp4|mov|webm|m4v)$/i.test(base);
    const dest = path.join(pub, "assets", isVideo ? base.replace(/\.[^.]+$/, ".mp4") : base);
    if (isVideo) execFileSync(FFMPEG, ["-y", "-v", "error", "-i", src, "-vf", "scale='min(1080,iw)':-2,fps=30", "-an", "-c:v", "libx264", "-crf", "19", "-preset", "medium", "-g", "30", "-keyint_min", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", dest], { stdio: "inherit" });
    else copyFileSync(src, dest);
    out.push({ line: c.line, file: "assets/" + path.basename(dest), kind: c.kind || (isVideo ? "clip" : "photo"), what: c.what || "" });
  }
  writeFileSync(path.join(project, "clips.json"), JSON.stringify(out, null, 2));
  console.log(`clips: ${out.length} → ${path.join(project, "clips.json")}`);
}
if (args.bed) {
  execFileSync(FFMPEG, ["-y", "-v", "error", "-i", path.resolve(args.bed), "-vn", "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", path.join(pub, "music", "bed-full.mp3")], { stdio: "inherit" });
  console.log("bed → public/music/bed-full.mp3 (build.mjs --bed-src trims it to the composition)");
}
console.log("prep done:", pub);
