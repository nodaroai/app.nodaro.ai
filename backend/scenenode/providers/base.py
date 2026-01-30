"""Base provider interface for AI services."""

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class ProviderResult:
    success: bool
    data: dict | None = None
    error: str = ""
    cost_usd: float = 0.0


class ImageProvider(ABC):
    @abstractmethod
    async def generate(self, prompt: str, options: dict) -> ProviderResult:
        ...


class VideoProvider(ABC):
    @abstractmethod
    async def generate(self, image_url: str, options: dict) -> ProviderResult:
        ...


class VoiceProvider(ABC):
    @abstractmethod
    async def generate(self, text: str, voice_id: str, options: dict) -> ProviderResult:
        ...


class ScriptProvider(ABC):
    @abstractmethod
    async def generate(self, prompt: str, options: dict) -> ProviderResult:
        ...
