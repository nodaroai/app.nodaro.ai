/**
 * `virtual:media-editor` on every build without the shared header (community,
 * business, public CI, a cloud build with the flag off) and in tests: no
 * editor. Every part the real module exports is here as `null` (a named
 * import of a missing export would fail the production build), so a caller
 * checks `mediaEditorAvailable` and the part, and keeps its own screen.
 */

export const mediaEditorAvailable = false

export const TrimPanel = null
export const CropPanel = null
export const RatioPicker = null
export const htmlMediaAdapter = null
export const defaultRange = null
export const clampRange = null
export const formatTime = null
export const fullRect = null
export const isWholeFrame = null
