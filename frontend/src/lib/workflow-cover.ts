/**
 * Which cover a workflow shows when nobody has picked one.
 *
 * The rule, in order:
 *   1. the cover the user chose  (the caller's job — this file is the fallback)
 *   2. a look derived from what the flow actually makes: video, audio, image
 *   3. one look for a flow that has nodes but makes no media of its own
 *   4. one fixed default for a flow with nothing in it yet
 *
 * Classification comes from vocabularies that already exist and are already
 * maintained — the producer-type sets the canvas validators use, unioned with
 * the presentation classifier. Neither is complete on its own (`getOutputType`
 * calls a TTS node "data"; the producer sets say nothing about images), and a
 * third hand-kept list here would be one more thing to forget when a node type
 * is added.
 *
 * A type in NEITHER vocabulary — including a `DYNAMIC_PRODUCER_TYPES` node,
 * whose medium is decided at run time — falls to the "has nodes, makes no
 * media" look. That is the honest answer: we do not know what it will produce
 * until it runs, so the cover does not claim to.
 */
import { AUDIO_PRODUCER_TYPES, VIDEO_PRODUCER_TYPES, getOutputType } from "@nodaro/shared"

/** The five colourways from the design system, in its order. */
export const COVER_VARIANTS = ["aurora", "orchid", "lagoon", "cobalt", "ember"] as const
export type CoverVariant = (typeof COVER_VARIANTS)[number]

/** A flow with no nodes yet — the one fixed default. */
export const EMPTY_FLOW_COVER: CoverVariant = "aurora"

function isVideo(type: string): boolean {
  return VIDEO_PRODUCER_TYPES.has(type) || getOutputType(type) === "video"
}

function isAudio(type: string): boolean {
  return AUDIO_PRODUCER_TYPES.has(type) || getOutputType(type) === "audio"
}

function isImage(type: string): boolean {
  return getOutputType(type) === "image"
}

/**
 * @param nodeTypes distinct node types in the flow. `null`/`undefined` means we
 *   do not know yet — the column has not reached this environment. That is
 *   indistinguishable from an empty flow to the person looking at the card, so
 *   both get the same cover rather than a guess.
 */
export function coverVariantForNodeTypes(nodeTypes: readonly string[] | null | undefined): CoverVariant {
  if (!nodeTypes || nodeTypes.length === 0) return EMPTY_FLOW_COVER

  // A flow is named by what it ENDS with, not by what it has most of: three
  // image nodes feeding one video node is a video flow, and counting would
  // call it an image flow.
  if (nodeTypes.some(isVideo)) return "lagoon"
  if (nodeTypes.some(isAudio)) return "orchid"
  if (nodeTypes.some(isImage)) return "cobalt"

  // Nodes, but nothing a person would watch or listen to — text, parameters,
  // utilities. Still not a blank canvas, so it does not look like one.
  return "ember"
}

/**
 * Distinct node types out of a raw `nodes` array.
 *
 * The database keeps `cover_node_types` in sync by trigger, so this is only for
 * the places holding a graph the list has not seen yet — duplicating or
 * importing a workflow. Same shape, same answer.
 */
export function nodeTypesOf(nodes: unknown): string[] {
  if (!Array.isArray(nodes)) return []
  const types = new Set<string>()
  for (const node of nodes) {
    const type = (node as { type?: unknown } | null)?.type
    if (typeof type === "string" && type.length > 0) types.add(type)
  }
  return [...types]
}
