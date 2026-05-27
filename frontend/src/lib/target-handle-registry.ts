import { GENERATE_IMAGE_INPUT_HANDLES, IDENTITY_TYPES, isValidGenerateImageConnection } from "./generate-image-handles"
import {
  isValidListNodeConnection,
  isValidWebScrapeConnection,
  isValidExtractFieldConnection,
  isValidFilterListConnection,
  isValidDeduplicateConnection,
  isValidMergeListsConnection,
  isValidSortListConnection,
  isValidLoopCoarse,
} from "./data-handles"
import { VISUAL_PARAMETER_PICKER_NODE_TYPES, isVisualPickerType } from "./parameter-picker-types"

export interface TargetHandleEntry {
  readonly handleId: string
  /** Human-readable label for the candidate-row chip in source-direction
   *  popovers (e.g. "Start state", "Look"). Falls back to raw handleId in
   *  the UI when omitted. Kept optional so additions don't churn every
   *  entry — only the user-facing handles in the popover need a label. */
  readonly label?: string
  readonly accepts: (sourceType: string) => boolean
}

/**
 * Sources whose output contributes a USABLE prompt-hint clause to
 * camera-motion / transition targets. This is a VISUAL subset of the
 * dispatch cases in `packages/shared/src/parameter-prompt-hint.ts` — audio
 * pickers (music-genre / music-mood / instrumentation / voice-*) DO have
 * cases in that switch, but their fragments are musical and nonsensical
 * on a video-motion wire, so they're excluded here.
 *
 * Size + content pinned by the drift-catcher test in
 * `target-handle-registry.test.ts` — adding a new visual picker means
 * updating that count, which forces a deliberate change rather than a
 * silent drift.
 *
 * MODULE-INIT GUARD: VISUAL_PARAMETER_PICKER_NODE_TYPES MUST be a non-empty
 * Set when this module loads. If it isn't, the spread silently produces
 * a Set containing only the two literals ("tone", "text-prompt"), which
 * passes a naive size check but represents a real misconfiguration
 * (parameter-picker-types export was renamed / cleared) that would
 * cascade into broken camera-motion / transition wiring.
 *
 * The previous size===0 guard was unreachable because the unconditional
 * literals made size >= 2 always — replaced here with an INPUT-side
 * check on the spread source.
 *
 * Recovery strategy: console.error + degraded fallback instead of
 * throwing at module init. A throw here takes down the entire editor
 * (the module is statically imported by the canvas + popover), and a
 * future circular-import or HMR race condition that briefly makes
 * VISUAL_PARAMETER_PICKER_NODE_TYPES undefined would be impossible to
 * diagnose. Better: log loudly and continue with an empty visual-picker
 * spread — typed-handle validation will be incomplete (camera-motion /
 * transition state handles won't accept visual pickers, only tone +
 * text-prompt) but the editor still loads.
 */
let _visualPickerSet: ReadonlySet<string> = VISUAL_PARAMETER_PICKER_NODE_TYPES
if (
  !(VISUAL_PARAMETER_PICKER_NODE_TYPES instanceof Set) ||
  VISUAL_PARAMETER_PICKER_NODE_TYPES.size === 0
) {
  console.error(
    "[target-handle-registry] VISUAL_PARAMETER_PICKER_NODE_TYPES is missing or empty — " +
    "typed-handle validation will be incomplete (visual pickers won't accept on camera-motion / transition state handles). " +
    "Check parameter-picker-types.ts for export issues or a circular import.",
  )
  _visualPickerSet = new Set<string>()
}
const HINT_PRODUCER_TYPES: ReadonlySet<string> = new Set<string>([
  ..._visualPickerSet,
  "tone",
  "text-prompt",
])

/**
 * Camera-motion / transition startState+endState handles accept any source
 * whose output contributes a usable visual prompt-hint fragment. Drift is
 * caught by `target-handle-registry.test.ts` (pinned size + contained
 * tokens + audio exclusion).
 */
export const ACCEPTS_PARAMETER_PICKER = (sourceType: string): boolean => HINT_PRODUCER_TYPES.has(sourceType)

/**
 * Character-fx's `target` handle accepts identity-locking ref nodes only —
 * character / face / object / location. See
 * packages/shared/src/parameter-prompt-hint.ts:178-202: the character-fx
 * branch walks incoming edges on `targetHandle === "target"` and calls
 * `extractCharacterRefName(src)`, which extracts the `characterName` /
 * `faceName` / `objectName` / `locationName` field from one of those four
 * ref types. Pickers / image producers contribute nothing here.
 */
export const ACCEPTS_CHARACTER_REF = (sourceType: string): boolean => IDENTITY_TYPES.has(sourceType)

/** Friendly labels for Generate Image's six input handles, used by the
 *  candidate-row chip in source-direction popovers. */
const GENERATE_IMAGE_HANDLE_LABELS: Record<string, string> = {
  prompt: "Prompt",
  negative: "Negative",
  references: "References",
  assets: "Assets",
  elements: "Elements",
  look: "Look",
}

