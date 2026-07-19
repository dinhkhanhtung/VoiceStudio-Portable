import re
import sys
import time
import gc
import numpy as np
from models.base_model import BaseTTSModel

SENTENCE_SPLIT_RE = re.compile(r'(?<=[.!?…])\s+')

class VieneuWrapper(BaseTTSModel):
    """Wrapper for VieNeu-TTS v3 Turbo (pnnbao97), CPU-only zero-shot voice cloning."""

    def __init__(self, device: str = "cpu"):
        super().__init__(
            model_name="VieNeu-TTS v3 Turbo (pnnbao97)",
            device=device
        )

    def load(self):
        if self.model is None:
            print(f"Loading VieNeu-TTS model into memory (Device: {self.device})...", file=sys.stderr)
            from vieneu import Vieneu
            self.model = Vieneu(mode="v3turbo", device=self.device)
            print("VieNeu-TTS model loaded successfully!", file=sys.stderr)

    def unload(self):
        self.model = None
        gc.collect()

    def get_voices(self) -> list:
        return []

    def synthesize(self, text: str, speed: float = 1.0, ref_audio: str = None, ref_text: str = None,
                   pause_ms: int = 0, unload_after: bool = False, progress_callback=None) -> tuple:
        # speed: accepted for interface symmetry with OmniVoiceWrapper, but VieNeu v3turbo
        # has no speed control parameter in its infer() API — ignored.
        if not ref_audio:
            raise ValueError("VieNeu-TTS cần 'ref_audio' để clone giọng.")

        start_time = time.time()

        self.load()

        sample_rate = self.model.sample_rate

        sentences = SENTENCE_SPLIT_RE.split(text.strip())
        sentences = [s.strip() for s in sentences if s.strip()] or [text]

        parts = []
        silence = np.zeros(int(sample_rate * pause_ms / 1000), dtype=np.float32)

        for i, chunk_text in enumerate(sentences):
            chunk_audio = self.model.infer(chunk_text, ref_audio=ref_audio)
            parts.append(chunk_audio)

            if pause_ms > 0 and i < len(sentences) - 1:
                parts.append(silence)

            if progress_callback:
                progress_callback(i + 1, len(sentences))

        if len(parts) > 1:
            audio_data = np.concatenate(parts)
        elif len(parts) == 1:
            audio_data = parts[0]
        else:
            audio_data = np.zeros(0, dtype=np.float32)

        end_time = time.time()

        duration = len(audio_data) / float(sample_rate)
        inference_time = end_time - start_time
        rtf = inference_time / duration if duration > 0 else 0

        if unload_after:
            self.unload()

        stats = {
            'inference_time': inference_time,
            'audio_duration': duration,
            'rtf': rtf,
            'sample_rate': sample_rate,
            'device': self.device,
            'engine': 'vieneu'
        }

        return audio_data, sample_rate, stats
