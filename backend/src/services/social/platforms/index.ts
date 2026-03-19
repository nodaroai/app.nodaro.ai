import type { SocialPlatform } from "../oauth.js"
import { instagramPublisher } from "./instagram.js"
import { tiktokPublisher } from "./tiktok.js"
import { youtubePublisher } from "./youtube.js"
import { linkedinPublisher } from "./linkedin.js"
import { xPublisher } from "./x.js"
import { facebookPublisher } from "./facebook.js"
import { telegramPublisher } from "./telegram.js"

export interface PublishRequest {
  action: string
  caption?: string
  mediaUrl?: string
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

export const platformPublishers: Record<SocialPlatform, PlatformPublisher> = {
  instagram: instagramPublisher,
  tiktok: tiktokPublisher,
  youtube: youtubePublisher,
  linkedin: linkedinPublisher,
  x: xPublisher,
  facebook: facebookPublisher,
  telegram: telegramPublisher,
}
