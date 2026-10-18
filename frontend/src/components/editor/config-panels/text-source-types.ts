/**
 * The node types whose output is prose/text — the compatible sources of every
 * text-shaped field in FIELD_COMPATIBLE_TYPES (config-panels/helpers.ts, which
 * re-exports it). Kept apart from helpers.ts so the hand-written list and its
 * composition with the node units stay one small module.
 */
import { UNIT_NODE_DEFINITIONS } from "@/lib/unit-definitions"
import { unitTextSources } from "@/lib/unit-compose"
// @registry-enumerates TEXT_SOURCE_TYPES carries every node unit whose first output is text
/** The legacy node types (not parameter pickers) whose output is prose/text. */
const LEGACY_TEXT_SOURCE_TYPES: ReadonlyArray<string> = [
  "text-prompt",
  "llm-chat",
  "combine-text",
  "split-text",
  "extract-field",
  "transcribe",
  "image-to-text",
  "suno-lyrics",
  "suno-style-boost",
  "forced-alignment",
  "qa-check",
  "filter-list",
  "deduplicate",
  "merge-lists",
  "sort-list",
  "json-process",
  "preview",
  "webhook-trigger",
  "schedule-trigger",
  "list",
]

/** Every node type whose output is prose/text. Used to build the compatible
 *  source list for any text-shaped field so the MappableField dropdown is
 *  visible whenever *any* text source is wired — not just a literal Text
 *  Prompt. Includes parameter nodes because their extracted output is the
 *  rich prompt hint (see `getParameterPromptHint`). The legacy list, then
 *  every node unit whose first output is text, then the parameter nodes;
 *  only membership is read. */
export const TEXT_SOURCE_TYPES: ReadonlyArray<string> = [
  ...LEGACY_TEXT_SOURCE_TYPES,
  ...unitTextSources(UNIT_NODE_DEFINITIONS),
  // Parameter nodes — their extractNodeOutput returns the prompt hint.
  "tone",
  "style-guide",
  "motion",
  "camera-motion",
  "framing",
  "lens",
  "camera-format",
  "lighting",
  "color-look",
  "atmosphere",
  "action-fx",
  "style",
  "setting",
  "person",
  "mood",
  "photographer",
  "aesthetic",
  "era",
  "pose",
  "styling",
  "photo-genre",
  "backdrop",
  "held-prop",
  "temporal",
  "exposure-settings",
  "render-quality",
  "composition-effects",
  "post-process-effects",
  "transition",
  "character-fx",
  "character-motion",
]
