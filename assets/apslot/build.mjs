#!/usr/bin/env node
/**
 * build.mjs — APSlot house composition builder for the four Video Studio editing styles.
 *
 * Takes a Studio card (deliverables/<id>.json: shows[0].frames, posts[0].clips, posts[0].hook),
 * the word-level transcript of the source the composition plays (OUTPUT time, i.e. after any
 * EDL tightening), the style, and emits a complete HyperFrames composition from the style's
 * template (assets/apslot/<style>/index-template.html):
 *
 *   node assets/apslot/build.mjs --style hormozi --card card.json --words transcript-words.json \
 *        --project outputs/<p> [--video-duration S] [--clips clips.json] [--sfx public/sfx] \
 *        [--bed public/music/bed.mp3 --bed-volume 0.045] [--no-sfx]
 *
 * Writes <project>/public/index.html, storyboard.json, captions.config.json, review-beats.json
 * and _gen/ (caption fragments). public/ must already hold the media (see prep.mjs), fonts
 * (copied from assets/apslot/fonts by prep.mjs) and vendor/gsap.min.js.
 *
 * Styles (the Studio's creators/<key>.edit, engineStyle in brackets):
 *   kallaway        [breakdown]  top-square motion canvas on a dark grid, James in a rounded band below
 *   kallaway-news   [newsroom]   50/50 proof panel on top, James below with a title badge, number badges
 *   hormozi         [receipts]   full-screen seated close-up, white claim banner pinned, cards over the chest
 *   hormozi-cinema  [cinematic]  full-screen crushed-black grade, question card, hero words, thesis card
 *
 * House rules enforced here: no em dashes in any on-screen text, "Education only · 21+" on screen,
 * nothing on the face (card geometry per style keeps the face clear), no "Made with AI" anywhere.
 * Frames whose text would make an income claim are not filtered here: the Studio's script rules
 * run upstream. Clips (posts[0].clips) are matched to frames by their "line" text.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACK = path.resolve(HERE, "..", "..");
const FPS = 30;
const Q = (t) => Math.round(t * FPS) / FPS;
const f4 = (t) => Q(t).toFixed(4);

// ───────────────────────────── args ─────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) {
    const k = a.slice(2);
    const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "true";
    args[k] = v;
  }
}
const need = (k) => { if (!args[k]) { console.error(`missing --${k}`); process.exit(1); } return args[k]; };
const style = need("style");
const cardPath = need("card");
const wordsPath = need("words");
const project = path.resolve(need("project"));

// ───────────────────────────── styles ─────────────────────────────
export const STYLES = {
  "kallaway": {
    engine: "breakdown", label: "Kallaway Breakdown",
    captions: { maxWordsPerChunk: 2, gapBreak: 0.45, highlight: "^$", uppercase: true },
    capTop: { split: 896, fullhim: 1500, full: 1560 },
    bed: { file: "lofi", volume: 0.10 }, endSecs: 2.6, punchEvery: true,
    sfx: { open: "sub-drop", cut: "whoosh-soft", beat: "pop-click", stamp: "thump", end: "shimmer" },
    volumes: { "sub-drop": 0.7, "whoosh-soft": 0.42, "pop-click": 0.42, "thump": 0.6, "shimmer": 0.5 },
  },
  "kallaway-news": {
    engine: "newsroom", label: "Kallaway Newsroom",
    captions: { maxWordsPerChunk: 3, gapBreak: 0.45, highlight: "^(?:\\$[\\d,.]+|[\\d,.]+%|\\d[\\d,.]*|free|new|out|released?|calculator|tracker|pass|guide)$", uppercase: true },
    capTop: { split: 1640, fullhim: 1640, full: 1560 },
    bed: { file: "synthwave", volume: 0.09 }, endSecs: 2.6, punchEvery: true,
    sfx: { open: "sub-drop", cut: "whoosh-soft", beat: "swish-soft", stamp: "thump", end: "shimmer" },
    volumes: { "sub-drop": 0.65, "whoosh-soft": 0.38, "swish-soft": 0.34, "thump": 0.6, "shimmer": 0.5 },
  },
  "hormozi": {
    engine: "receipts", label: "Hormozi Receipts",
    captions: { maxWordsPerChunk: 4, gapBreak: 0.5, highlight: "^(?:\\$[\\d,.]+|[\\d,.]+%|\\d[\\d,.]*|most|expensive|never|every|down|wrong|lose|odds|same|traps?|bankroll|course)$", uppercase: true },
    capTop: { fullhim: 1060, card: 905, full: 1560 },
    bed: { file: "darksynth", volume: 0.045 }, endSecs: 2.6, punchEvery: false,
    sfx: { open: "sub-drop", cut: null, beat: "swish-soft", stamp: null, end: "boom" },
    volumes: { "sub-drop": 0.6, "swish-soft": 0.32, "boom": 0.55 },
  },
  "hormozi-cinema": {
    engine: "cinematic", label: "Hormozi Cinematic",
    captions: { maxWordsPerChunk: 1, gapBreak: 0.6, highlight: "^$", uppercase: true },
    capTop: { fullhim: 1520, q: 1520, full: 1560 },
    bed: { file: "cinematic", volume: 0.17 }, endSecs: 3.4, questionSecs: 1.9, punchEvery: false,
    sfx: { open: "riser", cut: null, beat: "boom", stamp: null, end: "riser" },
    volumes: { "riser": 0.5, "boom": 0.6 },
  },
};
const S = STYLES[style];
if (!S) { console.error(`unknown style ${style}; one of ${Object.keys(STYLES).join(", ")}`); process.exit(1); }

// ───────────────────────────── inputs ─────────────────────────────
const card = JSON.parse(readFileSync(cardPath, "utf8"));
const words = JSON.parse(readFileSync(wordsPath, "utf8")).filter((w) => w.text && w.text.trim());
const frames = (card.shows?.[0]?.frames || []).map((f) => ({ ...f }));
if (!frames.length) { console.error("card has no shows[0].frames"); process.exit(1); }
const clips = args.clips ? JSON.parse(readFileSync(args.clips, "utf8")) : [];
const videoDur = Number(args["video-duration"] || probeDuration(path.join(project, "public", S.engine === "breakdown" || S.engine === "newsroom" ? "input-video.mp4" : "input-video-vert.mp4")));
const qOff = S.questionSecs || 0;           // cinematic: the question card plays before the video starts
const lastWordEnd = words[words.length - 1].end;

function probeDuration(file) {
  const out = execFileSync(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" });
  return Number(out.trim());
}

// house copy rules: no em/en dashes, never "Made with AI"
const house = (s) => String(s ?? "").replace(/\s*[—–]\s*/g, ", ").replace(/made with ai/gi, "").replace(/\s{2,}/g, " ").trim();
const esc = (s) => house(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9$%' ]+/g, " ").replace(/\s+/g, " ").trim();
const tok = (s) => norm(s).split(" ").filter(Boolean);

// ───────────────────────────── align frames to the transcript ─────────────────────────────
// Each frame's vo is matched to the transcript by its first three words, searching forward from
// the previous frame's end. The Studio's "t" values are a fallback only (they came from the
// Studio's own cut and do not survive tightening).
const wtok = words.map((w) => norm(w.text));
let cursor = 0;
for (const fr of frames) {
  const vt = tok(fr.vo || "");
  fr.wordStart = null; fr.wordEnd = null;
  if (!vt.length) continue;
  const probe = vt.slice(0, Math.min(3, vt.length));
  let found = -1;
  for (let i = cursor; i < wtok.length; i++) {
    let ok = true;
    for (let k = 0; k < probe.length; k++) {
      const a = wtok[i + k] ?? "", b = probe[k];
      if (!(a === b || (a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a))))) { ok = false; break; }
    }
    if (ok) { found = i; break; }
  }
  if (found < 0 && probe.length > 1) {   // retry on a single distinctive word
    const key = vt.find((t) => t.length > 4) || vt[0];
    for (let i = cursor; i < wtok.length; i++) if (wtok[i] === key) { found = i; break; }
  }
  if (found < 0) { console.warn(`WARN frame at ${fr.t} not found in transcript ("${vt.slice(0, 4).join(" ")}"); using t`); fr.start = parseT(fr.t); continue; }
  fr.wordStart = found;
  fr.wordEnd = Math.min(wtok.length - 1, found + vt.length - 1);
  fr.start = words[found].start;
  cursor = found + Math.max(1, vt.length - 2);
}
function parseT(t) { const m = /^(\d+):(\d+(?:\.\d+)?)$/.exec(String(t || "0:00")); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }

