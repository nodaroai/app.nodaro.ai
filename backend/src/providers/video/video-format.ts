/**
 * The ONE yt-dlp format selector, shared by every path that downloads a social
 * video (`youtube-video.ts` spawns yt-dlp directly; `trim-audio.ts` drives it
 * through `youtube-dl-exec`). Kept in its own module deliberately: it is a bare
 * constant, and importing it must not drag in a provider's module-level
 * binary resolution.
 *
 * Prefers h264 WITH audio, in priority order.
 *
 * The previous selectors (`mp4/best`, and `.../best[ext=mp4]/best`) picked the
 * highest-bitrate mp4 — and on TikTok that is a `bytevc1_*` (h265) format which
 * ADVERTISES `acodec=aac` in its metadata but downloads VIDEO-ONLY. The result
 * was a silent mp4: the download reported success, and the failure only surfaced
 * steps later as a bare "ffmpeg failed" inside an audio stage that had been
 * handed a file with no audio track. TikTok's `h264_*` formats carry real audio.
 *
 * Both `avc1` and `h264` prefixes are required: YouTube reports vcodec as
 * `avc1.42001E`, TikTok reports it as literally `h264`.
 *
 * Preferring h264 also means the download path usually skips its h265→h264
 * re-encode entirely — what arrives is already in the target codec.
 */
export const VIDEO_FORMAT_SELECTOR = [
  "bv*[vcodec^=avc1]+ba[ext=m4a]", // h264 video + aac audio, muxed — cleanest mp4
  "bv*[vcodec^=avc1]+ba",          // h264 video + whatever audio exists
  "bv*+ba",                        // any video + any audio (re-encode fixes the codec)
  "b[vcodec^=avc1]",               // single combined h264 file (YouTube-style vcodec)
  "b[vcodec^=h264]",               // single combined h264 file (TikTok-style vcodec)
  "b[ext=mp4]",                    // any combined mp4
  "b",                             // last resort: anything playable
].join("/")