/**
 * Per-node-type list of target handles + their accept predicates.
 * Source-direction popovers walk this map to find candidate consumers.
 *
 * As more nodes adopt typed handles (Edit Image, I2V, etc. — separate
 * playbook migration), they each register here too.
 */
export const TARGET_HANDLE_ACCEPTS: Record<string, ReadonlyArray<TargetHandleEntry>> = {
  // Generate Image uses the VISUAL-picker predicate (audio pickers like
  // music-genre / voice-* never feed a still-image target). This matches
  // connection-validation.ts:71 so the pip's "valid candidate" highlight
  // and the actual drop validator agree — without this alignment, audio
  // pickers light up Generate Image's pip during a drag but the drop fails.
  "generate-image": GENERATE_IMAGE_INPUT_HANDLES.map((handleId) => ({
    handleId,
    label: GENERATE_IMAGE_HANDLE_LABELS[handleId] ?? handleId,
    accepts: (sourceType: string) =>
      isValidGenerateImageConnection(handleId, sourceType, isVisualPickerType),
  })),
  "camera-motion": [
    { handleId: "startState", label: "Start state", accepts: ACCEPTS_PARAMETER_PICKER },
    { handleId: "endState",   label: "End state",   accepts: ACCEPTS_PARAMETER_PICKER },
  ],
  // Transition mirrors camera-motion: its startState/endState wires carry
  // prompt hints from parameter pickers, not image frames. See
  // packages/shared/src/parameter-prompt-hint.ts:150-176 (transition branch
  // walks incoming edges and calls getParameterPromptHint on each source).
  "transition": [
    { handleId: "startState", label: "Start state", accepts: ACCEPTS_PARAMETER_PICKER },
    { handleId: "endState",   label: "End state",   accepts: ACCEPTS_PARAMETER_PICKER },
  ],
  // Character-fx accepts ONLY identity refs on its `target` handle. The
  // shared hint-builder reads `characterName`/`faceName`/`objectName`/
  // `locationName` from the source — pickers and image producers contribute
  // nothing.
  "character-fx": [
    { handleId: "target", label: "Target subject", accepts: ACCEPTS_CHARACTER_REF },
  ],

  // ─── Data root-category nodes ─────────────────────────────────────────
  // Source-direction popovers walk this map; entries here let "drag from an
  // output pip" enumerate data-node target handles as candidates. The
  // loop-node case is omitted intentionally — its per-column accepts depend
  // on the column type stored in node data, which this registry's static
  // shape can't reach. The loop component's own per-pip accepts predicate
  // handles target-direction visual filtering.
  "list": [
    { handleId: "in", label: "Items", accepts: (s) => isValidListNodeConnection("in", s, isVisualPickerType) },
  ],
  "web-scrape": [
    { handleId: "in", label: "URL / Query", accepts: (s) => isValidWebScrapeConnection("in", s) },
  ],
  "extract-field": [
    { handleId: "in", label: "Source", accepts: (s) => isValidExtractFieldConnection("in", s) },
  ],
  "filter-list": [
    { handleId: "in", label: "List", accepts: (s) => isValidFilterListConnection("in", s, isVisualPickerType) },
    { handleId: "variables", label: "Variables", accepts: (s) => isValidFilterListConnection("variables", s, isVisualPickerType) },
  ],
  "deduplicate": [
    { handleId: "in", label: "List", accepts: (s) => isValidDeduplicateConnection("in", s) },
  ],
  "merge-lists": [
    { handleId: "in", label: "Lists", accepts: (s) => isValidMergeListsConnection("in", s) },
  ],
  "sort-list": [
    { handleId: "in", label: "List", accepts: (s) => isValidSortListConnection("in", s) },
  ],
  // Loop's per-column input handles have dynamic ids (`col_<uuid>_in`) so
  // they can't be enumerated statically. Expose the col_add quick-add
  // handle instead — source-direction popovers will offer loop as a
  // candidate, and the col_add handler in use-workflow-store auto-detects
  // the column type from the source. This is the only way to surface loop
  // in TARGET_HANDLE_ACCEPTS without threading node data through.
  "loop": [
    { handleId: "col_add", label: "New column", accepts: (s) => isValidLoopCoarse(s, isVisualPickerType) },
  ],
}

export interface TargetCandidateMatch {
  readonly nodeType: string
  readonly handleId: string
}

/**
 * Reverse lookup: given a source node type, return every (nodeType, handleId)
 * pair whose accepts predicate returns true for it. Used by source-direction
 * popovers in HandlePopover for candidate enumeration.
 */
export function getTargetHandlesAccepting(sourceType: string): ReadonlyArray<TargetCandidateMatch> {
  const out: TargetCandidateMatch[] = []
  for (const [nodeType, entries] of Object.entries(TARGET_HANDLE_ACCEPTS)) {
    for (const entry of entries) {
      if (entry.accepts(sourceType)) out.push({ nodeType, handleId: entry.handleId })
    }
  }
  return out
}
