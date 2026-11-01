#!/usr/bin/env python3
"""synth-kit.py — a key-free SFX kit for the APSlot house styles, synthesised with ffmpeg only.

The Video Studio has no ElevenLabs API key of its own (its voice goes through Higgsfield's
elevenlabs_v4 model with a Higgsfield voice element), and Higgsfield exposes no standalone
sound-effects model. This script builds the same effect names the house styles place
(assets/apslot/build.mjs STYLES[*].sfx) from filtered noise and tones, audits the peaks the way
generate-sfx.py does, normalises the kit to -3 dB and writes durations.json in the same shape,
so a real ElevenLabs kit (assets/apslot/sfx/kit.json through generate-sfx.py) is a drop-in swap.

Usage:  python3 assets/apslot/sfx/synth-kit.py <outDir>        (writes <outDir>/<name>.mp3 + durations.json)
"""
import json, os, re, subprocess, sys

FFMPEG = os.environ.get("FFMPEG_PATH", "ffmpeg")
NORMALIZE_DB = -3.0

# name: (seconds, lavfi source graph producing one mono stream named [a])
KIT = {
    # soft airy whoosh: pink noise, band-limited, swelling in and out
    "whoosh-soft": (0.7, "anoisesrc=c=pink:r=48000:d=0.7:a=0.9,highpass=f=350,lowpass=f=2800,afade=t=in:d=0.26,afade=t=out:st=0.3:d=0.4"),
    # softer, shorter swish for card changes
    "swish-soft": (0.5, "anoisesrc=c=white:r=48000:d=0.5:a=0.7,highpass=f=1400,lowpass=f=5200,afade=t=in:d=0.1,afade=t=out:st=0.14:d=0.36"),
    # single clean UI pop: a short decaying tone with a click on top
    "pop-click": (0.3, "aevalsrc='0.9*exp(-28*t)*sin(2*PI*t*(620+900*exp(-60*t)))+0.35*exp(-220*t)*sin(2*PI*2400*t)':s=48000:d=0.3"),
    # bass thump for stamps and badges
    "thump": (0.55, "aevalsrc='0.95*exp(-9*t)*sin(2*PI*t*(60+90*exp(-25*t)))+0.25*exp(-120*t)*random(0)':s=48000:d=0.55"),
    # cinematic sub drop for the open: falling pitch, long tail
    "sub-drop": (1.3, "aevalsrc='0.95*exp(-2.2*t)*sin(2*PI*t*(42+110*exp(-4*t)))':s=48000:d=1.3,afade=t=in:d=0.03"),
    # deep boom for the thesis words and receipts close
    "boom": (1.0, "aevalsrc='0.95*exp(-3.5*t)*sin(2*PI*t*(52+70*exp(-9*t)))+0.3*exp(-60*t)*random(0)':s=48000:d=1.0,lowpass=f=900"),
    # riser into the open and the close: noise swelling with a rising band
    "riser": (1.7, "anoisesrc=c=pink:r=48000:d=1.7:a=0.9,highpass=f=200,lowpass=f=3500,volume='min(1,(t/1.6)*(t/1.6))':eval=frame,afade=t=out:st=1.55:d=0.15"),
    # glassy shimmer for the brand reveal
    "shimmer": (1.1, "aevalsrc='0.3*exp(-2.5*t)*(sin(2*PI*2200*t)+sin(2*PI*3300*t)*0.8+sin(2*PI*4400*t)*0.6)*(0.6+0.4*sin(2*PI*9*t))':s=48000:d=1.1,afade=t=in:d=0.04"),
}


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def peak_db(path):
    out = run([FFMPEG, "-i", path, "-af", "volumedetect", "-f", "null", "-"]).stderr
    m = re.search(r"max_volume:\s*(-?[\d.]+) dB", out)
    return float(m.group(1)) if m else -99.0


def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    out_dir = sys.argv[1]
    os.makedirs(out_dir, exist_ok=True)
    durs = {}
    for name, (secs, graph) in KIT.items():
        raw = os.path.join(out_dir, f"_{name}.wav")
        r = run([FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", graph, "-t", str(secs), "-ac", "1", "-ar", "48000", raw])
        if r.returncode:
            print(f"FAIL {name}: {r.stderr.strip()[:300]}"); sys.exit(1)
        p = peak_db(raw)
        gain = NORMALIZE_DB - p
        final = os.path.join(out_dir, f"{name}.mp3")
        r = run([FFMPEG, "-y", "-v", "error", "-i", raw, "-af", f"volume={gain:.2f}dB", "-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "192k", final])
        if r.returncode:
            print(f"FAIL encode {name}: {r.stderr.strip()[:300]}"); sys.exit(1)
        os.remove(raw)
        durs[name] = secs
        print(f"ok  {name:12s} raw peak {p:6.1f} dB → normalised {peak_db(final):5.1f} dB ({secs}s)")
    json.dump(durs, open(os.path.join(out_dir, "durations.json"), "w"), indent=1)
    print(f"wrote {out_dir}/durations.json ({len(durs)} effects)")


if __name__ == "__main__":
    main()
