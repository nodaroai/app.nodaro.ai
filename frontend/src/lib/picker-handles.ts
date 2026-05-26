export type PickerFamily = "look" | "elements" | "asset" | "text" | "audio" | "motion"

export const PICKER_FAMILY_COLORS: Record<PickerFamily, string> = {
  look: "#818CF8",      // indigo — matches Generate Image `look` handle
  elements: "#818CF8",  // indigo — matches Generate Image `elements` handle
  // asset/text reserved for future picker entity types (character, location, etc.)
  asset: "#F472B6",     // pink — matches Generate Image `assets` handle
  text: "#22D3EE",      // cyan — matches Generate Image `prompt` handle
  audio: "#F59E0B",     // amber — Generate Music inputs
  motion: "#A78BFA",    // violet — camera-motion + transition (video motion handles)
}

/**
 * Output-pip metadata for a parameter picker node TYPE.
 *
 * The pip's visible glyph is OWNED BY THE NODE COMPONENT — it passes its
 * own `icon` prop to ParameterNodeShell → HandleWithPopover. Two icon
 * sources for the same pip (a `family` icon here AND the node's own icon
 * in `EditableNodeLabel`) caused visual drift between the node label and
 * the source pip (e.g. animal-node showed PawPrint while the pip showed
 * Bot). Keeping `family` + `color` + `label` keeps the registry useful
 * for popover candidate enumeration and color routing without forcing a
 * second icon source.
 */
export interface PickerOutputMeta {
  readonly family: PickerFamily
  readonly color: string
  readonly label: string
}

const REGISTRY: Record<string, PickerOutputMeta> = {
  // ─── Look family ────────────────────────────────────────────────────
  // NOTE: "look" itself is a family name, NOT a picker node type. The
  // family groups lens/lighting/mood/etc. which all feed Generate Image's
  // `look` handle. There is no node with type-string "look".
  "lens":                  { family: "look", color: "#818CF8", label: "Lens" },
  "lighting":              { family: "look", color: "#818CF8", label: "Lighting" },
  "mood":                  { family: "look", color: "#818CF8", label: "Mood" },
  "atmosphere":            { family: "look", color: "#818CF8", label: "Atmosphere" },
  "styling":               { family: "look", color: "#818CF8", label: "Styling" },
  "pose":                  { family: "look", color: "#818CF8", label: "Pose" },
  "framing":               { family: "look", color: "#818CF8", label: "Framing" },
  "aesthetic":             { family: "look", color: "#818CF8", label: "Aesthetic" },
  "era":                   { family: "look", color: "#818CF8", label: "Era" },
  "photo-genre":           { family: "look", color: "#818CF8", label: "Photo genre" },
  "backdrop":              { family: "look", color: "#818CF8", label: "Backdrop" },
  "color-look":            { family: "look", color: "#818CF8", label: "Color look" },
  "photographer":          { family: "look", color: "#818CF8", label: "Photographer" },
  "render-quality":        { family: "look", color: "#818CF8", label: "Render quality" },
  "composition-effects":   { family: "look", color: "#818CF8", label: "Composition FX" },
  "post-process-effects":  { family: "look", color: "#818CF8", label: "Post-process FX" },
  "exposure-settings":     { family: "look", color: "#818CF8", label: "Exposure" },
  "temporal":              { family: "look", color: "#818CF8", label: "Temporal" },
  "style":                 { family: "look", color: "#818CF8", label: "Style" },
  "camera-format":         { family: "look", color: "#818CF8", label: "Camera format" },

  // ─── Elements family ────────────────────────────────────────────────
  "setting":               { family: "elements", color: "#818CF8", label: "Setting" },
  "action-fx":             { family: "elements", color: "#818CF8", label: "Action FX" },
  "loop-subject":          { family: "elements", color: "#818CF8", label: "Loop subject" },
  "person":                { family: "elements", color: "#818CF8", label: "Person" },
  "animal":                { family: "elements", color: "#818CF8", label: "Animal" },
  "vehicle":               { family: "elements", color: "#818CF8", label: "Vehicle" },
  "weapon":                { family: "elements", color: "#818CF8", label: "Weapon" },
  "furniture":             { family: "elements", color: "#818CF8", label: "Furniture" },
  "held-prop":             { family: "elements", color: "#818CF8", label: "Held prop" },
  "material":              { family: "elements", color: "#818CF8", label: "Material" },
  "character-fx":          { family: "elements", color: "#818CF8", label: "Character FX" },

  // ─── Motion family ──────────────────────────────────────────────────
  "camera-motion":         { family: "motion", color: "#A78BFA", label: "Camera motion" },
  "transition":            { family: "motion", color: "#A78BFA", label: "Transition" },

  // ─── Audio family ───────────────────────────────────────────────────
  "music-genre":           { family: "audio", color: "#F59E0B", label: "Music genre" },
  "music-mood":            { family: "audio", color: "#F59E0B", label: "Music mood" },
  "instrumentation":       { family: "audio", color: "#F59E0B", label: "Instrumentation" },
  "voice-character":       { family: "audio", color: "#F59E0B", label: "Voice character" },
  "voice-delivery":        { family: "audio", color: "#F59E0B", label: "Voice delivery" },

  // ─── Text family ────────────────────────────────────────────────────
  // Non-tile-grid hint-producers — accepted by HINT_PRODUCER_TYPES so they
  // can feed camera-motion / transition state handles. The drift-catcher
  // test (`picker-handles.test.ts`) allowlists these because they aren't
  // tile-grid pickers (no entry in `parameter-picker-registry.tsx`).
  "tone":                  { family: "text", color: "#22D3EE", label: "Tone" },
  "text-prompt":           { family: "text", color: "#22D3EE", label: "Text prompt" },
}

