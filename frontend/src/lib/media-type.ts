const VIDEO_EXT = /\.(mp4|webm|mov|avi)(\?|$)/i

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXT.test(url)
}

export function isMediaUrl(value: string): boolean {
  return /^https?:\/\//.test(value) || value.startsWith("blob:")
}
