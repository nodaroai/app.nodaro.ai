import { composeCameraMotionHintFromConnections } from "@nodaro/shared"
import { getParameterPromptHint } from "@nodaro/shared"
import { extractReferencedLabels, canonicalVarName } from "@nodaro/shared"
import { composeTransitionHintFromConnections, type TransitionTiming } from "@nodaro/shared"
import { composeCharacterFxHintFromConnections, type CharacterFxTiming } from "@nodaro/shared"
import type { WorkflowNode, WorkflowEdge, TransitionData, CharacterFxData } from "@/types/nodes"
import { collectCharacterElementInjections } from "@/components/editor/workflow-editor/node-input-resolver"

/**
 * Dispatch by parameter-node type to that node's prompt-hint string. Used by
 * both the frontend DAG executor (when injecting camera-motion's start/end
 * clauses into a consumer's prompt) and the camera-motion config panel
 * preview (so users can see exactly what the connected nodes will contribute).
 *
 * Single source of truth lives in `@nodaro/shared` so
 * the frontend DAG executor and backend orchestrator emit identical text.
 * Camera-motion is composed by `composeCameraMotionHintForNode` below; this
 * dispatcher only needs the static-text (data-only) variant.
 */
export function getNodePromptHint(node: WorkflowNode | undefined): string {
  return getParameterPromptHint(node)
}

/**
 * Compose the full structured camera-motion prompt for a given motion id by
 * walking incoming edges to the camera-motion node to find what's connected
 * to its `startState` and `endState` input handles, dispatching each
 * connected node through {@link getNodePromptHint}.
 *
 * Returns the bare motion hint when no connections exist.
 */
export function composeCameraMotionHintForNode(
  motionId: string | undefined,
  cameraMotionNodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): string {
  if (!cameraMotionNodeId) {
    return composeCameraMotionHintFromConnections(motionId, [], [])
  }
  const startHints: string[] = []
  const endHints: string[] = []
  for (const edge of edges) {
    if (edge.target !== cameraMotionNodeId) continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    const hint = getNodePromptHint(srcNode)
    if (!hint) continue
    if (edge.targetHandle === "startState") startHints.push(hint)
    else if (edge.targetHandle === "endState") endHints.push(hint)
  }
  return composeCameraMotionHintFromConnections(motionId, startHints, endHints)
}

/**
 * Walk a consumer node's `cinematography` target handle and aggregate one
 * prompt-hint string per connected source. Camera-motion sources are composed
 * via their own startState/endState walk (they produce the full structured
 * "beginning with X, ending with Y" sentence); all other parameter nodes
 * dispatch through {@link getNodePromptHint}.
 *
 * Returns an array of non-empty hint strings — the caller decides how to join
 * and append them onto the user prompt. Used by:
 *  - the frontend DAG executor (appends to each AI gen node's prompt),
 *  - the backend workflow-engine payload builder (same),
 *  - the FinalPromptPreview + ConnectedCinematographySources UI components.
 */
/**
 * Compose the full structured transition prompt for a given transition node
 * by forwarding the transition id(s) along with timing options and any
 * start/end hints from connected nodes.
 *
 * Returns the bare transition hint when no start/end context exists.
 */
export function composeTransitionHintForNode(
  data: TransitionData,
  startHints: ReadonlyArray<string> = [],
  endHints: ReadonlyArray<string> = [],
): string {
  const timing: TransitionTiming = {
    position:  data.position,
    duration:  data.duration,
    intensity: data.intensity,
  }
  return composeTransitionHintFromConnections(data.transition, startHints, endHints, timing)
}

/**
 * Compose the full structured character-fx prompt for a given character-fx
 * node by forwarding the effect id(s) along with timing options and any
 * target hints from connected nodes.
 *
 * Returns the bare character-fx hint when no target context exists.
 */
export function composeCharacterFxHintForNode(
  data: CharacterFxData,
  targetHints: ReadonlyArray<string> = [],
): string {
  const timing: CharacterFxTiming = {
    position:  data.position,
    duration:  data.duration,
    intensity: data.intensity,
  }
  return composeCharacterFxHintFromConnections(data.characterFx, targetHints, timing)
}

/** Video-only cinematography dims. Still-image consumers (generate-image,
 *  edit-image, image-to-image, Location entity reference-image gen) pass
 *  these via `options.excludeTypes` to `collectCinematographyHints` so a
 *  stray Motion/Temporal connection doesn't inject incoherent hints. */
export const STILL_IMAGE_EXCLUDE_TYPES: ReadonlySet<string> = new Set(["camera-motion", "temporal", "transition", "character-fx"])

