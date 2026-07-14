/**
 * The ONE yt-dlp format selector, shared by every path that downloads a social
 * video (`youtube-video.ts` spawns yt-dlp directly; `trim-audio.ts` drives it
 * through `youtube-dl-exec`). Kept in its own module deliberately: it is a bare
 * constant plus a pure string-builder, and importing it must not drag in a
 * provider's module-level binary resolution.
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
/**
 * The ordered fallback branches, video-half first. `videoFormatSelector` and the
 * `VIDEO_FORMAT_SELECTOR` constant are both derived from this one list so a
 * capped and an uncapped selector can never drift apart.
 */
const BASE_BRANCHES = [
  "bv*[vcodec^=avc1]+ba[ext=m4a]", // h264 video + aac audio, muxed — cleanest mp4
  "bv*[vcodec^=avc1]+ba",          // h264 video + whatever audio exists
  "bv*+ba",                        // any video + any audio (re-encode fixes the codec)
  "b[vcodec^=avc1]",               // single combined h264 file (YouTube-style vcodec)
  "b[vcodec^=h264]",               // single combined h264 file (TikTok-style vcodec)
  "b[ext=mp4]",                    // any combined mp4
  "b",                             // last resort: anything playable
] as const

/**
 * The yt-dlp `--format` selector, optionally capped to a maximum video height.
 *
 * With NO `maxHeight` this returns exactly `VIDEO_FORMAT_SELECTOR` — the
 * backward-compatible "best" behaviour every existing caller relies on.
 *
 * With a `maxHeight` H, `[height<=H]` is injected into the VIDEO-selecting half
 * of every branch (never the `+ba` audio half — audio has no height), and a
 * final BARE `b` is appended as an extra last resort:
 *
 *   bv*[vcodec^=avc1][height<=H]+ba[ext=m4a] / … / b[height<=H] / b
 *
 * That trailing `b` is deliberate: if EVERY available format exceeds the cap
 * (e.g. a video published only in >H resolutions), yt-dlp picks the best format
 * that satisfies the cap; the bare `b` fires ONLY when nothing does, so the
 * import still succeeds with the smallest available rendition rather than
 * failing. Better a too-large video than a failed import.
 *
 * `maxHeight` is assumed already range-validated by the caller (the
 * download-video route clamps to [144, 4320]); this is a pure string builder.
 */
export function videoFormatSelector(maxHeight?: number): string {
  if (maxHeight === undefined) return BASE_BRANCHES.join("/")
  const capped = BASE_BRANCHES.map((branch) => {
    // Cap only the video stream — the part before the first `+` (or the whole
    // branch for the single-file `b[...]` fallbacks, which have no `+`).
    const plus = branch.indexOf("+")
    return plus === -1
      ? `${branch}[height<=${maxHeight}]`
      : `${branch.slice(0, plus)}[height<=${maxHeight}]${branch.slice(plus)}`
  })
  return [...capped, "b"].join("/")
}

/**
 * The uncapped selector, kept as a named export for the callers (and tests)
 * that reference it directly. Delegates to `videoFormatSelector()` so the two
 * are the same string by construction.
 */
export const VIDEO_FORMAT_SELECTOR = videoFormatSelector()
