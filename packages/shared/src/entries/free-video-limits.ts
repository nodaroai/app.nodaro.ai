/**
 * `@nodaro/shared/free-video-limits` — What an account that never paid may generate as video on free credits: the rule the server refuses with (402 `free_video_limit`), for a client to lock the same options.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export {
  FREE_BLOCKED_VIDEO_MODELS,
  FREE_BLOCKED_VIDEO_SERIES,
  FREE_OPEN_VIDEO_MODELS,
  FREE_VIDEO_LIMITS_DEFAULTS,
  freeVideoDurationLock,
  freeVideoEntry,
  freeVideoLock,
  freeVideoModelLock,
  freeVideoResolutionLock,
  lowestResolution,
  resolutionHeight,
} from "../free-video-limits.js"
export type { FreeVideoLimits, FreeVideoLock, FreeVideoModelLockOptions, FreeVideoRequest } from "../free-video-limits.js"