export function getPickerOutputMeta(nodeType: string): PickerOutputMeta | null {
  return REGISTRY[nodeType] ?? null
}

export function isPickerNodeType(nodeType: string): boolean {
  return nodeType in REGISTRY
}

/**
 * Non-tile-grid hint producers that LIVE in REGISTRY (for typed source-pip
 * coloring + popover dispatch) but DON'T have a tile-grid value glyph the
 * way pickers do. `tone` shows a text/palette label; `text-prompt` shows
 * its prompt content. Their nodes ARE registered as pickers for HANDLE
 * purposes, but they should NOT be treated as tile-grid pickers for the
 * popover's "show generic Workflow icon instead of the candidate's
 * picker-value glyph" visual heuristic.
 *
 * Kept here next to REGISTRY so a drift-catcher test can pin the
 * relationship: every type in this set MUST be in REGISTRY (otherwise
 * `isTileGridPickerType` returns false because `isPickerNodeType` would
 * already return false).
 */
const NON_TILE_GRID_PICKER_TYPES: ReadonlySet<string> = new Set(["tone", "text-prompt"])

/**
 * True when the node type is a TILE-GRID picker (registered AND has a
 * value glyph rendered from a tile grid). Used by handle-popover to
 * decide whether to show the candidate's value-glyph or a generic
 * Workflow icon — text-prompt and tone have their own content-driven
 * visuals, not tile-grid value glyphs.
 */
export function isTileGridPickerType(nodeType: string): boolean {
  return isPickerNodeType(nodeType) && !NON_TILE_GRID_PICKER_TYPES.has(nodeType)
}

/**
 * REGISTRY keys for drift-catcher tests. Exposed as a function (not the
 * raw object) so REGISTRY stays an implementation detail — callers can
 * only enumerate types, not mutate the registry shape. Used by
 * `picker-handles.test.ts` to assert REGISTRY ⊆ PARAMETER_PICKER_NODE_TYPES
 * (the reverse of the existing PARAMETER_PICKER_NODE_TYPES ⊆ REGISTRY
 * check).
 */
export function getRegisteredPickerTypes(): ReadonlyArray<string> {
  return Object.keys(REGISTRY)
}

