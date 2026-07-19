# Must import before torch: on Windows, torch/CUDA's native DLLs loaded first
# cause a fatal access violation when pandas (pulled in transitively later by
# transformers.generation's lazy sklearn/pyarrow import) loads afterward.
# Importing pandas first avoids the native DLL load-order conflict. Verified
# via isolated import-order tests in this venv -- reversing the order
# reliably reproduces "Windows fatal exception: access violation".
import pandas
import os
import sys
import faulthandler
_crash_log = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tts_server_crash.log"), "a", buffering=1)
faulthandler.enable(file=_crash_log, all_threads=True)
import time
import gc
import json
import torch
import numpy as np
import soundfile as sf
from pathlib import Path
from typing import Optional
from pydantic import BaseModel
from fastapi import Depends, FastAPI, HTTPException
import uvicorn

# Setup Windows console encoding
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Add current directory to path
sys.path.append(str(Path(__file__).parent.resolve()))

from models.omnivoice_wrapper import OmniVoiceWrapper
from models.vieneu_wrapper import VieneuWrapper
import license_check

app = FastAPI(title="OmniVoice TTS Server")

def require_license():
    # Express already gates /api/synthesize via checkLicense, but this server
    # also listens on 127.0.0.1:8893 and can be called directly, bypassing
    # Express entirely -- verify independently here too.
    if not license_check.is_licensed():
        raise HTTPException(status_code=403, detail="Ứng dụng chưa được kích hoạt bản quyền")

# Global variables
device = "cuda" if torch.cuda.is_available() else "cpu"
wrapper = None
vieneu_wrapper = None
outputs_dir = Path("outputs")
outputs_dir.mkdir(exist_ok=True)

class SynthesizeRequest(BaseModel):
    text: str
    speed: float = 1.0
    voice_id: str = "omnivoice"
    instruct: Optional[str] = None
    ref_audio: Optional[str] = None
    ref_text: Optional[str] = None
    pause_ms: int = 0
    engine: str = "omnivoice"

@app.on_event("startup")
def startup_event():
    global wrapper, vieneu_wrapper, device
    try:
        print(f"🚀 Initializing OmniVoice TTS Server on device: {device}", file=sys.stderr)
        wrapper = OmniVoiceWrapper(device=device)
        # Pre-load model weights into memory/VRAM
        wrapper.load()
        print("🎯 OmniVoice model loaded and ready in memory!", file=sys.stderr)

        print("🚀 Initializing VieNeu-TTS Server on CPU", file=sys.stderr)
        vieneu_wrapper = VieneuWrapper(device="cpu")
        print("🎯 VieNeu-TTS model initialized (lazy load)!", file=sys.stderr)
    except Exception:
        import traceback
        tb = traceback.format_exc()
        print(tb, file=sys.stderr)
        _crash_log.write(tb + "\n")
        _crash_log.flush()
        raise

@app.get("/health")
def health():
    return {
        "status": "ok",
        "device": device,
        "model_loaded": wrapper is not None and wrapper.model is not None,
        "vieneu_ready": vieneu_wrapper is not None
    }

@app.post("/synthesize", dependencies=[Depends(require_license)])
def synthesize(req: SynthesizeRequest):
    if req.engine == "omnivoice" and not req.instruct and not req.ref_audio:
        raise HTTPException(status_code=400, detail="Cần truyền instruct hoặc ref_audio cho OmniVoice")
    if req.engine == "vieneu" and not req.ref_audio:
        raise HTTPException(status_code=400, detail="VieNeu-TTS cần ref_audio để clone giọng")

    try:
        # Measure RAM/VRAM
        try:
            import psutil
            process = psutil.Process(os.getpid())
            start_ram = process.memory_info().rss / (1024 * 1024)
        except Exception:
            start_ram = 0

        gc.collect()

        def write_progress(current, total):
            progress_file = outputs_dir / "progress.json"
            progress_data = {
                "status": "synthesizing",
                "current": current,
                "total": total,
                "time": time.time()
            }
            try:
                with open(progress_file, "w", encoding="utf-8") as f:
                    json.dump(progress_data, f)
            except Exception:
                pass

        # Reset progress before start
        write_progress(0, 1)

        # Run synthesis without unloading the model
        if req.engine == "vieneu":
            audio_data, sample_rate, stats = vieneu_wrapper.synthesize(
                text=req.text,
                speed=req.speed,
                ref_audio=req.ref_audio,
                ref_text=req.ref_text,
                pause_ms=req.pause_ms,
                progress_callback=write_progress
            )
        else:
            audio_data, sample_rate, stats = wrapper.synthesize(
                req.text,
                speed=req.speed,
                instruct=req.instruct,
                ref_audio=req.ref_audio,
                ref_text=req.ref_text,
                pause_ms=req.pause_ms,
                unload_after=False,  # Keep model in memory!
                progress_callback=write_progress
            )

        # Mark progress as complete
        try:
            progress_file = outputs_dir / "progress.json"
            progress_data = {
                "status": "idle",
                "current": 0,
                "total": 0,
                "time": time.time()
            }
            with open(progress_file, "w", encoding="utf-8") as f:
                json.dump(progress_data, f)
        except Exception:
            pass

        output_filename = f"{req.voice_id}_{int(time.time())}.wav"
        output_path = outputs_dir / output_filename

        # Write WAV file
        audio_int16 = (np.clip(audio_data, -1.0, 1.0) * 32767).astype(np.int16)
        sf.write(str(output_path), audio_int16, sample_rate, subtype='PCM_16')

        try:
            end_ram = process.memory_info().rss / (1024 * 1024)
            ram_delta = max(0.0, end_ram - start_ram)
        except Exception:
            ram_delta = 0.0

        stats['ram_usage'] = ram_delta

        return {
            "success": True,
            "audio_path": f"outputs/{output_filename}",
            "stats": stats
        }

    except Exception as e:
        import traceback
        print(f"❌ Error during synthesis: {str(e)}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr)
        return {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }

if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8893
    print(f"Starting Python TTS server on port {port}...", file=sys.stderr)
    try:
        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    except Exception:
        import traceback
        tb = traceback.format_exc()
        print(tb, file=sys.stderr)
        _crash_log.write(tb + "\n")
        _crash_log.flush()
        raise
