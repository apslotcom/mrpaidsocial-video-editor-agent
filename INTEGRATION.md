# INTEGRATION: the video-editor-agent pack as the edit engine behind the Video Studio's AI Shorts

Written 2026-11-01 for James. Nothing in the Studio or its routines has been changed; this file is
the proposal, with the proof and the exact edits for the build routine.

## Go / no-go

**Go, in two steps.** Switch the build routine (`trig_01AU2Xo8qxF4dTg3fLPgSKdA`, "Video Studio: build AI
Shorts") to the pack for the two styles proven on real cards (Kallaway Breakdown, Hormozi Receipts),
keep `make_s_short.py` as the fallback for a run that fails `hyperframes check`, and promote Newsroom
and Cinematic once each has one card through Review. Everything renders in the Higgsfield sandbox
where the routine already works; nothing depends on James's PC.

Why go: the pack build of a real Studio card (soc-20261102-d, Hormozi Receipts, 29 s) went end to end
in the sandbox from the raw MiniMax H3 pieces: transcribe, tighten the four stretched pauses, compose
from the card's frames and James's accepted clips, lint, render (3.5 min), QA, master, upload; it is
attached to the card as a comparison version. It costs 0 credits beyond the lip-sync the routine
already pays for. What the Studio could not do before and the pack does: word-synced karaoke captions
with no caption-time drift, a QA report on the rendered file, deterministic EDL pause removal with
captions that stay in sync, a review canvas with timestamped beats, and compositions that are HTML
the next session can edit instead of a 950-line PIL renderer.

## 1. Feasibility in the Higgsfield sandbox (step 1)

| Check | Result |
|---|---|
| Clone + setup | `git clone` of the fork into `~/studio/pack`, `bash scripts/setup.sh --lane hyperframes`: 7 passed, 0 required missing (installs the HyperFrames CLI under `tools/hyperframes`). |
| Chromium | HyperFrames needs a Chrome for check/snapshot/render. The sandbox image ships Playwright's Chromium at `/ms-playwright/chromium-1243/chrome-linux64/chrome` (`PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`). Set `HYPERFRAMES_BROWSER_PATH` to it; `hyperframes doctor` then reports "Chrome: env". No download, no `playwright install`. It is part of the image, so it is there after a sandbox replacement too (the sandbox was replaced once during this work and everything under `~/studio` and `/ms-playwright` was still there). |
| ffmpeg 5.1 | Fine for this lane. HyperFrames only needs ffmpeg/ffprobe; the EDL cut uses `-filter_complex_script` which 5.1 still has (ffmpeg 8 dropped it; the pack's Windows fix uses `-/filter_complex` there). `hyperframes doctor` notes loudness numbers differ from 8.0.1; we measure with `ebur128` ourselves. |
| `check` | `apslot-475-of-500/public`: 0 errors in 15 s. |
| `snapshot` | 8 frames in about 25 s; the contact sheet comes back through `sandbox_exec image_paths` for a look. |
| `render` on 1 CPU, 8 GB | 29.4 s Short (882 frames, 1080x1920, 30 fps): **3 min 37 s** (216 s, about 7.3x real time, software GPU mode). The Receipts proof (28.9 s): see §4. Expect about 7 to 8 s of render per second of video; a 60 s Short is about 8 min, inside the 15 min background bound. `size:"xl"` is not needed for Shorts up to about 100 s. |
| Persistence | `~/studio/pack` (clone, node_modules, built projects) persists like `~/studio/ai` does (Modal volume). Processes do not survive a replacement: run the render with `background:true` and poll its log; if a poll finds the log gone, start the render again (it is idempotent). |
| Transcription | `faster-whisper` (preinstalled, `small.en`, int8) gives word timings in 7 s for 29 s of audio. HyperFrames' own `transcribe` needs whisper.cpp, not installed; not needed. |

**Decision: render in the sandbox.** It is free, already where the routine works, and fast enough. The
"runs on James's PC" trigger pattern (`trig_012F3gWhWpxuxqhX6MYEna3K`, a routine bound to the Claude Desktop
device that reads his folders through the device shell) stays the fallback for the day the sandbox image
loses Chromium: the pack is installed and proven on the PC too (Node 26, ffmpeg 9, Parakeet).

## 2. The ElevenLabs key and the sound stage (step 2)

There is **no ElevenLabs API key anywhere in the pipeline**. The voice is made by the ideas and
script routines with Higgsfield's `generate_audio`, model `elevenlabs_v4`, `voice_type: "element"`,
`voice_id` = `aishorts/settings` → `voice.elevenlabs.voice_id` (a Higgsfield voice element made from
James's recording), stability from `creators/<style>.voice.elevenlabs`. Higgsfield proxies ElevenLabs;
James never sees a key, and the renderer scripts in `~/studio/ai` contain none (grepped). Higgsfield's
catalog has no standalone sound-effects or music model either (`mirelo_text_to_audio` and
`sonilo_music` are game-pipeline only and refused for standalone use).

So the pack's sound stage was adapted rather than pointed at "the same key":

- **SFX**: `assets/apslot/sfx/synth-kit.py` builds the house kit (whoosh, swish, pop, thump, sub-drop,
  boom, riser, shimmer) with ffmpeg's tone and noise sources, peak-normalised, with the same
  `durations.json` shape as the pack's ElevenLabs kit script. 0 credits, no key, 2 s to make.
- **Music bed**: the Studio's own beds in `~/studio/music` (lofi, synthwave, darksynth, cinematic,
  made with vidIQ on Oct 31), trimmed to the composition with a 2.2 s fade, at the volume each
  creator profile names (0.10 / 0.09 / 0.045 / 0.17), which lands the bed about 19 dB under the
  voice peaks (measured on the proof: see §4).
- **The stage, run once on `apslot-475-of-500`** (the Kallaway proof from the PC) in the sandbox: kit + the
  lo-fi bed. Measured voice peak −4.0 dBFS, bed peak −0.2 dBFS → bed `data-volume` 0.0724 = 19 dB under
  the voice peaks; 20 hits placed on the storyboard beats (sub-drop open, whoosh per card, pop per chip and
  count-up, thump on the stamp, shimmer on the end card). Rendered in 3 min 39 s, mastered to −14.9 LUFS /
  −1.4 dBTP → `output-v2.mp4`, 0 credits:
  https://d2ol7oe51mr4n9.cloudfront.net/user_35pw6ktSBMf2xIjMgJ1os8aesB9/c858c4c2-521d-464f-9bcb-c78b5d323aa4.mp4
- **If James wants ElevenLabs sound**: `assets/apslot/sfx/kit.json` holds the same eight effects as
  ElevenLabs prompts for `.claude/skills/branded-ad-edit/scripts/generate-sfx.py`. The routine would
  write `ELEVENLABS_API_KEY=...` into `~/studio/pack/.env` at run start from a routine env var
  (never into the Studio database). Cost: about 8 sound-generation calls per kit (kits are reused
  across videos) plus one music call per video; ElevenLabs bills these from the plan's character
  quota. Not needed for parity.

## 3. The four house styles (step 3)

`assets/apslot/` holds `build.mjs` (one generator), `prep.mjs` (crops, fonts, gsap, clips, bed), four
`<style>/index-template.html` files matching `creators/<key>.edit` (palette, layout, caption rules,
cadence), the fonts and the SFX kit. `build.mjs` takes a card's `shows[0].frames`, `posts[0].clips`
and the word transcript and emits the composition, a storyboard, caption config, QA placements and
review beats. `assets/apslot/README.md` documents the files and one build.

| Studio style | Template | Proven on |
|---|---|---|
| kallaway (Breakdown) | dark grid canvas on top, white header + red key-word bar, chips and a count-up word-synced, MISTAKE stamp, James in a rounded band, punch-ins, Barlow captions 1 to 2 words no colour | the 475 card rebuilt locally and in the sandbox (check 0 errors, snapshots) |
| kallaway-news (Newsroom) | 50/50 proof panel (article header with highlighter sweep, stat rows, screen capture with Ken Burns), title badge, number badges, Montserrat captions with cyan key words | template built and linted; no real card yet |
| hormozi (Receipts) | full-screen close-up, white claim banner pinned, photo/logo cards over the chest, micro zoom at each sentence, 2 to 5 word captions with yellow key words | **the proof card** (§4), rendered in the sandbox |
| hormozi-cinema (Cinematic) | crushed-black grade with grain and vignette, question card before the voice, hero words (Archivo Black + Great Vibes) in the lower band, slow push-ins with reframe jumps, one-word captions, black thesis card | template built and linted; no real card yet |

House rules in the generator: no em dashes (replaced in all on-screen text), "Education only · 21+"
and the wordmark on screen for the whole video, nothing over the face (card geometry per style),
no "Made with AI". One known gap against the old engine: Cinematic's hero words sit in the lower
band instead of being masked behind James's body (the old engine used selfie segmentation; the pack
has no segmentation step, and a word crossing the face would break the face rule).

## 4. The proof card (step 4)

Card: `deliverables/soc-20261102-d-ai-shorts` ("The most expensive bet in the casino", Hormozi
Receipts, approved and watched, 28 s). Raw pieces: MiniMax H3 jobs `6c42cdc0`, `423ae634`, `64cd7efd`
from the generation history (5.2 s + 13.7 s + 10.1 s, 1440x2560, 24 fps). James's accepted media from
`posts[0].clips` (floor walk clip, chandelier floor photo, bank walk-up clip).

What ran, in `~/studio/pack/outputs/apslot-expensive-bet`:

1. join the three pieces → `source.mp4` (1080x1920, 30 fps, keyframe every second), 29.0 s
2. `faster-whisper small.en` word timings (86 words, 7 s), `silencedetect` → four pauses H3 had
   stretched to about 1 s (after "casino", "ago", "wrong", "casino"), the same ones James flagged
   on Nov 1; `edl.json` cuts each back to about 0.3 s, frame-quantised, onsets protected; cut 3
   also removes the piece 2/3 splice → `source-tight.mp4` 26.2 s; transcript remapped through the
   EDL with `edl-tighten/scripts/remap-transcript.py` (never re-transcribed)
3. `synth-kit.py` → 8 effects; `prep.mjs` → crops, fonts, gsap, the three clips re-encoded, bed
4. `build.mjs --style hormozi` → 10 cards, 25 caption chunks, 8 SFX hits + bed, DUR 28.9 s
5. `hyperframes check`: 0 errors; `snapshot` x 8 looked at (claim banner, chest cards, captions
   clear of the face, end card)
6. `hyperframes render`: 867 frames in **3 min 26 s** on 1 CPU (software capture, 1 worker, about
   4.2 fps); the file probes at 28.906 s, 1080x1920, 30 fps, h264 + aac. Raw mix: −17.9 LUFS,
   peak −1.6 dBFS. SFX audit (the kit mixed offline at the placed volumes): each hit peaks 9 dB
   under the voice peak, which is the "audible-subtle" band the pack's audio notes describe and
   what the Receipts profile asks for ("nothing cartoonish").
7. QA (`tools/video-qa`, hyperframes lane with the EDL windows, output-time words and the placement
   manifest; Gemini and frame layers skipped, no keys). First pass on the raw render: FAIL with one HIGH
   (the static end card read as frozen frames 27.2 to 28.8 s), two MEDIUM (raw loudness −17.9 LUFS before
   mastering; 1 s of near-silence under the almost subliminal Receipts bed at the tail). Fix: every house
   end card now carries a slow push (`build.mjs`), the QA runs on the mastered file. Second pass on
   `output-v2.mp4`: **PASS_WITH_WARNINGS, 0 issues** (technical layer complete; the transcript layer is
   degraded without source-time words, pass `--source-words transcript-words.json` to enable the
   clipped-word checks). Re-render after the fix: 3 min 18 s.
8. master: `loudnorm=I=-14:TP=-1.5:LRA=11` with the video stream copied → `output-v1.mp4` measures
   **−14.7 LUFS integrated, true peak −1.4 dBTP**, 28.907 s.
9. upload: `media_upload` → PUT from the sandbox (HTTP 200) → `media_confirm` → CloudFront URL; attached to
   the card as a `versions[]` entry labelled "pack build" (document version 20 → 21; status, posts and
   approval untouched). Review canvas config, beats, EDL, storyboard and notes:
   `outputs/apslot-expensive-bet/` in the pack checkout on the PC (gitignored, media stays out of git).

Watch the pack build: https://d2ol7oe51mr4n9.cloudfront.net/user_35pw6ktSBMf2xIjMgJ1os8aesB9/e926ec20-fcdd-4bdf-966b-051abb0f82bb.mp4
(the Studio's own cut of the same card, for the side-by-side, is `posts[0].mediaUrl` on the card).

## 5. What the build routine should run instead of `make_s_short.py`

Environment (once per sandbox life; all idempotent):

```bash
export HYPERFRAMES_BROWSER_PATH=/ms-playwright/chromium-1243/chrome-linux64/chrome HYPERFRAMES_NO_TELEMETRY=1 HYPERFRAMES_NO_UPDATE_CHECK=1
[ -d ~/studio/pack ] || git clone -q https://github.com/apslotcom/mrpaidsocial-video-editor-agent.git ~/studio/pack
cd ~/studio/pack && git fetch -q origin feat/apslot-studio-integration && git checkout -q -B feat/apslot-studio-integration FETCH_HEAD
[ -x tools/hyperframes/node_modules/.bin/hyperframes ] || bash scripts/setup.sh --lane hyperframes
[ -d tools/video-qa/node_modules ] || npm --prefix tools/video-qa install --no-audit --no-fund
```

Per video (`$P=~/studio/pack/outputs/<card id>`; `$STYLE` is the card's creator key):

```bash
# 1. source: the lip-sync pieces in order (Wan 2.7: the model's video with James's take laid on top as today;
#    MiniMax H3: the pieces' own audio is the timing master, as today)
printf "file 'piece1.mp4'\nfile 'piece2.mp4'\n" > $P/raw/concat.txt
ffmpeg -y -f concat -safe 0 -i $P/raw/concat.txt -vf "scale=1080:1920,fps=30" -c:v libx264 -crf 17 -g 30 -keyint_min 30 -pix_fmt yuv420p -c:a aac -b:a 192k -ar 48000 -movflags +faststart $P/source.mp4
# 2. words + pauses (faster-whisper, word_timestamps=True) → transcript-words.json; silencedetect -38dB:d=0.22
# 3. H3 only: pauses over 0.6 s → edl.json cuts (keep 0.3 s, frame-quantised, onset − 1 frame), one trim/concat
#    filtergraph → source-tight.mp4; remap the words:
python3 .claude/skills/edl-tighten/scripts/remap-transcript.py $P/transcript-words.json --cuts $P/edl.json --fps 30 -o $P/transcript-words.tight.json
# 4. compose
python3 assets/apslot/sfx/synth-kit.py $P/public/sfx
node assets/apslot/prep.mjs --source $P/source-tight.mp4 --project $P --style $STYLE --clips $P/clips.src.json
node assets/apslot/build.mjs --style $STYLE --card $P/card.json --words $P/transcript-words.tight.json --project $P \
     --clips $P/clips.json --sfx $P/public/sfx --bed-src ~/studio/music/<bed>.wav
# 5. lint, look, render (render with background:true; poll the log)
npx --prefix tools/hyperframes hyperframes check $P/public
npx --prefix tools/hyperframes hyperframes snapshot $P/public --at <card starts> --no-end   # look via image_paths
npx --prefix tools/hyperframes hyperframes render $P/public -o $P/_render-raw.mp4 --fps 30
# 6. QA + master (video copied, audio limited to −14 LUFS / ≤ −1 dBTP), then upload as today
npm --prefix tools/video-qa run qa:video -- --lane hyperframes --video $P/_render-raw.mp4 --edl $P/edl-windows.json \
    --words $P/transcript-words.tight.json --words-are-output --placement $P/preview/manifest.json --skip-semantic
ffmpeg -y -i $P/_render-raw.mp4 -c:v copy -af "loudnorm=I=-14:TP=-1.5:LRA=11" -c:a aac -b:a 192k $P/output-v1.mp4
```

`card.json` is the Studio deliverable (or its `shows`, `posts[0].hook`, `posts[0].clips`); `clips.src.json`
is `[{line, src, kind}]` with the accepted uploads already curled into the sandbox (the routine does this
today). `<bed>` is `creators/<style>.edit.music`'s file. Beds and the four styles map: kallaway → lofi,
kallaway-news → synthwave, hormozi → darksynth, hormozi-cinema → cinematic.

### Cost and time per video

| Item | Today (`make_s_short.py`) | Pack |
|---|---|---|
| Higgsfield credits for the edit | 0 | 0 (the lip-sync, covers and vidIQ pass are unchanged: about 110 credits a card as logged on the proof card) |
| ElevenLabs | none | none (synthesised kit + Studio beds); optional key for a generated kit |
| Render wall time, 30 s Short, 1 CPU | about 1 min (PIL frames) | about 3.5 min, plus about 1 min for transcription, crops and QA |
| Render wall time, 60 s Short | about 2 min | about 7 to 8 min (background job; under the 15 min bound) |

## 6. The routine prompt change (applied 2026-11-03)

James approved this on 2026-11-03 and the build routine `trig_01AU2Xo8qxF4dTg3fLPgSKdA` was updated at 14:19 UTC
(9:19 AM ET), before its 1:17 PM ET run, so the first unattended build on the pack is the Nov 3 1:17 PM ET run.
The live STEP 2 paragraph is the `+` line below, word for word, followed by the house-rule sentences the old
paragraph already carried (captions, "Education only · 21+", no "Made with AI", accepted length, upload).
One caution for anyone editing the routine again: the update API replaces `job_config` wholesale, so send the
full config (environment, events, session context with the system prompt, tags); keep the `get` output as the
backup first.

In `trig_01AU2Xo8qxF4dTg3fLPgSKdA` → STEP 2 "BUILD EACH ONE", the paragraph that started
"Render in the Higgsfield sandbox (free) with ~/studio/ai/make_s_short.py" became:

```diff
-- Render in the Higgsfield sandbox (free) with ~/studio/ai/make_s_short.py, the four-style engine (James, Oct 31: "4 completely different editing styles"): spec.style = creators/<style>.engineStyle (kallaway -> breakdown, kallaway-news -> newsroom, hormozi -> receipts, hormozi-cinema -> cinematic; an idea with no style uses kallaway). Build the spec from creators/<style>.edit (layout, graphic beat every 1 to 2 s for breakdown, top-panel proof for newsroom, claim banner and photo cards for receipts, question card, hero words and thesis card for cinematic), the music bed it names in ~/studio/music, and the engine docstring for spec keys. Restore the engine, segmask.py, the music beds, fonts and selfie model, vocheck.py and bilabial.py from aishorts/settings styles.engine and styles.scripts if missing. make_k_short.py and make_h_short.py only re-render cards they already made.
+- Render in the Higgsfield sandbox (free) with the video-editor-agent pack at ~/studio/pack (branch feat/apslot-studio-integration of github.com/apslotcom/mrpaidsocial-video-editor-agent; clone and run `bash scripts/setup.sh --lane hyperframes` if missing; export HYPERFRAMES_BROWSER_PATH=/ms-playwright/chromium-1243/chrome-linux64/chrome). Follow ~/studio/pack/INTEGRATION.md §5 exactly: join the lip-sync pieces into source.mp4, word-time it with faster-whisper, on MiniMax H3 results cut every pause over 0.6 s back to 0.3 s through an EDL (edl.json, remap-transcript.py; never trim a piece to the take length or lay the take over H3 video), write the card's shows[0].frames, posts[0].hook and the accepted uploads to card.json and clips.src.json, then prep.mjs, build.mjs --style <creator key> (kallaway, kallaway-news, hormozi, hormozi-cinema; an idea with no style uses kallaway) with the bed creators/<style>.edit.music names, hyperframes check (0 errors, else fix the card frames and rebuild), snapshot and look at every card, render in the background and poll, run tools/video-qa on the file, master to −14 LUFS / −1.5 dBTP. If check or render fails twice, fall back to ~/studio/ai/make_s_short.py for that video and say so on the card. Restore the music beds, vocheck.py and bilabial.py from aishorts/settings styles.scripts if missing.
```

And in STEP 0 LOAD, add to the ToolSearch list nothing (the pack uses only sandbox_exec, media_upload,
media_confirm, which are already loaded). The daily cuts/posting, rework, looks, scripts/voice and ideas
routines do not change: they never touch the renderer.

## 7. Risks and what is not parity yet

- Newsroom and Cinematic have templates but no real card through them yet. Promote after one each.
- Kallaway's "a new graphic beat every 1 to 2 s" is only as rich as the card's frames: the generator
  makes chips, count-ups and stamps from the Studio's `visual` text (quoted phrases, ALL-CAPS runs,
  dollar figures). A frame described in prose gets one header. The ideas routine's frame text is
  the lever here, not the renderer.
- The render takes about 3x longer than the PIL engine. Still well inside the routine's budget.
- QA's Gemini layer (watch and listen) is off without a `GEMINI_API_KEY`; technical, transcript and
  frame layers run.
- `tools/video-qa` installs about 90 MB of node modules in the sandbox once; `setup.sh` skips it.
