import os
import sys
import argparse
import json
import time
import gc
import torch
import numpy as np
import soundfile as sf
from pathlib import Path

# Setup Windows console encoding
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# Add project root to sys.path
sys.path.append(str(Path(__file__).parent.resolve()))

from models.omnivoice_wrapper import OmniVoiceWrapper
from models.vieneu_wrapper import VieneuWrapper
import license_check

def main():
    if not license_check.is_licensed():
        print(json.dumps({"success": False, "error": "Ứng dụng chưa được kích hoạt bản quyền"}, ensure_ascii=False))
        sys.exit(1)

    parser = argparse.ArgumentParser(description="OmniVoice Text-to-Speech CLI")
    parser.add_argument("--text", type=str, required=True, help="Text to synthesize")
    parser.add_argument("--speed", type=float, default=1.0, help="Speaking speed")
    parser.add_argument("--voice-id", type=str, default="omnivoice", help="Voice id, used only to name the output file")
    parser.add_argument("--instruct", type=str, default=None, help="Style description for a built-in preset voice")
    parser.add_argument("--ref-audio", type=str, default=None, help="Path to a reference audio file for voice cloning")
    parser.add_argument("--ref-text", type=str, default=None, help="Transcript of the reference audio (improves cloning quality)")
    parser.add_argument("--pause-ms", type=int, default=0, help="Silence inserted between sentences, in milliseconds")
    parser.add_argument("--engine", type=str, default="omnivoice", help="Engine to use: omnivoice or vieneu")

    args = parser.parse_args()

    if args.engine == "omnivoice" and not args.instruct and not args.ref_audio:
        print(json.dumps({"success": False, "error": "Cần truyền --instruct hoặc --ref-audio cho OmniVoice"}))
        return
    elif args.engine == "vieneu" and not args.ref_audio:
        print(json.dumps({"success": False, "error": "Cần truyền --ref-audio cho VieNeu-TTS"}))
        return

    device = "cuda" if torch.cuda.is_available() else "cpu"
    if args.engine == "vieneu":
        wrapper = VieneuWrapper(device="cpu")
    else:
        wrapper = OmniVoiceWrapper(device=device)

    outputs_dir = Path("outputs")
    outputs_dir.mkdir(exist_ok=True)

    try:
        import psutil
        process = psutil.Process(os.getpid())
        start_ram = process.memory_info().rss / (1024 * 1024)
    except Exception:
        start_ram = 0

    gc.collect()

    try:
        if args.engine == "vieneu":
            audio_data, sample_rate, stats = wrapper.synthesize(
                args.text,
                speed=args.speed,
                ref_audio=args.ref_audio,
                ref_text=args.ref_text,
                pause_ms=args.pause_ms
            )
        else:
            audio_data, sample_rate, stats = wrapper.synthesize(
                args.text,
                speed=args.speed,
                instruct=args.instruct,
                ref_audio=args.ref_audio,
                ref_text=args.ref_text,
                pause_ms=args.pause_ms
            )

        output_filename = f"{args.voice_id}_{int(time.time())}.wav"
        output_path = outputs_dir / output_filename

        audio_int16 = (np.clip(audio_data, -1.0, 1.0) * 32767).astype(np.int16)
        sf.write(str(output_path), audio_int16, sample_rate, subtype='PCM_16')

        try:
            end_ram = process.memory_info().rss / (1024 * 1024)
            ram_delta = max(0.0, end_ram - start_ram)
        except Exception:
            ram_delta = 0.0

        stats['ram_usage'] = ram_delta

        response = {
            "success": True,
            "audio_path": f"outputs/{output_filename}",
            "stats": stats
        }

        print(json.dumps(response, ensure_ascii=False))

    except Exception as e:
        import traceback
        response = {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print(json.dumps(response, ensure_ascii=False))

if __name__ == "__main__":
    main()