// end card: starts after the last word, past the video if the voice runs to the end
const endIdx = frames.findIndex((f) => /end card/i.test(f.visual || "") || (!f.vo && f === frames[frames.length - 1]));
const endFrame = endIdx >= 0 ? frames[endIdx] : null;
const spoken = frames.filter((f) => f !== endFrame);
spoken.forEach((f, i) => { f.end = i + 1 < spoken.length ? spoken[i + 1].start : Math.min(videoDur, lastWordEnd + 0.35); });
const endStart = Q(Math.max(spoken[spoken.length - 1].end, lastWordEnd + 0.3));
const DUR = Q(qOff + endStart + S.endSecs);
if (endFrame) { endFrame.start = endStart; endFrame.end = endStart + S.endSecs; }

// ───────────────────────────── classify frames ─────────────────────────────
function kindOf(fr) {
  const v = (fr.visual || "").trim();
  if (fr === endFrame) return "end";
  if (/^your clip|^your photo|\(MY CLIP\)|\(MY PHOTO\)|^clip:|^photo:/i.test(v) && !/^face/i.test(v)) return "media";
  if (/^split/i.test(v)) return "split";
  if (/^face\s*\+|^face,?\s*card|card:/i.test(v)) return "facecard";
  if (/^face/i.test(v)) return "face";
  if (/^full|takeover|title card/i.test(v)) return "split";
  return v ? "split" : "face";
}
function clipFor(fr) {
  // only frames the Studio marked as a clip or photo moment take media, and only on the exact line
  if (!/clip|photo|\(MY (CLIP|PHOTO)\)/i.test(fr.visual || "")) return null;
  const vo = norm(fr.vo || "");
  for (const c of clips) if (c.line && vo.includes(norm(c.line))) return c;
  return null;
}
// a frame's "visual" after the colon → chip phrases (max 4); " vs " → versus pair
function chipsFrom(fr) {
  let v = (fr.visual || "").replace(/^(split|full|face \+ card|face \+|face, card|card):?\s*/i, "");
  v = v.replace(/\((?:my clip|my photo|graphic|labeled[^)]*|real machine|proof|no site image)[^)]*\)/gi, "").replace(/\s{2,}/g, " ").trim();
  if (!v) return { chips: [], versus: null, money: null };
  const money = (v.match(/\$[\d][\d,]*(?:\.\d+)?/) || [])[0] || null;
  const vs = v.split(/\s+vs\.?\s+/i);
  if (vs.length === 2) return { chips: [], versus: vs.map((s) => cleanChip(s)), money };
  // the Studio writes its beats as quoted phrases and ALL-CAPS runs ('Sitting down before the number' MISTAKE,
  // EXAMPLE meter counts to $475 under MUST HIT BY $500): pull those first, else comma-separated parts.
  const quoted = [...v.matchAll(/['"“‘]([^'"”’]{3,60})['"”’]/g)].map((m) => m[1]);
  const capsRuns = [...v.matchAll(/((?:\$?[A-Z0-9][A-Z0-9$%,.']*\s+){1,}\$?[A-Z0-9][A-Z0-9$%,.']*)/g)].map((m) => m[1].trim())
    .filter((t) => !/^(MY CLIP|MY PHOTO|AI IMAGE|REAL MACHINE|SPLIT|FACE)$/i.test(t) && (t.split(" ").length >= 2 || /\$/.test(t)) && t !== money);
  let chips = [...quoted, ...capsRuns].map(cleanChip).filter((t, i, a) => t && t.length <= 60 && a.indexOf(t) === i);
  if (!chips.length) chips = v.split(/\s*[,;·]\s*|\s+\/\s+/).map(cleanChip).filter((t) => t && t.length <= 60);
  return { chips: chips.slice(0, 4), versus: null, money };
}
function cleanChip(s) { return house(s).replace(/['"“”‘’]/g, "").replace(/^(a |an |the )/i, "").replace(/[.]+$/, "").replace(/\s+\([^)]*\)/g, "").trim(); }
// word-sync a phrase inside a frame's word range → the start time of its first matching word
function syncWord(fr, phrase, fallback) {
  if (fr.wordStart == null) return fallback;
  const keys = tok(phrase).filter((t) => t.length > 3 && !/^(your|their|with|that|this|from|what|when|every|about)$/.test(t));
  for (let i = fr.wordStart; i <= fr.wordEnd; i++) for (const k of keys) if (wtok[i] === k || (wtok[i].length > 4 && wtok[i].startsWith(k.slice(0, 5)))) return words[i].start;
  return fallback;
}
// sentence starts inside the transcript (for receipts' micro zoom cuts)
const sentenceStarts = [];
for (let i = 1; i < words.length; i++) if (/[.!?]$/.test(words[i - 1].text)) sentenceStarts.push(words[i].start);

// key words of a headline: the last two words go on the red bar (breakdown) / get the highlighter (newsroom)
function splitHeadline(text) {
  const t = house(text).replace(/[.]+$/, "");
  const parts = t.split(" ");
  if (parts.length <= 3) return { head: "", key: t };
  return { head: parts.slice(0, -2).join(" "), key: parts.slice(-2).join(" ") };
}

// ───────────────────────────── emit ─────────────────────────────
const cards = [];       // {id, kind, start, end, mode, html, css, hide:[], tl:[], beat:{n,s,tone}, sfx:[...]}
const sfxHits = [];     // {name, at, vol}
let n = 0;
const hostStyle = (h) => `left:0;top:0;width:1080px;height:${h}px;visibility:hidden;opacity:0;`;
const o = (fr) => qOff + fr.start;   // output time of a frame start
const e = (fr) => qOff + fr.end;

function mediaTag(c, id, start, dur, extraClass = "") {
  if (!c) return "";
  const rel = c.file;                                  // relative to public/
  if (/\.(mp4|mov|webm)$/i.test(rel))
    return `<video class="clip media ${extraClass}" id="${id}" src="${rel}" muted playsinline data-start="${f4(start)}" data-duration="${f4(dur)}" data-track-index="3"></video>`;
  return `<img class="media ${extraClass}" id="${id}" src="${rel}" alt="">`;
}
const tagFor = (c) => (c?.kind === "photo" || /\.(jpe?g|png|webp)$/i.test(c?.file || "")) ? "My photo" : "My clip";

for (const fr of frames) {
  const kind = kindOf(fr);
  const id = `card-${String(++n).padStart(2, "0")}`;
  const cid = `c${n}`;
  const st = o(fr), en = fr === endFrame ? DUR : e(fr);
  const dur = Math.max(0.3, en - st);
  const c = { id, cid, kind, start: st, end: en, hide: [], tl: [], css: "", html: "", beat: null, mode: "split" };
  const clip = clipFor(fr);
  if (clip && /\.(mp4|mov|webm)$/i.test(clip.file || "")) c.mediaTop = true;
  const { chips, versus, money } = chipsFrom(fr);
  const head = house(fr.onscreen || "");
  const headMoney = (head.match(/\$[\d][\d,]*/) || [])[0] || money;
  const tone = /mistake|wrong|lose|down|trap|expensive|don't|never|lying/i.test(head + " " + (fr.vo || "")) ? "red" : /free|check|learn|find|set|track|log/i.test(head) ? "green" : "";

  // ---------- Kallaway Breakdown ----------
  if (S.engine === "breakdown") {
    if (kind === "face" || kind === "facecard") {
      c.mode = "fullhim";
      c.tl.push(`toFullhim(${f4(st)}, ${f4(dur)});`, `toSplit(${f4(en)});`);
      if (head) { c.html = `<div class="chip ${tone || "gold"} fchip" id="${cid}-chip"><span class="dot"></span>${esc(head)}</div>`; c.hide.push(`#${cid}-chip`); c.tl.push(`pop("#${cid}-chip", ${f4(st + 0.08)}, 0.35, 0.8);`); }
      c.hostH = 1920;
      if (S.punchEvery) c.tl.push(`punch(${f4(st + 0.04)});`);
      c.beat = { n: `Face · ${head || "punch-in"}`, s: house(fr.vo || "").slice(0, 90), tone: "mute" };
    } else if (kind === "end") {
      c.mode = "full"; c.hostH = 1920;
      const [l1, l2] = head.split(/\s*[·|]\s*/);
      c.html = `<div class="cta"><div class="wm" id="${cid}-wm"><b>AP</b>SLOT</div><div class="line1" id="${cid}-l1">${esc(l1 || "Find it on apslot.com")}</div><div class="line2" id="${cid}-l2">${esc(l2 || "APSLOT.COM")}</div><div class="fine" id="${cid}-fine">Education only · 21+</div></div>`;
      c.hide.push(`#${cid}-wm`, `#${cid}-l1`, `#${cid}-l2`, `#${cid}-fine`);
      c.tl.push(`toTakeover(${f4(st - 0.1)});`, `rise("#${cid}-wm", ${f4(st + 0.1)}, 0.4);`, `rise("#${cid}-l1", ${f4(st + 0.3)}, 0.4);`, `rise("#${cid}-l2", ${f4(st + 0.45)}, 0.4);`, `rise("#${cid}-fine", ${f4(st + 0.6)}, 0.4);`,
        `tl.fromTo("#${id} .cta", { scale: 1 }, { scale: 1.035, duration: ${f4(Math.max(0.5, DUR - st - 0.4))}, ease: "none", immediateRender: false }, ${f4(st + 0.3)});`);   // a slow push so the close never reads as a frozen frame
      sfxHits.push({ name: S.sfx.end, at: st, vol: S.volumes[S.sfx.end] });
      c.beat = { n: "End card", s: head, tone: "green" };
    } else {
      c.mode = "split"; c.hostH = 1080;
      const { head: h1, key } = splitHeadline(head || chips[0] || "");
      let inner = `<div class="hdr" id="${cid}-hdr">${h1 ? `<span>${esc(h1)}</span> ` : ""}<b class="bar">${esc(key)}</b></div>`;
      c.hide.push(`#${cid}-hdr`); c.tl.push(`rise("#${cid}-hdr", ${f4(st + 0.04)});`);
      if (headMoney && !clip && !versus) {   // a dollar figure in the beat: giant count-up on its word, meter bar under it
        const target = Number(headMoney.replace(/[^\d.]/g, ""));
        const at = syncWord(fr, headMoney, st + 0.5);
        inner += `<div class="big" id="${cid}-num">$0</div><div class="track"><div class="fill" id="${cid}-fill"></div></div>`;
        c.hide.push(`#${cid}-num`); c.tl.push(`pop("#${cid}-num", ${f4(Math.max(st + 0.2, at - 0.3))}, 0.35, 0.8);`, `countUp("#${cid}-num", 0, ${target}, ${f4(at)}, 1.2, "$");`, `tl.fromTo("#${cid}-fill", { scaleX: 0 }, { scaleX: ${Math.min(0.96, target / (target + 25)).toFixed(2)}, duration: 1.2, ease: "power2.out", immediateRender: false }, ${f4(at)});`);
        sfxHits.push({ name: S.sfx.beat, at, vol: S.volumes[S.sfx.beat] });
      }
      if (clip) {
        inner += `<div class="shot" id="${cid}-shot">${mediaTag(clip, `${cid}-media`, st, dur)}<span class="tag">${tagFor(clip)}</span></div>`;
        c.hide.push(`#${cid}-shot`); c.tl.push(`pop("#${cid}-shot", ${f4(st + 0.16)}, 0.4, 0.92);`);
        sfxHits.push({ name: S.sfx.beat, at: st + 0.16, vol: S.volumes[S.sfx.beat] });
      } else if (versus) {
        const t2 = syncWord(fr, versus[1], st + dur * 0.5);
        inner += `<div class="vs"><div class="panel" id="${cid}-l"><div class="lab">Feels like</div><div class="txt">${esc(versus[0])}</div></div><div class="panel green" id="${cid}-r"><div class="lab">Actually</div><div class="txt">${esc(versus[1])}</div></div></div>`;
        c.hide.push(`#${cid}-l`, `#${cid}-r`); c.tl.push(`pop("#${cid}-l", ${f4(st + 0.3)}, 0.4, 0.85);`, `pop("#${cid}-r", ${f4(Math.max(t2, st + 0.9))}, 0.4, 0.85);`, `tl.to("#${cid}-l", { opacity: 0.45, duration: 0.25 }, ${f4(Math.max(t2, st + 0.9))});`);
        sfxHits.push({ name: S.sfx.beat, at: st + 0.3, vol: S.volumes[S.sfx.beat] }, { name: S.sfx.beat, at: Math.max(t2, st + 0.9), vol: S.volumes[S.sfx.beat] });
      } else if (chips.length) {
        inner += `<div class="rows">` + chips.map((ch, i) => `<div class="chip ${ch.length > 24 ? "long" : ""} ${i === chips.length - 1 && tone ? tone : ""}" id="${cid}-r${i}"><span class="dot"></span>${esc(ch)}</div>`).join("") + `</div>`;
        chips.forEach((ch, i) => {
          const at = Math.min(en - 0.3, Math.max(st + 0.35 + i * 0.5, syncWord(fr, ch, st + 0.35 + i * (dur - 0.8) / chips.length)));
          c.hide.push(`#${cid}-r${i}`); c.tl.push(`pop("#${cid}-r${i}", ${f4(at)}, 0.35, 0.8);`);
          sfxHits.push({ name: S.sfx.beat, at, vol: S.volumes[S.sfx.beat] });
        });
      }
      if (tone === "red" && !clip) {
        inner += `<div class="stamp" id="${cid}-stamp" data-layout-allow-overlap data-layout-allow-occlusion>${/mistake/i.test(head + fr.vo) ? "Mistake" : /lying|wrong/i.test(head + fr.vo) ? "Wrong" : "Trap"}</div>`;
        const at = Math.max(st + dur * 0.62, en - 1.0);
        c.hide.push(`#${cid}-stamp`); c.tl.push(`slam("#${cid}-stamp", ${f4(at)});`);
        sfxHits.push({ name: S.sfx.stamp, at, vol: S.volumes[S.sfx.stamp] });
      }
      c.html = `<div class="sq">${inner}</div>`;
      sfxHits.push({ name: S.sfx.cut, at: st, vol: S.volumes[S.sfx.cut] });
      c.beat = { n: `Card · ${head || key}`, s: (fr.visual || "").slice(0, 110), tone };
    }
  }

  // ---------- Kallaway Newsroom ----------
  if (S.engine === "newsroom") {
    if (kind === "face" || kind === "facecard") {
      c.mode = "fullhim"; c.hostH = 1920;
      c.tl.push(`toFullhim(${f4(st)}, ${f4(dur)});`, `toSplit(${f4(en)});`);
      if (S.punchEvery) c.tl.push(`punch(${f4(st + 0.04)});`);
      c.beat = { n: `Face · punch-in`, s: house(fr.vo || "").slice(0, 90), tone: "mute" };
    } else if (kind === "end") {
      c.mode = "full"; c.hostH = 1920;
      const [l1, l2] = head.split(/\s*[·|]\s*/);
      c.html = `<div class="cta blue"><div class="kick" id="${cid}-k">APSLOT.COM</div><div class="line1" id="${cid}-l1">${esc(l1 || "Get it on apslot.com")}</div><div class="line2" id="${cid}-l2">${esc(l2 || "APSLOT.COM")}</div><div class="fine" id="${cid}-fine">Education only · 21+</div></div>`;
      c.hide.push(`#${cid}-k`, `#${cid}-l1`, `#${cid}-l2`, `#${cid}-fine`);
      c.tl.push(`toTakeover(${f4(st - 0.1)});`, `rise("#${cid}-k", ${f4(st + 0.1)}, 0.4);`, `rise("#${cid}-l1", ${f4(st + 0.25)}, 0.4);`, `rise("#${cid}-l2", ${f4(st + 0.4)}, 0.4);`, `rise("#${cid}-fine", ${f4(st + 0.55)}, 0.4);`,
        `tl.fromTo("#${id} .cta", { scale: 1 }, { scale: 1.035, duration: ${f4(Math.max(0.5, DUR - st - 0.4))}, ease: "none", immediateRender: false }, ${f4(st + 0.3)});`);
      sfxHits.push({ name: S.sfx.end, at: st, vol: S.volumes[S.sfx.end] });
      c.beat = { n: "End card", s: head, tone: "green" };
    } else {
      c.mode = "split"; c.hostH = 960;
      const { head: h1, key } = splitHeadline(head || chips[0] || "");
      let inner;
      if (clip) {
        inner = `<div class="screen" id="${cid}-scr"><div class="bar"><i></i><i></i><i></i><span class="url">${esc(head || "apslot.com")}</span></div><div class="view">${mediaTag(clip, `${cid}-media`, st, dur, "kb")}</div><span class="tag">${tagFor(clip)}</span></div>`;
        c.hide.push(`#${cid}-scr`); c.tl.push(`pop("#${cid}-scr", ${f4(st + 0.06)}, 0.4, 0.94);`, `tl.fromTo("#${cid}-media", { scale: 1 }, { scale: 1.08, duration: ${f4(dur)}, ease: "none" }, ${f4(st)});`);
      } else {
        const rows = versus ? [versus[0], versus[1]] : chips;
        inner = `<div class="article"><div class="site">APSLOT.COM</div><div class="headline" id="${cid}-hl">${h1 ? esc(h1) + " " : ""}<span class="hi"><i id="${cid}-sweep"></i><b>${esc(key)}</b></span></div>` +
          (rows.length ? `<div class="stats">` + rows.map((r, i) => `<div class="stat ${versus && i === 1 ? "good" : ""}" id="${cid}-s${i}"><span class="n">${i + 1}</span>${esc(r)}</div>`).join("") + `</div>` : "") + `</div>`;
        c.hide.push(`#${cid}-hl`, `#${cid}-sweep`); c.tl.push(`rise("#${cid}-hl", ${f4(st + 0.04)});`, `tl.fromTo("#${cid}-sweep", { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: "power3.out" }, ${f4(Math.max(st + 0.4, syncWord(fr, key, st + 0.5)))});`);
        rows.forEach((r, i) => {
          const at = Math.min(en - 0.3, Math.max(st + 0.6 + i * 0.5, syncWord(fr, r, st + 0.6 + i * (dur - 1) / rows.length)));
          c.hide.push(`#${cid}-s${i}`); c.tl.push(`pop("#${cid}-s${i}", ${f4(at)}, 0.35, 0.85);`);
          sfxHits.push({ name: S.sfx.beat, at, vol: S.volumes[S.sfx.beat] });
        });
      }
      c.html = `<div class="panel">${inner}</div>`;
      // number badges on James's half: numbers or "example N" spoken in this frame
      const nums = [];
      if (fr.wordStart != null) for (let i = fr.wordStart; i <= fr.wordEnd; i++) if (/^\$?\d[\d,.]*%?$/.test(words[i].text.replace(/[.,!?]$/, ""))) nums.push({ t: words[i].start, txt: words[i].text.replace(/[.,!?]$/, "") });
      nums.slice(0, 2).forEach((b, i) => {
        c.badges = (c.badges || []) + `<div class="badge" id="${cid}-b${i}">${esc(b.txt)}</div>`;
        c.hide.push(`#${cid}-b${i}`); c.tl.push(`pop("#${cid}-b${i}", ${f4(b.t)}, 0.3, 0.6);`);
        sfxHits.push({ name: S.sfx.stamp, at: b.t, vol: S.volumes[S.sfx.stamp] });
      });
      sfxHits.push({ name: S.sfx.cut, at: st, vol: S.volumes[S.sfx.cut] });
      c.beat = { n: `Proof · ${head || key}`, s: (fr.visual || "").slice(0, 110), tone };
    }
  }

  // ---------- Hormozi Receipts ----------
  if (S.engine === "receipts") {
    c.hostH = 1920; c.mode = "fullhim";
    if (kind === "end") {
      c.mode = "full";
      const parts = head.split(/\s*[·|]\s*/).map(house).filter(Boolean);
      c.html = `<div class="cta"><div class="logo" id="${cid}-logo"><div class="big">${esc(parts[0] || "APSLOT.COM")}</div>${parts.slice(1, 3).map((p, i) => `<div class="sub">${esc(p)}</div>`).join("")}</div><div class="fine" id="${cid}-fine">Education only · 21+</div></div>`;
      c.hide.push(`#${cid}-logo`, `#${cid}-fine`);
      c.tl.push(`tl.to("#full-video", { opacity: 0.18, duration: 0.5 }, ${f4(st - 0.2)});`, `pop("#${cid}-logo", ${f4(st + 0.05)}, 0.45, 0.9);`, `rise("#${cid}-fine", ${f4(st + 0.5)}, 0.4);`,
        `tl.to("#${cid}-logo", { scale: 1.04, duration: ${f4(Math.max(0.5, DUR - st - 0.55))}, ease: "none" }, ${f4(st + 0.5)});`);   // slow push on the close
      sfxHits.push({ name: S.sfx.end, at: st, vol: S.volumes[S.sfx.end] });
      c.beat = { n: "End card", s: head, tone: "green" };
    } else if (kind === "face") {
      c.html = ""; c.beat = { n: "Face", s: house(fr.vo || "").slice(0, 90), tone: "mute" };
    } else {
      // a card over the chest: photo/clip card or white logo card with big black words
      c.mode = "card";
      const txt = head || chips[0] || versus?.[1] || "";
      if (clip) {   // the on-screen line only (never the frame's description)
        c.html = `<div class="rcard photo" id="${cid}-card">${mediaTag(clip, `${cid}-media`, st + 0.1, dur - 0.1)}<span class="tag">${tagFor(clip)}</span>${head ? `<div class="cap-line">${esc(head)}</div>` : ""}</div>`;
      } else {
        const bits = txt.split(/\s*[·|]\s*/).map(house).filter(Boolean);
        c.html = `<div class="rcard logo" id="${cid}-card"><div class="big">${esc(bits[0] || txt)}</div>${bits.slice(1, 3).map((b) => `<div class="sub">${esc(b)}</div>`).join("")}</div>`;
      }
      c.hide.push(`#${cid}-card`); c.tl.push(`pop("#${cid}-card", ${f4(st + 0.1)}, 0.4, 0.86);`, `tl.to("#${cid}-card", { opacity: 0, y: 24, duration: 0.22, ease: "power2.in" }, ${f4(en - 0.26)});`);
      sfxHits.push({ name: S.sfx.beat, at: st + 0.1, vol: S.volumes[S.sfx.beat] });
      c.beat = { n: `Card · ${txt}`, s: (fr.visual || "").slice(0, 110), tone };
    }
  }

  // ---------- Hormozi Cinematic ----------
  if (S.engine === "cinematic") {
    c.hostH = 1920; c.mode = "fullhim";
    if (kind === "end") {
      c.mode = "full";
      const thesis = house(card.thesis || head || (frames.filter((f) => f.vo).at(-1)?.vo || "")).replace(/[.]+$/, "");
      c.html = `<div class="thesis"><div class="mark" id="${cid}-mark"><b>AP</b>SLOT</div><div class="line" id="${cid}-line">${esc(thesis)}</div><div class="fine" id="${cid}-fine">Education only · 21+</div></div>`;
      c.hide.push(`#${cid}-mark`, `#${cid}-line`, `#${cid}-fine`);
      c.tl.push(`tl.to("#full-video", { opacity: 0, duration: 0.6 }, ${f4(st - 0.3)});`, `rise("#${cid}-line", ${f4(st + 0.15)}, 0.6);`, `rise("#${cid}-mark", ${f4(st + 0.9)}, 0.5);`, `rise("#${cid}-fine", ${f4(st + 1.1)}, 0.5);`,
        `tl.to("#${cid}-line", { scale: 1.03, duration: ${f4(Math.max(0.5, DUR - st - 0.8))}, ease: "none" }, ${f4(st + 0.75)});`);
      sfxHits.push({ name: S.sfx.beat, at: st + 0.15, vol: S.volumes[S.sfx.beat] }, { name: S.sfx.end, at: Math.max(0, st - 1.6), vol: S.volumes[S.sfx.end] });
      c.beat = { n: "Thesis card", s: thesis, tone: "mute" };
    } else {
      // every scene: slow push-in with a reframe jump; hero words when the frame carries text
      const z = n % 2 ? 1.0 : 1.08;
      c.tl.push(`tl.set("#full-video", { scale: ${z} }, ${f4(st)});`, `tl.to("#full-video", { scale: ${(z + 0.06).toFixed(2)}, duration: ${f4(dur)}, ease: "none" }, ${f4(st)});`);
      const txt = head || chips[0] || "";
      if (txt && kind !== "face") {
        const wordsT = house(txt).replace(/[.]+$/, "").split(" ");
        const script = wordsT.length > 2 ? wordsT.slice(-1)[0] : "";
        const caps = wordsT.length > 2 ? wordsT.slice(0, -1).join(" ") : wordsT.join(" ");
        c.html = `<div class="hero" id="${cid}-hero"><div class="caps">${esc(caps)}</div>${script ? `<div class="script">${esc(script)}</div>` : ""}</div>`;
        c.hide.push(`#${cid}-hero`);
        c.tl.push(`tl.fromTo("#${cid}-hero", { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.5, ease: "power2.out" }, ${f4(st + 0.1)});`, `tl.to("#${cid}-hero", { scale: 1.05, duration: ${f4(Math.max(0.5, dur - 0.6))}, ease: "none" }, ${f4(st + 0.6)});`, `tl.to("#${cid}-hero", { opacity: 0, duration: 0.3 }, ${f4(en - 0.3)});`);
        sfxHits.push({ name: S.sfx.beat, at: st + 0.1, vol: S.volumes[S.sfx.beat] * 0.8 });
        c.beat = { n: `Hero words · ${txt}`, s: house(fr.vo || "").slice(0, 90), tone };
      } else {
        c.html = ""; c.beat = { n: "Face · push-in", s: house(fr.vo || "").slice(0, 90), tone: "mute" };
      }
    }
  }
  cards.push(c);
}

// opener hit
if (S.sfx.open) sfxHits.push({ name: S.sfx.open, at: 0, vol: S.volumes[S.sfx.open] });
// receipts: micro zoom cut at each new sentence (100% / 107%)
const extraTl = [];
if (S.engine === "receipts") {
  let zoom = false;
  for (const t of sentenceStarts) { zoom = !zoom; extraTl.push(`tl.set("#full-video", { scale: ${zoom ? 1.07 : 1.0} }, ${f4(qOff + t)});`); }
}

// ───────────────────────────── captions ─────────────────────────────
const modeRanges = cards.filter((c) => c.html !== undefined).map((c) => ({ from: c.start, to: c.end, mode: c.mode }));
const capCfg = {
  fps: FPS, duration: DUR, maxWordsPerChunk: S.captions.maxWordsPerChunk, gapBreak: S.captions.gapBreak,
  modeRanges, colorRanges: [{ from: 0, to: DUR, color: "b" }], highlight: S.captions.highlight, merges: [],
};
mkdirSync(path.join(project, "_gen"), { recursive: true });
mkdirSync(path.join(project, "public"), { recursive: true });
writeFileSync(path.join(project, "captions.config.json"), JSON.stringify(capCfg, null, 2));
// shift words by the question-card offset for cinematic (captions live in output time)
const capWords = words.map((w) => ({ text: w.text, start: w.start + qOff, end: w.end + qOff }));
writeFileSync(path.join(project, "_gen", "words-output.json"), JSON.stringify(capWords));
execFileSync(process.execPath, [path.join(PACK, ".claude/skills/branded-ad-edit/scripts/generate-captions.mjs"), path.join(project, "_gen", "words-output.json"), path.join(project, "captions.config.json"), path.join(project, "_gen")], { stdio: "inherit" });
let spans = readFileSync(path.join(project, "_gen", "caption-spans.html"), "utf8").replace(/[.,](?=(?:<\/em>)?<\/div>)/g, "");
if (S.captions.uppercase) spans = spans.replace(/>([^<]+)</g, (m, t) => ">" + t.toUpperCase() + "<");
const tweens = readFileSync(path.join(project, "_gen", "caption-tweens.js"), "utf8");

// ───────────────────────────── SFX + bed elements ─────────────────────────────
let sfxEls = [];
let track = 11;
const sfxDir = args.sfx ? path.resolve(args.sfx) : null;
const durs = sfxDir && existsSync(path.join(sfxDir, "durations.json")) ? JSON.parse(readFileSync(path.join(sfxDir, "durations.json"), "utf8")) : {};
if (!args["no-sfx"] && sfxDir) {
  sfxHits.filter((h) => h.name && durs[h.name]).sort((a, b) => a.at - b.at).forEach((h, i) => {
    const at = Q(Math.max(0, h.at)); const d = Math.min(durs[h.name], DUR - at - 0.02);
    if (d <= 0.05) return;
    sfxEls.push(`      <audio id="sfx-${String(i).padStart(2, "0")}" src="sfx/${h.name}.mp3" data-start="${at.toFixed(4)}" data-duration="${d.toFixed(3)}" data-track-index="${track++}" data-volume="${(h.vol ?? 0.4).toFixed(2)}"></audio>`);
  });
}
if (args["bed-src"] && !args.bed) {   // trim the style's bed to the composition with a 2.2 s fade-out
  mkdirSync(path.join(project, "public", "music"), { recursive: true });
  const bedOut = path.join(project, "public", "music", "bed.mp3");
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-v", "error", "-i", path.resolve(args["bed-src"]), "-t", DUR.toFixed(3), "-af", `afade=t=in:d=0.25,afade=t=out:st=${Math.max(0, DUR - 2.2).toFixed(3)}:d=2.2`, "-vn", "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", bedOut], { stdio: "inherit" });
  args.bed = bedOut;
}
if (args.bed) {
  const bedRel = path.relative(path.join(project, "public"), path.resolve(args.bed)).split(path.sep).join("/");
  sfxEls.push(`      <audio id="music-bed" src="${bedRel}" data-start="0" data-duration="${DUR.toFixed(3)}" data-track-index="${track++}" data-volume="${Number(args["bed-volume"] || S.bed.volume).toFixed(3)}"></audio>`);
}

// ───────────────────────────── assemble the template ─────────────────────────────
const tplPath = path.join(HERE, style, "index-template.html");
let html = readFileSync(tplPath, "utf8");
const hostsHtml = cards.map((c) => {
  const extra = c.html + (c.badges ? `<div class="badges">${c.badges}</div>` : "");
  const h = c.hostH || 1080;
  // a card that plays a <video> cannot be a timed host (the linter rejects a timed video inside a timed
  // wrapper), so it becomes an untimed media frame the timeline shows and hides like a host
  if (c.mediaTop) return `      <!-- ${c.id}: ${c.kind} (media frame) ${f4(c.start)} to ${f4(c.end)} -->\n      <div class="media-frame" id="${c.id}" style="position:absolute;left:0;top:0;width:1080px;height:${h}px;overflow:hidden;pointer-events:none;visibility:hidden;opacity:0;">\n        <div class="card" data-card-id="${c.id}"><div class="root">${extra}</div></div>\n      </div>`;
  return `      <!-- ${c.id}: ${c.kind} ${f4(c.start)} to ${f4(c.end)} -->\n      <div class="card-host clip" id="${c.id}" data-card-id="${c.id}" data-start="${f4(c.start)}" data-duration="${f4(Math.max(0.2, c.end - c.start))}" data-track-index="2" style="${hostStyle(h)}">\n        <div class="card" data-card-id="${c.id}"><div class="root">${extra}</div></div>\n      </div>`;
}).join("\n");
const hideList = cards.flatMap((c) => c.hide);
const tlCode = cards.map((c) => `          /* ${c.id} */\n` + [`enter('#${c.id}', ${f4(c.start)}, ${c.mode === "fullhim" || c.mode === "card" ? "0.12" : "0.22"});`, ...c.tl, `exit('#${c.id}', ${f4(Math.max(c.start + 0.2, c.end - 0.18))}, 0.16);`].map((l) => "          " + l).join("\n")).join("\n") + "\n" + extraTl.map((l) => "          " + l).join("\n");

const claim = house(card.claim || (frames[0]?.onscreen && /[A-Z]{3,}/.test(frames[0].onscreen) ? frames[0].onscreen : card.posts?.[0]?.hook || card.title || "")).replace(/[.]+$/, "");
const question = house(card.question || frames[0]?.vo?.split(/[.?!]/)[0] || "").replace(/[.]+$/, "");
const badge = house(card.badge || card.posts?.[0]?.hook || "").split(/[.!?]/)[0].slice(0, 44);

const reps = {
  "{{COMPOSITION_ID}}": (card.id || path.basename(project)).replace(/[^a-z0-9-]/gi, "-"),
  "{{DUR}}": DUR.toFixed(3), "{{VIDEO_DUR}}": Math.min(videoDur, DUR - qOff).toFixed(3), "{{VIDEO_START}}": qOff.toFixed(3),
  "{{HIDE_LIST}}": hideList.length ? hideList.join(", ") + " { opacity: 0; }" : "",
  "{{CARDS}}": hostsHtml, "{{TIMELINE}}": tlCode, "{{CAPTION_SPANS}}": spans, "{{CAPTION_TWEENS}}": tweens,
  "{{SFX_ELEMENTS}}": sfxEls.join("\n") || "      <!-- no SFX kit -->",
  "{{CLAIM}}": esc(claim.toUpperCase()), "{{QUESTION}}": esc(question), "{{BADGE}}": esc(badge),
  "{{CAP_TOP_CSS}}": Object.entries(S.capTop).map(([m, y]) => `.cap-${m} { top: ${y}px; }`).join(" "),
};
for (const [k, v] of Object.entries(reps)) html = html.split(k).join(v);
const left = html.match(/\{\{[A-Z_]+\}\}/g);
if (left) { console.error("placeholders left in template: " + [...new Set(left)].join(", ")); process.exit(1); }
if (/[—–]/.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) console.warn("WARN an em or en dash survived into the markup");
writeFileSync(path.join(project, "public", "index.html"), html);

// storyboard + review beats
writeFileSync(path.join(project, "storyboard.json"), JSON.stringify({
  project: path.basename(project), style: S.label, engine: S.engine, duration: DUR, videoDuration: videoDur, questionOffset: qOff,
  cards: cards.map((c) => ({ id: c.id, kind: c.kind, mode: c.mode, start: Q(c.start), end: Q(c.end), beat: c.beat })),
  sfx: sfxHits.filter((h) => h.name).map((h) => ({ name: h.name, at: Q(h.at), vol: h.vol })),
}, null, 2));
// placement manifest for tools/video-qa (hyperframes lane): cards, media and SFX in output time
mkdirSync(path.join(project, "preview"), { recursive: true });
writeFileSync(path.join(project, "preview", "manifest.json"), JSON.stringify([
  ...cards.map((c) => ({ id: c.id, label: c.beat?.n || c.id, start: Q(c.start), dur: Q(Math.max(0.2, c.end - c.start)), track: 2, kind: c.kind === "media" || c.mediaTop ? "media" : "card" })),
  ...sfxHits.filter((h) => h.name && durs[h.name]).map((h, i) => ({ id: `sfx-${i}`, label: h.name, start: Q(Math.max(0, h.at)), dur: durs[h.name], track: 11 + i, kind: "sfx" })),
  ...(args.bed ? [{ id: "music-bed", label: "music bed", start: 0, dur: DUR, track: 99, kind: "music" }] : []),
], null, 1));
writeFileSync(path.join(project, "review-beats.json"), JSON.stringify(cards.filter((c) => c.beat).map((c) => ({ t: Q(c.start), n: c.beat.n, s: c.beat.s, tone: c.beat.tone || "" })), null, 2));
console.log(`built ${S.label}: ${cards.length} cards, ${sfxEls.length} audio elements, DUR ${DUR.toFixed(2)}s (video ${videoDur.toFixed(2)}s${qOff ? ` + question ${qOff}s` : ""}) → ${path.join(project, "public", "index.html")}`);
