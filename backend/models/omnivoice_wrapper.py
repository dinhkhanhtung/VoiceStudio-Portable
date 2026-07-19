import re
import sys
import time
import torch
import gc
import numpy as np
from models.base_model import BaseTTSModel

SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?…])\s+')

class OmniVoiceWrapper(BaseTTSModel):
    """Wrapper for k2-fsa/OmniVoice model.
    Supports multilingual zero-shot voice generation on GPU/CPU,
    either from a style description (`instruct`) or from a reference
    audio sample (`ref_audio`/`ref_text`) for voice cloning.
    """

    def __init__(self, device: str = "cuda"):
        super().__init__(
            model_name="Open-Source OmniVoice (k2-fsa/OmniVoice)",
            device=device
        )
        self.model_id = "k2-fsa/OmniVoice"

    def load(self):
        if self.model is None:
            from omnivoice import OmniVoice
            dtype = torch.float16 if self.device == "cuda" else torch.float32
            print(f"Loading OmniVoice model into memory (Device: {self.device}, Dtype: {dtype})...", file=sys.stderr)
            self.model = OmniVoice.from_pretrained(
                self.model_id,
                device_map=self.device,
                dtype=dtype
            )
            print("OmniVoice model loaded successfully!", file=sys.stderr)

    def get_voices(self) -> list:
        return []

    def synthesize(self, text: str, speed: float = 1.0, instruct: str = None,
                   ref_audio: str = None, ref_text: str = None, pause_ms: int = 0,
                   unload_after: bool = True, progress_callback=None) -> tuple:
        if not instruct and not ref_audio:
            raise ValueError("OmniVoice cần 'instruct' (giọng dựng sẵn) hoặc 'ref_audio' (voice clone).")

        start_vram = 0
        if torch.cuda.is_available() and self.device == "cuda":
            torch.cuda.empty_cache()
            gc.collect()
            start_vram = torch.cuda.memory_allocated(0)

        start_time = time.time()
        
        # Load model dynamically if not already loaded
        self.load()

        mid_vram = 0
        if torch.cuda.is_available() and self.device == "cuda":
            mid_vram = torch.cuda.memory_allocated(0)

        if instruct:
            print(f"Synthesizing with instruct prompt: '{instruct}'", file=sys.stderr)
        else:
            print(f"Synthesizing with voice clone from ref_audio: '{ref_audio}'", file=sys.stderr)

        sample_rate = 24000
        
        # Luôn luôn cắt thành từng câu nhỏ để tránh lỗi vọt VRAM và hallucination
        sentences = SENTENCE_SPLIT_RE.split(text.strip())
        sentences = [s.strip() for s in sentences if s.strip()] or [text]

        parts = []
        silence = np.zeros(int(sample_rate * pause_ms / 1000), dtype=np.float16 if self.device == "cuda" else np.float32)

        with torch.no_grad():
            for i, chunk_text in enumerate(sentences):
                # Process sequentially, one sentence at a time
                audio_data_list = self.model.generate(
                    text=chunk_text,
                    instruct=instruct,
                    ref_audio=ref_audio,
                    ref_text=ref_text,
                    speed=speed
                )
                chunk_audio = audio_data_list[0]
                parts.append(chunk_audio)
                
                # Add silence if not the last sentence and pause_ms > 0
                if pause_ms > 0 and i < len(sentences) - 1:
                    parts.append(silence)
                
                # Report progress
                if progress_callback:
                    progress_callback(i + 1, len(sentences))

        if len(parts) > 1:
            audio_data = np.concatenate(parts)
        elif len(parts) == 1:
            audio_data = parts[0]
        else:
            audio_data = np.zeros(0, dtype=np.float16 if self.device == "cuda" else np.float32)

        end_time = time.time()

        duration = len(audio_data) / float(sample_rate)
        inference_time = end_time - start_time
        rtf = inference_time / duration if duration > 0 else 0

        peak_vram = 0
        if torch.cuda.is_available() and self.device == "cuda":
            peak_vram = torch.cuda.max_memory_allocated(0)

        if unload_after:
            self.unload()

        vram_allocated_mb = (mid_vram - start_vram) / (1024 * 1024)
        vram_peak_mb = (peak_vram - start_vram) / (1024 * 1024)

        stats = {
            'inference_time': inference_time,
            'audio_duration': duration,
            'rtf': rtf,
            'vram_usage': max(0.0, vram_allocated_mb),
            'vram_peak': max(0.0, vram_peak_mb),
            'sample_rate': sample_rate,
            'device': self.device
        }

        return audio_data, sample_rate, stats
