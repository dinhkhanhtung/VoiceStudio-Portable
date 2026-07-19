from abc import ABC, abstractmethod
import time
import torch
import gc

class BaseTTSModel(ABC):
    def __init__(self, model_name: str, device: str = "cuda"):
        self.model_name = model_name
        self.device = device
        self.model = None
        
    @abstractmethod
    def load(self):
        """Load the model weights into memory/device."""
        pass
        
    def unload(self):
        """Unload the model from memory/device to free VRAM."""
        self.model = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            
    @abstractmethod
    def get_voices(self) -> list:
        """Return a list of available voice identifiers and descriptions.
        Each item is a dict: {'id': str, 'name': str, 'gender': str, 'region': str}
        """
        pass
        
    @abstractmethod
    def synthesize(self, text: str, voice: str, speed: float = 1.0) -> tuple:
        """Synthesize text to audio.
        Returns:
            (audio_data (numpy.ndarray), sample_rate (int), stats (dict))
        """
        pass