export function collectCinematographyHints(
  consumerNodeId: string,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
  options?: { excludeTypes?: ReadonlySet<string>; excludeCharacterElements?: boolean },
): string[] {
  // Prompt Injection off switches (config-panel section), gated BY HANDLE:
  //  - injectLook === false     → drop the Look family (look / cinematography / style)
  //  - injectElements === false → drop the `elements` handle + character-borne elements
  // Default ON for both (undefined/true).
  const consumerData = nodes.find((n) => n.id === consumerNodeId)?.data as
    | { injectLook?: boolean; injectElements?: boolean; prompt?: string; negativePrompt?: string }
    | undefined
  const lookOff = consumerData?.injectLook === false
  const elementsOff = consumerData?.injectElements === false
  // Used-as-variable suppression: a source the author placed explicitly via
  // `{label}` in the prompt/negative must NOT also auto-inject (no double).
  const referenced = extractReferencedLabels(consumerData?.prompt, consumerData?.negativePrompt)
  const hints: string[] = []
  const exclude = options?.excludeTypes
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    // Generate Image v2.1 splits the legacy `cinematography` / `style` handle
    // into `look` and `elements`. Accept all four so pre-migration AND
    // post-migration workflows still inject hints.
    if (
      edge.targetHandle !== "cinematography" &&
      edge.targetHandle !== "style" &&
      edge.targetHandle !== "look" &&
      edge.targetHandle !== "elements"
    ) continue
    // Handle-scoped injection gate: `elements` follows Inject Elements; every
    // other accepted handle is the Look family (Inject Look).
    if (edge.targetHandle === "elements" ? elementsOff : lookOff) continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (!srcNode) continue
    if (exclude?.has(srcNode.type ?? "")) continue
    // Placed explicitly via `{label}` → skip auto-inject (no double).
    const srcLabel = canonicalVarName(((srcNode.data as { label?: string } | undefined)?.label) || srcNode.type || srcNode.id)
    if (referenced.has(srcLabel)) continue

    if (srcNode.type === "camera-motion") {
      // Build via the shared getParameterPromptHint WITH graph context so the
      // startState/endState walk runs AND the node's preText/postText is applied
      // (withCustomText). composeCameraMotionHintForNode bypassed custom text, so
      // it was dropped at execution while the injection preview promised it.
      const composed = getParameterPromptHint(srcNode, { nodes, edges })
      if (composed) hints.push(composed)
      continue
    }

    const hint = getNodePromptHint(srcNode)
    if (hint) hints.push(hint)
  }

  // Character-borne elements: a Character wired into this consumer carries its
  // OWN Assets/Prompt elements (held-prop, styling, text, …) downstream. For
  // consumers that build a "Use these characters:" bullet (generate-image,
  // image-to-image, modify-image, video gen), the element is woven INTO the
  // character's identity bullet via `ConnectedReference.elementInjection`
  // (stampElementInjections) — those callers pass `excludeCharacterElements:
  // true` so it isn't ALSO appended here (that double-injection at the prompt
  // tail was the reported bug). Consumers WITHOUT a character bullet
  // (edit-image, location, avatar / extend / retake video) have no bullet to
  // weave into, so by DEFAULT the element is appended here — single source
  // (`collectCharacterElementInjections`), preserving their behavior.
  // Character-borne elements follow Inject Elements (same family as the
  // `elements` handle) — skip them when elements injection is disabled.
  if (!options?.excludeCharacterElements && !elementsOff) {
    // Lazy: only resolve when a Character actually feeds this consumer (the
    // common case has none). Mirrors the old fold's laziness and avoids the
    // resolveCharacterAssets walk + Map allocation otherwise.
    const hasWiredCharacter = edges.some((edge) => {
      if (edge.target !== consumerNodeId) return false
      return nodes.find((nd) => nd.id === edge.source)?.type === "character"
    })
    if (hasWiredCharacter) {
      for (const frag of collectCharacterElementInjections(consumerNodeId, nodes, edges).values()) {
        if (frag.trim()) hints.push(frag.trim())
      }
    }
  }

  return hints
}

/**
 * True when the consumer node has a connected Style parameter node on its
 * `cinematography` handle. Used to bypass the inline Style dropdown in image
 * config panels — when the user wires a Style node, the node's richer
 * promptHint takes over and the inline field is disabled.
 */
export function hasConnectedStyleNode(
  consumerNodeId: string | undefined,
  nodes: ReadonlyArray<WorkflowNode>,
  edges: ReadonlyArray<WorkflowEdge>,
): boolean {
  if (!consumerNodeId) return false
  for (const edge of edges) {
    if (edge.target !== consumerNodeId) continue
    if (
      edge.targetHandle !== "cinematography" &&
      edge.targetHandle !== "style" &&
      edge.targetHandle !== "look" &&
      edge.targetHandle !== "elements"
    ) continue
    const srcNode = nodes.find((n) => n.id === edge.source)
    if (srcNode?.type === "style") return true
  }
  return false
}
