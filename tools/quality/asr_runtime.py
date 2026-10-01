from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from enum import StrEnum
from pathlib import Path
from typing import assert_never

from huggingface_hub import snapshot_download
from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class Engine(StrEnum):
    FASTER = "faster-whisper"
    NEMOTRON = "nemotron"


class Reference(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    audioPath: Path
    audioSha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    durationSeconds: float = Field(gt=0)


class RunResult(BaseModel):
    model_config = ConfigDict(frozen=True)
    id: str
    audioSha256: str
    engine: str
    model: str
    text: str
    elapsedSeconds: float
    firstPartialMs: float | None = None
    committedMs: float | None = None
    peakRamMiB: float | None = None
    peakVramMiB: float | None = None


def run_engine(
    engine: Engine,
    directory: Path = Path("outputs/glossary-quality"),
    prepare_only: bool = False,
) -> None:
    """Run isolated offline whole-clip ASR with independent reference hashes."""
    import torch

    directory = directory.resolve()
    directory.mkdir(parents=True, exist_ok=True)
    references = TypeAdapter(list[Reference]).validate_json(
        (directory / "references.json").read_text(encoding="utf-8")
    )
    for ref in references:
        digest = hashlib.sha256(ref.audioPath.read_bytes()).hexdigest()
        if digest != ref.audioSha256:
            raise RuntimeError(f"Audio identity mismatch: {ref.id}")
    match engine:
        case Engine.FASTER:
            model_id = "mobiuslabsgmbh/faster-whisper-large-v3-turbo"
            revision = "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf"
            patterns = ["*.json", "*.txt", "model.bin"]
        case Engine.NEMOTRON:
            model_id = "nvidia/nemotron-3.5-asr-streaming-0.6b"
            revision = "ea30d66debe3740a08b573244286791d423d6b3e"
            patterns = ["*.json", "*.safetensors", "*.txt", "*.model"]
        case unreachable:
            assert_never(unreachable)
    model_directory = snapshot_download(model_id, revision=revision, allow_patterns=patterns)
    metadata = {
        "engine": engine.value,
        "model": model_id,
        "modelSnapshot": model_directory,
        "python": sys.version,
        "torch": torch.__version__,
        "cudaRuntime": torch.version.cuda,
        "cudaAvailable": torch.cuda.is_available(),
        "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "cpu",
        "mode": "offline-whole-clip-G0-no-glossary",
        "referenceManifestSha256": hashlib.sha256((directory / "references.json").read_bytes()).hexdigest(),
    }
    (directory / f"{engine.value}-runtime.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    if prepare_only:
        print(json.dumps(metadata))
        return
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable: refusing an unlabelled CPU fallback")
    cuda_dlls = Path(torch.__file__).parent / "lib"
    with os.add_dll_directory(str(cuda_dlls)):
        match engine:
            case Engine.FASTER:
                from faster_whisper import WhisperModel
                import soundfile

                model = WhisperModel(model_directory, device="cuda", compute_type="int8_float32", cpu_threads=4, num_workers=1)
                runs = []
                for ref in references:
                    audio, rate = soundfile.read(ref.audioPath, dtype="float32")
                    if rate != 16000:
                        raise RuntimeError(f"Unexpected sample rate: {rate}")
                    started = time.perf_counter()
                    segments, _ = model.transcribe(audio, language="ko", beam_size=5, vad_filter=False, condition_on_previous_text=False)
                    text = " ".join(segment.text.strip() for segment in segments)
                    runs.append(RunResult(id=ref.id, audioSha256=ref.audioSha256, engine="faster-whisper-cuda-int8_float32-G0", model=model_id, text=text, elapsedSeconds=time.perf_counter() - started))
            case Engine.NEMOTRON:
                import soundfile
                from transformers import AutoModelForRNNT, AutoProcessor

                processor = AutoProcessor.from_pretrained(model_directory, local_files_only=True)
                nemotron = AutoModelForRNNT.from_pretrained(model_directory, local_files_only=True, torch_dtype=torch.float32).to("cuda")
                nemotron.eval()
                runs = []
                with torch.inference_mode():
                    for ref in references:
                        audio, rate = soundfile.read(ref.audioPath, dtype="float32")
                        if rate != 16000:
                            raise RuntimeError(f"Unexpected sample rate: {rate}")
                        torch.cuda.synchronize()
                        torch.cuda.reset_peak_memory_stats()
                        started = time.perf_counter()
                        inputs = processor(audio, sampling_rate=rate, language="ko-KR", return_tensors="pt")
                        inputs = inputs.to(nemotron.device, dtype=nemotron.dtype)
                        output = nemotron.generate(**inputs, return_dict_in_generate=True)
                        decoded = processor.decode(output.sequences, skip_special_tokens=True)
                        if not isinstance(decoded, list) or len(decoded) != 1:
                            raise RuntimeError("Expected exactly one decoded sample")
                        text = decoded[0]
                        torch.cuda.synchronize()
                        runs.append(RunResult(id=ref.id, audioSha256=ref.audioSha256, engine="nemotron35-cuda-float32-G0", model=model_id, text=text, elapsedSeconds=time.perf_counter() - started, peakVramMiB=torch.cuda.max_memory_allocated() / (1024 * 1024)))
            case unreachable:
                assert_never(unreachable)
    if any(not run.text.strip() for run in runs):
        raise RuntimeError("Empty hypothesis: inference failed")
    target = directory / f"{engine.value}-runs.json"
    target.write_text(TypeAdapter(list[RunResult]).dump_json(runs, indent=2).decode(), encoding="utf-8")
    print(json.dumps({"output": str(target), "samples": len(runs), "totalInferenceSeconds": sum(run.elapsedSeconds for run in runs)}))
