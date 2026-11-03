# APSlot house templates

The four editing styles of the APSlot Video Studio (`creators/<key>.edit` in the Studio database)
as HyperFrames compositions, generated from a Studio card instead of hand-authored per video.

| Style key (Studio) | Engine name | Look |
|---|---|---|
| `kallaway` | breakdown | top-square motion canvas on a dark grid, white header with the key words on a red bar, James in a rounded band below, full-face punch-ins, white Barlow captions (1 to 2 words, no colour) |
| `kallaway-news` | newsroom | 50/50: proof panel on top (article header with a yellow highlighter sweep, stat rows, screen capture with Ken Burns), James below with a title badge, number badges, Montserrat captions with cyan key words |
| `hormozi` | receipts | full-screen seated close-up, white claim banner pinned at the top, photo / logo cards over the chest, micro zoom cuts at each sentence, 2 to 5 word captions with yellow key words, almost no music |
| `hormozi-cinema` | cinematic | full-screen crushed-black grade with grain and vignette, a question card before he speaks, giant hero words in the lower band, one-word captions, a black thesis card to close |

House rules the generator enforces: no em dashes anywhere on screen, "Education only · 21+" and the
wordmark on screen the whole time, nothing placed over the face (card geometry per style), no
"Made with AI". Income claims and entry points are the script's job upstream (the Studio's rules).

## Files

- `build.mjs` the generator: Studio card + word transcript + style → `public/index.html`,
  `storyboard.json`, `captions.config.json`, `review-beats.json`. Frames are aligned to the
  transcript by their `vo` text (the Studio's `t` values are a fallback only), chips and badges are
  word-synced, clips from `posts[0].clips` are matched to frames by their `line`.
- `prep.mjs` lays out `public/` (fonts, gsap, the band and full-bleed crops with a keyframe every
  second, the clips re-encoded, the music bed).
- `<style>/index-template.html` the four templates (tokens, chrome, card CSS, timeline helpers).
- `sfx/synth-kit.py` a key-free SFX kit made with ffmpeg; `sfx/kit.json` the same kit as ElevenLabs
  prompts for `.claude/skills/branded-ad-edit/scripts/generate-sfx.py` once a key exists.
- `fonts/` Barlow, Barlow Condensed, Montserrat, Archivo Black, Great Vibes, Instrument Serif
  (Google Fonts, OFL, from fontsource). `vendor/gsap.min.js` (GSAP standard license).

## One build

```bash
P=outputs/<project>
# 1. source: the joined raw AI James pieces (see INTEGRATION.md for the Studio's piece ids)
# 2. transcript: word timings of the source that will PLAY (after any EDL tightening)
python3 assets/apslot/sfx/synth-kit.py $P/public/sfx
node assets/apslot/prep.mjs --source $P/source.mp4 --project $P --style hormozi --clips $P/clips.src.json
node assets/apslot/build.mjs --style hormozi --card $P/card.json --words $P/transcript-words.json \
     --project $P --clips $P/clips.json --sfx $P/public/sfx --bed-src <bed.wav>
npx hyperframes check $P/public && npx hyperframes render $P/public -o $P/output-v1.mp4 --fps 30
# QA (tools/video-qa, hyperframes lane): pass the composition length, or the end card, its SFX and the bed
# fail manifest validation ("Event extends beyond expected duration") whenever they outrun the EDL's last window
DUR=$(node -p "JSON.parse(require('fs').readFileSync('$P/storyboard.json','utf8')).duration")
npm --prefix tools/video-qa run qa:video -- --lane hyperframes --video $P/output-v1.mp4 --edl $P/edl-windows.json \
    --words $P/transcript-words.json --words-are-output --placement $P/preview/manifest.json --duration $DUR --skip-semantic
```

`clips.src.json` is `[{line, src, kind, what}]` with local paths (prep.mjs copies them into
`public/assets` and writes `clips.json` for the build). The card is the Studio deliverable JSON,
or a trimmed copy with `shows[0].frames` and `posts[0].{hook,clips}`.
