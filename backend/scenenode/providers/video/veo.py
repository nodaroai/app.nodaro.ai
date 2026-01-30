"""VEO video generation provider."""

from scenenode.providers.base import VideoProvider, ProviderResult


class VeoProvider(VideoProvider):
    async def generate(self, image_url: str, options: dict) -> ProviderResult:
        # TODO: Implement VEO video generation
        raise NotImplementedError
