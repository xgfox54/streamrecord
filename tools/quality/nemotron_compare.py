#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12,<3.13"
# dependencies = [
#   "torch @ https://download.pytorch.org/whl/cu118/torch-2.6.0%2Bcu118-cp312-cp312-win_amd64.whl",
#   "transformers==5.18.0", "soundfile>=0.13,<0.14", "accelerate>=1.1,<2",
#   "pydantic>=2,<3", "typer>=0.19,<1", "librosa>=0.11,<0.12"
# ]
# ///
# ─── How to run ───
# uv run tools/quality/nemotron_compare.py --prepare-only
# uv run tools/quality/nemotron_compare.py
# Use task-specific UV_CACHE_DIR, HF_HOME and HF_HUB_CACHE directories.
# ──────────────────
from pathlib import Path

import typer

from asr_runtime import Engine, run_engine


def main(directory: Path = Path("outputs/glossary-quality"), prepare_only: bool = False) -> None:
    run_engine(Engine.NEMOTRON, directory, prepare_only)


if __name__ == "__main__":
    typer.run(main)
