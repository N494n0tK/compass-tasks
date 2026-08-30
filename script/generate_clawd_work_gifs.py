#!/usr/bin/env python3
"""Split the supplied Clawd typing GIF into work-window motion assets.

The source GIF contains three motions in one timeline: approaching/opening the
laptop (frames 0-11), typing (frames 12-27), and packing up/returning (frames
28-35).  The work window writes a dedicated asset for each one-shot/loop phase
while retaining the source canvas, frame durations, disposal method, and
transparent pixels.

Run from the repository root:

    python3 script/generate_clawd_work_gifs.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/clawd/clawd-type.gif"
INTRO_OUT = ROOT / "public/clawd/clawd-type-work-intro.gif"
LOOP_OUT = ROOT / "public/clawd/clawd-type-work-loop.gif"
PACK_OUT = ROOT / "public/clawd/clawd-type-work-pack.gif"

# Frame 11 is the last opening pose; frame 12 is the first seated pose.
INTRO_RANGE = range(0, 12)

# Frames 12-27 are five complete repetitions of the three-frame typing cycle
# (12, 13, 14) plus its matching return to frame 12.  Frame 28 starts the
# pack-up animation, so it intentionally does not belong in the loop.
LOOP_RANGE = range(12, 28)

# Frame 28 starts the pack-up motion and frame 35 is the packed/standing pose.
PACK_RANGE = range(28, 36)


def load_source() -> tuple[list[Image.Image], list[int], int]:
    source = Image.open(SOURCE)
    if source.size != (100, 100):
        raise ValueError(f"unexpected source dimensions: {source.size}")

    frames: list[Image.Image] = []
    durations: list[int] = []
    for index in range(source.n_frames):
        source.seek(index)
        duration = int(source.info.get("duration", 0))
        if duration <= 0:
            raise ValueError(f"frame {index} has no usable duration")
        # Convert the fully composited frame to RGBA.  This keeps the original
        # transparent background and avoids carrying a prior disposal canvas
        # into the first frame of either new asset.
        frame = source.convert("RGBA").copy()
        # The source carries its infinite-loop extension in every decoded
        # frame's info.  Strip it before writing the intro; otherwise Pillow
        # would silently copy that extension even when no loop kwarg is given.
        frame.info.pop("loop", None)
        frames.append(frame)
        durations.append(duration)

    disposal = int(getattr(source, "disposal_method", 2) or 2)
    return frames, durations, disposal


def write_gif(
    frames: list[Image.Image],
    durations: list[int],
    disposal: int,
    destination: Path,
    *,
    infinite_loop: bool,
) -> None:
    if not frames:
        raise ValueError("cannot write an empty GIF")

    # Pillow's GIF encoder preserves the alpha channel as a transparent
    # palette entry.  Keeping optimize=False avoids disposal/canvas changes
    # that can otherwise make the first loop frame depend on the last one.
    kwargs = {
        "save_all": True,
        "append_images": frames[1:],
        "duration": durations,
        "disposal": disposal,
        "optimize": False,
        "transparency": 0,
    }
    if infinite_loop:
        kwargs["loop"] = 0
    # No Netscape loop extension on the intro means the asset itself is
    # one-shot when viewed independently.  The UI swaps it after its exact
    # duration and therefore does not depend on GIF decoder loop quirks.
    frames[0].save(destination, format="GIF", **kwargs)


def main() -> None:
    frames, durations, disposal = load_source()
    if max(PACK_RANGE) >= len(frames):
        raise ValueError("source GIF is shorter than the chosen split")

    write_gif(
        [frames[i] for i in INTRO_RANGE],
        [durations[i] for i in INTRO_RANGE],
        disposal,
        INTRO_OUT,
        infinite_loop=False,
    )
    write_gif(
        [frames[i] for i in LOOP_RANGE],
        [durations[i] for i in LOOP_RANGE],
        disposal,
        LOOP_OUT,
        infinite_loop=True,
    )
    write_gif(
        [frames[i] for i in PACK_RANGE],
        [durations[i] for i in PACK_RANGE],
        disposal,
        PACK_OUT,
        infinite_loop=False,
    )
    print(f"source: {SOURCE}")
    print(f"intro:  {INTRO_OUT} ({len(INTRO_RANGE)} frames, {sum(durations[i] for i in INTRO_RANGE)} ms)")
    print(f"loop:   {LOOP_OUT} ({len(LOOP_RANGE)} frames, {sum(durations[i] for i in LOOP_RANGE)} ms, infinite)")
    print(f"pack:   {PACK_OUT} ({len(PACK_RANGE)} frames, {sum(durations[i] for i in PACK_RANGE)} ms)")


if __name__ == "__main__":
    main()
