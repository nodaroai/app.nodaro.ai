const VIDEO_EXT = /\.(mp4|webm|mov|avi)(\?|$)/i
const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|svg|avif)(\?|$)/i
const AUDIO_EXT = /\.(mp3|wav|ogg|aac|flac|m4a)(\?|$)/i

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT.test(url)
}

export function isImageUrl(url: string): boolean {
  return IMAGE_EXT.test(url)
}

export function isAudioUrl(url: string): boolean {
  return AUDIO_EXT.test(url)
}

export function isMediaUrl(value: string): boolean {
  return /^https?:\/\//.test(value) || value.startsWith("blob:")
}
