export interface MediaItem {
  type: "photo" | "video"
  url: string
}

export interface PublishRequest {
  action: string
  caption?: string
  mediaUrl?: string
  mediaItems?: MediaItem[]
  title?: string
  description?: string
  tags?: string[]
  privacy?: string
}

export interface PublishResult {
  success: boolean
  platformPostId?: string
  platformPostUrl?: string
  error?: string
}

export interface PlatformPublisher {
  publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult>
}

// The per-platform publisher map moved to the provider registry
// (services/social/providers/registry.ts) — each descriptor carries its
// publisher. This file keeps only the publish wire types the platform
// implementations import.
