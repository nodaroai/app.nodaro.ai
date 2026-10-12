/**
 * Entity node types that expose a plain `image` source handle (emitting the
 * portrait URL) in addition to their identity `*Ref` handle. When a wire leaves
 * the `image` handle, the entity is treated as a plain image PRODUCER
 * (substituted to "upload-image") so it reaches image inputs and lists exactly
 * like generate-image / upload-image, while the `*Ref` handle stays identity.
 *
 * SINGLE SOURCE OF TRUTH — consumed by:
 *   - frontend connection validation (drop validator, drag-glow, popover),
 *   - frontend run assemblers (execute-node, video-prompt-assembly),
 *   - frontend config-panel reference preview builders,
 *   - backend payload-builder identity-injection guards.
 * Add future per-handle output-type remaps HERE so every surface inherits them.
 */
export const ENTITY_IMAGE_HANDLE_TYPES: ReadonlySet<string> = new Set([
  "character",
  "location",
  "object",
  "creature",
])

/**
 * Aggregate node types (Group / Collect) whose source handles are typed LANES
 * — `out-text` / `out-image` / `out-video` / `out-audio` — each emitting that
 * media type. Like an entity's `image` handle, a wire leaving a lane is a plain
 * producer of that lane's type, so it must reach the typed inputs of every
 * consumer (Image Collage, Combine Videos, Merge Lists, prompts, …) exactly as
 * an upload node of that type would. Neither node type is in any producer set
 * itself: the NODE emits nothing, its LANES do.
 */
export const AGGREGATE_LANE_SOURCE_TYPES: ReadonlySet<string> = new Set(["group", "collect"])

/**
 * The plain producer each aggregate lane behaves as. `upload-*` are the
 * canonical single-media producers present in every typed accepts set
 * (IMAGE/VIDEO/AUDIO_PRODUCER_TYPES). `out-text` maps to `list`, not
 * `text-prompt`: the lane is a LIST of texts, so it must reach both prompt
 * inputs (TEXT_PRODUCER_TYPES) and the list consumers (Merge Lists / Sort /
 * Dedup / Selector — LIST_PRODUCER_TYPES), exactly like a List text column.
 * (`list` is also a DYNAMIC producer, so the text lane is admitted at media
 * inputs too — the same latitude a List column already has on canvas.)
 */
const AGGREGATE_LANE_EFFECTIVE_TYPE: Readonly<Record<string, string>> = {
  "out-image": "upload-image",
  "out-video": "upload-video",
  "out-audio": "upload-audio",
  "out-text": "list",
}

/**
 * Meta Ads scraper: besides its `json` handle it emits the FEATURED ad's
 * copy, creative image and creative video on typed handles. Each behaves as
 * the canonical single-media producer of that type — `text` maps to
 * `combine-text` (ONE string, not a list), so it reaches prompt inputs but
 * not the list consumers.
 */
// Shared by every scraper node (Meta Ads, Instagram, …): the typed
// text / image / video handles emit the canonical single-media producers.
const SCRAPER_HANDLE_EFFECTIVE_TYPE: Readonly<Record<string, string>> = {
  text: "combine-text",
  image: "upload-image",
  video: "upload-video",
}
const SCRAPER_SOURCE_TYPES = new Set(["meta-ads-scrape", "instagram-scrape"])

/**
 * Output pips that emit a plain medium although their node is no producer of
 * it: node type → pip → the canonical single-media producer the pip behaves
 * as. A row here is NOT an identity remap (`ENTITY_IMAGE_HANDLE_TYPES`, which
 * the identity gates and `sourceRefKey` read) and adds the node to no producer
 * set: only a wire leaving THIS pip is that producer, so the node's other pips
 * (UGC Creator's `creator` record) stay what they are. A frontend guard holds
 * every row to a declared output drawn in that medium's colour.
 *
 * Both engines' input resolvers route a wire leaving one of these pips as the
 * producer it names, and the editor's validators judge it the same way. A
 * UGC wire input (a pip that reads one output of one UGC node) still judges
 * the RAW node and pip, so a text pip keeps feeding the UGC input made for it.
 */
