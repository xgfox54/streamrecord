#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "torch @ https://download.pytorch.org/whl/cu121/torch-2.5.1%2Bcu121-cp312-cp312-win_amd64.whl",
#   "faster-whisper==1.2.1", "soundfile>=0.13,<0.14",
#   "pydantic>=2,<3", "typer>=0.19,<1"
# ]
# ///
# ─── How to run ───
# uv run tools/quality/faster_whisper_compare.py --prepare-only
# uv run tools/quality/faster_whisper_compare.py
# Use task-specific UV_CACHE_DIR, HF_HOME and HF_HUB_CACHE directories.
# ──────────────────
from pathlib import Path

import typer

from asr_runtime import Engine, run_engine


def main(directory: Path = Path("outputs/glossary-quality"), prepare_only: bool = False) -> None:
    run_engine(Engine.FASTER, directory, prepare_only)


if __name__ == "__main__":
    typer.run(main)
