export type SocialMediaPlatform = "instagram" | "tiktok" | "x" | "youtube" | "facebook" | "linkedin" | "telegram"

export type SocialMediaContentType =
  | "feed-square" | "feed-portrait" | "feed-landscape" | "story-reel"  // Instagram
  | "video"                                                             // TikTok
  | "image-landscape" | "image-square" | "x-video"                     // X
  | "short"                                                             // YouTube
  | "fb-feed-portrait" | "reel"                                        // Facebook
  | "li-image-landscape" | "li-image-square" | "li-video"              // LinkedIn

export interface SocialMediaSpec {
  readonly platform: SocialMediaPlatform
  readonly contentType: SocialMediaContentType
  readonly label: string
  readonly width: number
  readonly height: number
  readonly maxDurationSeconds: number | null  // null = image only (no duration limit)
  readonly textLimit: number
  readonly isVideo: boolean
}

export const PLATFORM_SPECS: Record<string, SocialMediaSpec> = {
  "instagram:feed-square": {
    platform: "instagram", contentType: "feed-square", label: "Feed Square",
    width: 1080, height: 1080, maxDurationSeconds: 60, textLimit: 2200, isVideo: true,
  },
  "instagram:feed-portrait": {
    platform: "instagram", contentType: "feed-portrait", label: "Feed Portrait",
    width: 1080, height: 1350, maxDurationSeconds: 60, textLimit: 2200, isVideo: true,
  },
  "instagram:feed-landscape": {
    platform: "instagram", contentType: "feed-landscape", label: "Feed Landscape",
    width: 1080, height: 566, maxDurationSeconds: 60, textLimit: 2200, isVideo: true,
  },
  "instagram:story-reel": {
    platform: "instagram", contentType: "story-reel", label: "Story / Reel",
    width: 1080, height: 1920, maxDurationSeconds: 180, textLimit: 2200, isVideo: true,
  },
  "tiktok:video": {
    platform: "tiktok", contentType: "video", label: "Video",
    width: 1080, height: 1920, maxDurationSeconds: 600, textLimit: 4000, isVideo: true,
  },
  "x:image-landscape": {
    platform: "x", contentType: "image-landscape", label: "Image Landscape",
    width: 1200, height: 675, maxDurationSeconds: null, textLimit: 280, isVideo: false,
  },
  "x:image-square": {
    platform: "x", contentType: "image-square", label: "Image Square",
    width: 1080, height: 1080, maxDurationSeconds: null, textLimit: 280, isVideo: false,
  },
  "x:x-video": {
    platform: "x", contentType: "x-video", label: "Video",
    width: 1920, height: 1080, maxDurationSeconds: 140, textLimit: 280, isVideo: true,
  },
  "youtube:short": {
    platform: "youtube", contentType: "short", label: "Short",
    width: 1080, height: 1920, maxDurationSeconds: 180, textLimit: 5000, isVideo: true,
  },
  "facebook:fb-feed-portrait": {
    platform: "facebook", contentType: "fb-feed-portrait", label: "Feed Portrait",
    width: 1080, height: 1350, maxDurationSeconds: null, textLimit: 63206, isVideo: false,
  },
  "facebook:reel": {
    platform: "facebook", contentType: "reel", label: "Reel",
    width: 1080, height: 1920, maxDurationSeconds: 90, textLimit: 63206, isVideo: true,
  },
  "linkedin:li-image-landscape": {
    platform: "linkedin", contentType: "li-image-landscape", label: "Image Landscape",
    width: 1200, height: 627, maxDurationSeconds: null, textLimit: 3000, isVideo: false,
  },
  "linkedin:li-image-square": {
    platform: "linkedin", contentType: "li-image-square", label: "Image Square",
    width: 1080, height: 1080, maxDurationSeconds: null, textLimit: 3000, isVideo: false,
  },
  "linkedin:li-video": {
    platform: "linkedin", contentType: "li-video", label: "Video",
    width: 1920, height: 1080, maxDurationSeconds: 600, textLimit: 3000, isVideo: true,
  },
}

export const CONTENT_TYPES_BY_PLATFORM: Record<SocialMediaPlatform, ReadonlyArray<{ key: string; label: string }>> = {
  instagram: [
    { key: "instagram:feed-square", label: "Feed Square (1080×1080)" },
    { key: "instagram:feed-portrait", label: "Feed Portrait (1080×1350)" },
    { key: "instagram:feed-landscape", label: "Feed Landscape (1080×566)" },
    { key: "instagram:story-reel", label: "Story / Reel (1080×1920)" },
  ],
  tiktok: [
    { key: "tiktok:video", label: "Video (1080×1920)" },
  ],
  x: [
    { key: "x:image-landscape", label: "Image Landscape (1200×675)" },
    { key: "x:image-square", label: "Image Square (1080×1080)" },
    { key: "x:x-video", label: "Video (1920×1080)" },
  ],
  youtube: [
    { key: "youtube:short", label: "Short (1080×1920)" },
  ],
  facebook: [
    { key: "facebook:fb-feed-portrait", label: "Feed Portrait (1080×1350)" },
    { key: "facebook:reel", label: "Reel (1080×1920)" },
  ],
  linkedin: [
    { key: "linkedin:li-image-landscape", label: "Image Landscape (1200×627)" },
    { key: "linkedin:li-image-square", label: "Image Square (1080×1080)" },
    { key: "linkedin:li-video", label: "Video (1920×1080)" },
  ],
  telegram: [
    { key: "telegram:message", label: "Message (text)" },
  ],
}

export const PLATFORM_LABELS: Record<SocialMediaPlatform, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  x: "X (Twitter)",
  youtube: "YouTube",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  telegram: "Telegram",
}
