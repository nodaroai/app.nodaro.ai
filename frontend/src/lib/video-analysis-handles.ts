/**
 * Video Analysis `video` — what it analyzes: a video file from a video
 * producer, or a post's LINK from a text output (the Telegram Account
 * Trigger's Video link, a Text node). One predicate shared by the node's own
 * pip, the drag-to-connect validator (`connection-validation.ts`) and the
 * source-direction popover registry (`target-handle-registry.ts`), so the
 * three can never disagree. Both engines route a text source on this handle
 * into the link (`videoPageUrl`), a video producer into the file.
 */
import { ACCEPTS_POST_LINK } from "./content-handles"
import { ACCEPTS_VIDEO } from "./ffmpeg-handles"

export const ACCEPTS_VIDEO_OR_POST_LINK = (sourceType: string): boolean => ACCEPTS_VIDEO(sourceType) || ACCEPTS_POST_LINK(sourceType)
