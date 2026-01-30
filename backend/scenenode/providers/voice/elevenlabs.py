"""ElevenLabs voice generation provider."""

from scenenode.providers.base import VoiceProvider, ProviderResult


class ElevenLabsProvider(VoiceProvider):
    async def generate(self, text: str, voice_id: str, options: dict) -> ProviderResult:
        # TODO: Implement ElevenLabs TTS
        raise NotImplementedError
