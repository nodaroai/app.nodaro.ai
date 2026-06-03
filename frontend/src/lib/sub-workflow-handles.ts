/**
 * Shared handle colors for the three sub-workflow node types
 * (sub-workflow, sub-workflow-input, sub-workflow-output).
 *
 * A sub-workflow port carries a `mediaType` (text / image / video / audio /
 * any). PORT_COLOR maps that mediaType to the canonical pip color from
 * HANDLE_COLORS (single source of truth) so a port's pip matches the
 * same-typed handle everywhere else. `any` (untyped passthrough) uses the
 * neutral control color — same as the unmatched-mediaType fallback at the
 * call sites.
 */
import { HANDLE_COLORS } from "./handle-colors"

export const PORT_COLOR: Record<string, string> = {
  text: HANDLE_COLORS.text,
  image: HANDLE_COLORS.image,
  video: HANDLE_COLORS.video,
  audio: HANDLE_COLORS.audio,
  any: HANDLE_COLORS.control,
}
