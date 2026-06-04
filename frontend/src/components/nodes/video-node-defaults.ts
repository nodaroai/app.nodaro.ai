/**
 * Shared sizing defaults for every video-producing node on the canvas.
 *
 * Before this existed, each video node hand-picked its own `minWidth` (200 /
 * 220 / 240) and its own idle aspect (only Generate Video defaulted to 16:9;
 * the rest started as small generic boxes and only "popped" into a video shape
 * after producing a result). That drift is what made the video family look
 * ragged on the canvas.
 *
 * The convention, matching Generate Video:
 *   - idle / no result yet  → a 16:9 box at `VIDEO_NODE_MIN_WIDTH`
 *   - once a result exists   → snap to the result's *true* aspect ratio
 *     (driven by `useResultAspectRatio`, fed the raw videoWidth/videoHeight)
 *
 * Every video node passes:
 *   minWidth={VIDEO_NODE_MIN_WIDTH}
 *   imageAspectRatio={mediaAspectRatio ?? VIDEO_NODE_DEFAULT_ASPECT}
 * so a new video node inherits correct, consistent behavior by default instead
 * of needing a remembered magic number.
 */

/** Idle/auto-sized width floor for video nodes (px). */
export const VIDEO_NODE_MIN_WIDTH = 240

/** Aspect ratio for the idle placeholder before a result exists (16:9). */
export const VIDEO_NODE_DEFAULT_ASPECT = 16 / 9
