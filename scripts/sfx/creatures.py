"""
Creature voices as short sound files (public/sfx/creature-<shape>.mp3), played
like the narration (an audio element), so they are heard wherever the narrator
is: on the Quest 3 (Nov 15) voices synthesised live with Web Audio were played
(the audio context running, seven voices) but not heard. Synthesised here from
simple waves, nothing recorded or licensed; loudness matched to the narration.

  python3 scripts/sfx/creatures.py     (needs numpy and ffmpeg on PATH)
"""
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

RATE = 44100
OUT = Path(__file__).resolve().parents[2] / 'public' / 'sfx'


def t(seconds):
    return np.arange(int(RATE * seconds)) / RATE


def env(n, attack=0.01, release=0.6):
    """Quick rise, then an exponential fall over the note."""
    x = np.arange(n) / RATE
    a = np.clip(x / max(attack, 1e-4), 0, 1)
    return a * np.exp(-x / max(release * (n / RATE), 1e-3) * 2.5)


def sweep(f0, f1, seconds, wave_='sine', vibrato=0.0, curve=1.0):
    x = t(seconds)
    k = (x / seconds) ** curve
    f = f0 + (f1 - f0) * k
    if vibrato:
        f = f * (1 + vibrato * np.sin(2 * np.pi * 6 * x))
    phase = 2 * np.pi * np.cumsum(f) / RATE
    if wave_ == 'sine':
        y = np.sin(phase)
    elif wave_ == 'tri':
        y = 2 / np.pi * np.arcsin(np.sin(phase))
    else:  # soft saw: a few harmonics
        y = sum(np.sin(phase * h) / h for h in range(1, 6))
    return y * env(len(x))


def noise(seconds, smooth=8):
    y = np.random.default_rng(7).standard_normal(int(RATE * seconds))
    y = np.convolve(y, np.ones(smooth) / smooth, mode='same')
    return y * env(len(y), 0.002, 0.3)


def mix(*parts):
    """Sounds started together, padded to the longest."""
    n = max(len(p) for p in parts)
    out = np.zeros(n)
    for p in parts:
        out[: len(p)] += p
    return out


def place(parts, total):
    out = np.zeros(int(RATE * total))
    for at, y in parts:
        i = int(RATE * at)
        out[i:i + len(y)] += y[: len(out) - i]
    return out


VOICES = {
    'bird': lambda: place([(i * 0.17, mix(sweep(2300, 3500, 0.1, vibrato=0.02), 0.3 * sweep(4600, 7000, 0.1))) for i in range(3)], 0.6),
    'fish': lambda: place([(i * 0.13, mix(sweep(380 + 60 * i, 1300 + 120 * i, 0.08, curve=0.6), 0.15 * noise(0.02))) for i in range(3)], 0.5),
    'dog': lambda: place([(0, mix(sweep(330, 190, 0.17, 'saw'), 0.2 * noise(0.06))), (0.28, mix(sweep(310, 180, 0.15, 'saw'), 0.2 * noise(0.05)))], 0.55),
    'rabbit': lambda: place([(0, sweep(300, 950, 0.22, curve=0.5)), (0.27, 0.6 * sweep(380, 1050, 0.18, curve=0.5))], 0.55),
    'cup': lambda: place([(i * 0.12, mix(0.8 * sweep(f, f, 0.9), 0.25 * sweep(2 * f, 2 * f, 0.6))) for i, f in enumerate([1568, 2093, 2637])], 1.3),
    'snail': lambda: place([(0, sweep(420, 600, 0.65, vibrato=0.01, curve=0.7))], 0.75),
    'swan': lambda: place([(0, sweep(340, 300, 0.24, 'saw', vibrato=0.03)), (0.32, sweep(360, 310, 0.22, 'saw', vibrato=0.03))], 0.62),
    'deer': lambda: place([(i * 0.15, mix(0.7 * noise(0.04, 4), sweep(240, 180, 0.06))) for i in range(3)] + [(0.5, 0.5 * sweep(700, 900, 0.18, vibrato=0.02))], 0.75),
    'crocodile': lambda: place([(0, mix(noise(0.05, 3), sweep(110, 70, 0.12, 'tri'))), (0.22, mix(noise(0.05, 3), sweep(105, 65, 0.14, 'tri')))], 0.5),
    # World creatures (src/world-creatures.ts).
    'rocket': lambda: place([(0, mix(0.6 * noise(0.7, 24), 0.5 * sweep(180, 700, 0.7, curve=0.6)))], 0.8),
    'alien': lambda: place([(i * 0.14, sweep(900 + 300 * i, 1400 + 300 * i, 0.12, vibrato=0.08)) for i in range(3)], 0.6),
    'asteroid': lambda: place([(0, mix(noise(0.3, 40), 0.6 * sweep(90, 60, 0.3, 'tri'))), (0.18, 0.5 * noise(0.15, 30))], 0.5),
    'shark': lambda: place([(0, mix(sweep(260, 200, 0.35, 'tri', vibrato=0.02), 0.2 * noise(0.2, 20)))], 0.45),
    'octopus': lambda: place([(i * 0.11, sweep(500 - 40 * i, 650 - 40 * i, 0.09, curve=0.5)) for i in range(4)], 0.6),
    'whale': lambda: place([(0, sweep(160, 320, 0.6, vibrato=0.03, curve=0.6)), (0.5, 0.7 * sweep(300, 180, 0.5, vibrato=0.03))], 1.05),
    'car': lambda: place([(0, sweep(420, 420, 0.14, 'saw')), (0.2, sweep(420, 420, 0.14, 'saw'))], 0.45),
    'plane': lambda: place([(0, mix(0.5 * noise(0.8, 10), 0.4 * sweep(140, 160, 0.8, 'saw', vibrato=0.06)))], 0.85),
    'digger': lambda: place([(i * 0.12, mix(sweep(110, 100, 0.09, 'saw'), 0.2 * noise(0.05, 6))) for i in range(4)], 0.6),
    'trex': lambda: place([(0, mix(sweep(140, 70, 0.5, 'saw', vibrato=0.04), 0.3 * noise(0.4, 12)))], 0.6),
    'pterodactyl': lambda: place([(0, sweep(1600, 1100, 0.16, 'tri', vibrato=0.03)), (0.24, sweep(1500, 1000, 0.14, 'tri', vibrato=0.03))], 0.5),
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for shape, make in VOICES.items():
        y = make()
        y = y / max(1e-6, np.max(np.abs(y))) * 0.9
        pcm = (y * 32767).astype(np.int16)
        with tempfile.NamedTemporaryFile(suffix='.wav') as w:
            with wave.open(w.name, 'wb') as f:
                f.setnchannels(1)
                f.setsampwidth(2)
                f.setframerate(RATE)
                f.writeframes(pcm.tobytes())
            mp3 = OUT / f'creature-{shape}.mp3'
            # A little lead-in; as loud as the narration (which is -18 LUFS), a touch more.
            subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', w.name, '-af', 'adelay=30,loudnorm=I=-16:TP=-1.5',
                            '-ar', '44100', '-ac', '1', '-b:a', '64k', str(mp3)], check=True)
        print(shape, mp3.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
