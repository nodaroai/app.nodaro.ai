"""Nano Banana (Gemini) image generation provider."""

from scenenode.providers.base import ImageProvider, ProviderResult


class NanoBananaProvider(ImageProvider):
    async def generate(self, prompt: str, options: dict) -> ProviderResult:
        # TODO: Implement Gemini image generation
        raise NotImplementedError
