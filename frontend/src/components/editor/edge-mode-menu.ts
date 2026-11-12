// The mode menu of a wire (Selected / Item / Each / Bundle) and its default,
// by its source and target: a pure rule, read by the edge component
// (animated-flow-edge.tsx) and its tests.

// NOTE: outputMode "last" is semantically "the currently selected result"
// (reads activeResultIndex from the source node). This is DIFFERENT from the
// word "last" appearing inside range/list expressions (e.g. rangeTo: "last",
// listExpression: "1, 3, last"), where "last" means "the final index in the
// array." Same word, different meanings.
export const MODE_OPTIONS = [
  { value: "last", labelKey: "canvas.edgeModeSelected", descKey: "canvas.edgeModeSelectedDesc" },
  { value: "item", labelKey: "canvas.edgeModeItem", descKey: "canvas.edgeModeItemDesc" },
  { value: "each", labelKey: "canvas.edgeModeEach", descKey: "canvas.edgeModeEachDesc" },
  { value: "all", labelKey: "canvas.edgeModeBundle", descKey: "canvas.edgeModeBundleDesc" },
] as const

// List/loop/split-text produce inherent items with no user-selection concept,
// so "Selected" doesn't apply — those edges default to "Each" (fan-out).
const LIST_LIKE_SOURCE_TYPES = new Set(["list", "split-text"])

// When feeding INTO a list/loop column, Each (fan-out) doesn't apply — the
// target accumulates items into the column as a bundle. Hide Each, default
// to All. At runtime, resolveEdgeValuesForTableColumn treats Each and All
// identically for list-like targets, so pre-existing "each" edges still
// work while the UI steers new ones to "all".
const LIST_LIKE_TARGET_TYPES = new Set(["list"])

// Target node types that accept multiple items in a single invocation
// (arrays/bundles). Only these can meaningfully receive Bundle mode — the
// multiple items land in referenceImageUrls / videoUrls / audioUrls etc.
// All other nodes collapse a Bundle to a single value, so offering it is
// misleading; we hide it from the dropdown.
const MULTI_INPUT_TARGET_TYPES = new Set([
  // Image generators accept multiple reference images
  "generate-image", "edit-image", "image-to-image", "modify-image",
  // Audio mixers / combiners
  "mix-audio", "combine-audio", "suno-mashup",
  // Video combiners
  "combine-videos",
  // Slideshow: N ordered images in one node (the Bundle edge is the
  // list → images lane; same mechanism as combine-videos' clips)
  "slideshow",
  // Manual edit / composite accept multiple inputs
  "manual-edit", "composite",
  // Text combiners
  "combine-text",
  // List targets collect into a column
  "list",
  // Social posts — carousels/galleries/threads accept multiple media items.
  // The single-post modes collapse to one; users switch via the node's
  // action field, so it's safe to allow Bundle here.
  "instagram-post", "tiktok-post", "facebook-post", "x-post", "linkedin-post",
])

// Bundle targets for a node unit's LIST pip (`sourceListPip`: one run's files, e.g.
// a split image's layers) beyond the set above: each item lands as its own image
// wire (`expandUnitListBundles`) and Image Collage collects them all. Other
// sources into these targets keep their menu (decided 2026-11-11).
const UNIT_LIST_PIP_EXTRA_BUNDLE_TARGETS: ReadonlySet<string> = new Set(["image-collage"])

export type EdgeMenuMode = (typeof MODE_OPTIONS)[number]["value"]

/**
 * A wire's mode menu (menu order) and its default — the runtime's: into a list
 * column "all", from a list-like source or a unit list pip "each", else "last"
 * (Selected). Selected is hidden from a list-like source, Each into a list
 * column, Bundle where the target takes one item (it would collapse or drop).
 */
export function edgeModeMenu(edge: { readonly sourceNodeType?: string; readonly targetNodeType?: string; readonly sourceListPip?: boolean } | undefined): {
  readonly modes: readonly EdgeMenuMode[]
  readonly defaultMode: EdgeMenuMode
} {
  const target = edge?.targetNodeType ?? ""
  const fromListPip = edge?.sourceListPip === true
  const listSource = LIST_LIKE_SOURCE_TYPES.has(edge?.sourceNodeType ?? "") || fromListPip
  const listTarget = LIST_LIKE_TARGET_TYPES.has(target)
  const takesMany = MULTI_INPUT_TARGET_TYPES.has(target) || (fromListPip && UNIT_LIST_PIP_EXTRA_BUNDLE_TARGETS.has(target))
  const modes = MODE_OPTIONS.map((o) => o.value).filter((mode) =>
    !(mode === "last" && listSource) && !(mode === "each" && listTarget) && !(mode === "all" && !takesMany))
  return { modes, defaultMode: listTarget ? "all" : listSource ? "each" : "last" }
}