export const OUTPUT_PIP_EFFECTIVE_TYPES: Readonly<Record<string, Readonly<Record<string, string>>>> = Object.freeze({
  // UGC Creator's `image`: the creator's first image, for any image input.
  "ugc-creator": Object.freeze({ image: "upload-image" }),
  // The UGC nodes' plain-text pips — the script's product category, the clips'
  // transcript, the cards' Notes — are one text each (`combine-text`: one
  // string, not a list): they reach text and prompt inputs, never a JSON input.
  "ugc-script": Object.freeze({ category: "combine-text" }),
  "ugc-clips": Object.freeze({ transcript: "combine-text" }),
  "ugc-cards": Object.freeze({ report: "combine-text" }),
})

const own = <T>(table: Readonly<Record<string, T>>, key: string): T | undefined =>
  Object.hasOwn(table, key) ? table[key] : undefined

/**
 * The source type a legacy-handle classifier judges an edge by: the raw node
 * type, unless the edge leaves an `OUTPUT_PIP_EFFECTIVE_TYPES` pip. Only that
 * table: the entity, aggregate and scraper remaps of `resolveEffectiveSourceType`
 * keep the classifiers' rewiring of existing graphs as it was. Read by the
 * editor's load-time pass and the server's write-time normalizer alike.
 */
export function outputPipSourceType(
  rawSourceType: string | undefined | null,
  sourceHandleId: string | undefined | null,
): string {
  const type = rawSourceType ?? ""
  const pips = own(OUTPUT_PIP_EFFECTIVE_TYPES, type)
  return (pips && typeof sourceHandleId === "string" ? own(pips, sourceHandleId) : undefined) ?? type
}

/**
 * The effective output TYPE a given source handle emits. Returns the raw node
 * type for every `(type, handle)` pair EXCEPT:
 *   - an entity `image` handle → `"upload-image"` (a plain image producer);
 *   - an aggregate (group / collect) lane handle → the plain producer of that
 *     lane's media type (see AGGREGATE_LANE_EFFECTIVE_TYPE);
 *   - a Meta Ads `text` / `image` / `video` handle → the plain producer of
 *     that type (see META_ADS_HANDLE_EFFECTIVE_TYPE); its `json` handle keeps
 *     the raw type;
 *   - an `OUTPUT_PIP_EFFECTIVE_TYPES` pip → the producer its row names.
 * Pure — safe for both frontend and backend.
 */
export function resolveEffectiveSourceType(
  rawSourceType: string | undefined | null,
  sourceHandleId: string | undefined | null,
): string {
  if (sourceHandleId === "image" && ENTITY_IMAGE_HANDLE_TYPES.has(rawSourceType ?? "")) {
    return "upload-image"
  }
  const pipType = outputPipSourceType(rawSourceType, sourceHandleId)
  if (pipType !== (rawSourceType ?? "")) return pipType
  if (AGGREGATE_LANE_SOURCE_TYPES.has(rawSourceType ?? "")) {
    const effective = AGGREGATE_LANE_EFFECTIVE_TYPE[sourceHandleId ?? ""]
    if (effective) return effective
  }
  if (SCRAPER_SOURCE_TYPES.has(rawSourceType ?? "")) {
    const effective = SCRAPER_HANDLE_EFFECTIVE_TYPE[sourceHandleId ?? ""]
    if (effective) return effective
  }
  return rawSourceType ?? ""
}

/**
 * The ref-assembly map key (and `ConnectedReference.id`) for a wired source.
 *
 * An entity's `image` handle emits a plain image that is DISTINCT from the
 * entity's identity `*Ref` handle, yet both edges carry the SAME source node
 * id. Every ref-assembly map that keyed by the bare node id therefore had the
 * two edges collide — silently dropping one (identity → a literal `@abi:N`
 * token + lost character, or the plain image → missing from the picker),
 * non-deterministically by edge order. Scoping the entity-`image`-handle ref to
 * `${nodeId}::image` keeps the two refs distinct so BOTH survive. Every other
 * (type, handle) keeps the bare node id, so nothing else changes.
 */
export function sourceRefKey(
  nodeId: string,
  sourceHandleId: string | undefined | null,
  rawSourceType: string | undefined | null,
): string {
  return sourceHandleId === "image" && ENTITY_IMAGE_HANDLE_TYPES.has(rawSourceType ?? "")
    ? `${nodeId}::image`
    : nodeId
}