/**
 * Default SOURCE-handle id per picker node type. Most parameter pickers
 * use `"out"` but a few use type-specific ids that match their data field
 * (text-prompt's pip is `"prompt"`, tone's is `"tone"`, provider's is
 * `"provider"`, etc.). Legacy workflows saved before typed source pips
 * landed have `e.sourceHandle = null/undefined` on edges originating from
 * these nodes — the load-time migration in `use-workflow-store.ts` uses
 * this table to backfill the right handle id so downstream lookups
 * (`useHandleConnections`, popover dedup, edge-rendering) work uniformly.
 */
const PICKER_DEFAULT_SOURCE_HANDLE: Record<string, string> = {
  // text + tone use type-specific ids matching their data shape.
  "text-prompt": "prompt",
  "tone": "tone",
  // All other registered pickers use the generic "out" id.
  // Listed explicitly for the same reason the registry keys are: a
  // missing entry should be a deliberate omission, not a silent default.
  "lens": "out",
  "lighting": "out",
  "mood": "out",
  "atmosphere": "out",
  "styling": "out",
  "pose": "out",
  "framing": "out",
  "aesthetic": "out",
  "era": "out",
  "photo-genre": "out",
  "backdrop": "out",
  "color-look": "out",
  "photographer": "out",
  "render-quality": "out",
  "composition-effects": "out",
  "post-process-effects": "out",
  "exposure-settings": "out",
  "temporal": "out",
  "style": "out",
  "camera-format": "out",
  "setting": "out",
  "action-fx": "out",
  "loop-subject": "out",
  "person": "out",
  "animal": "out",
  "vehicle": "out",
  "weapon": "out",
  "furniture": "out",
  "held-prop": "out",
  "material": "out",
  "character-fx": "out",
  "camera-motion": "out",
  "transition": "out",
  "music-genre": "out",
  "music-mood": "out",
  "instrumentation": "out",
  "voice-character": "out",
  "voice-delivery": "out",
}

export function getPickerDefaultSourceHandle(nodeType: string): string | null {
  return PICKER_DEFAULT_SOURCE_HANDLE[nodeType] ?? null
}

/**
 * Keys of PICKER_DEFAULT_SOURCE_HANDLE for drift-catcher tests. Exposed
 * as a function (not the raw object) so the table stays an implementation
 * detail — callers can only enumerate types, not mutate the shape. Used
 * by `picker-handles.test.ts` to assert
 * `PICKER_DEFAULT_SOURCE_HANDLE keys ⊆ REGISTRY keys` (reverse of the
 * existing REGISTRY ⊆ PICKER_DEFAULT_SOURCE_HANDLE check).
 */
export function getPickerDefaultSourceHandleTypes(): ReadonlyArray<string> {
  return Object.keys(PICKER_DEFAULT_SOURCE_HANDLE)
}

/**
 * Backfill `sourceHandle` on a single edge for the legacy null/undefined
 * case where the picker's source pip was unidentified before typed pips
 * landed. The popover dedup falls back to wildcard matching on
 * null/undefined sourceHandle so legacy edges still appear in the
 * connected-rows list, but the long-term contract is one explicit
 * handleId per edge.
 *
 * Pure function — returns either the input edge (no change) or a new
 * edge with the backfilled sourceHandle. Used by:
 *   - loadWorkflow's migration pass over loaded edges.
 *   - duplicateNodes (Ctrl+D) — without this, a duplicated picker→
 *     consumer pair carrying a legacy null-sourceHandle edge would
 *     produce a clone edge with the same null sourceHandle, defeating
 *     the load-time migration.
 *
 * The `nodeTypeById` callback decouples this util from the store shape —
 * callers pass whatever they have (Map.get, nodes.find, etc.).
 */
export interface PickerMigrationEdge {
  readonly source: string
  readonly sourceHandle?: string | null
}
export function migratePickerSourceHandle<E extends PickerMigrationEdge>(
  edge: E,
  nodeTypeById: (id: string) => string | undefined,
): E {
  if (edge.sourceHandle != null && edge.sourceHandle !== "") return edge
  const sourceType = nodeTypeById(edge.source)
  if (!sourceType) return edge
  const defaultHandle = getPickerDefaultSourceHandle(sourceType)
  if (!defaultHandle) return edge
  return { ...edge, sourceHandle: defaultHandle }
}
