import {
  isGeminiOmniProvider,
  resolveVideoModeForInputs,
  resolveVideoProviderForMode,
  videoProviderRequiresImage,
} from "@nodaro/shared"

/**
 * Target handles that supply the START FRAME.
 * `node-input-resolver.ts:1560-1565` fills `startFrameUrl` / `endFrameUrl` from
 * exactly these; `endFrame` alone is promoted to `imageUrl` server-side.
 */
export const VIDEO_IMAGE_START_FRAME_HANDLES = ["startFrame", "endFrame"] as const

/**
 * Target handles that supply IMAGE REFERENCES (not a start frame).
 * `assets` is a Character / entity node, whose images arrive as references.
 */
export const VIDEO_IMAGE_REF_HANDLES = ["imageReferences", "assets"] as const

/**
 * Target handle that supplies a VIDEO REFERENCE (a connected source video).
 * `generate-video-handles.ts`'s `GENERATE_VIDEO_INPUT_HANDLES` declares this as
 * the Generate Video node's only video-reference input; `node-input-resolver.ts`'s
 * `REFERENCE_HANDLE_MAP` folds it into `referenceVideoUrls` — the same field
 * both engines read as `hasVideoRef`.
 */
export const VIDEO_IMAGE_VIDEO_REF_HANDLES = ["videoReferences"] as const

/**
 * True when this Generate Video node CANNOT run as wired.
 *
 * This reproduces the ENGINES' own guard rather than approximating it —
 * byte-for-byte the engines' predicate incl. the gemini-omni video-ref
 * override: `execute-node.ts:1866-1876` (single-node Run) and
 * `payload-builder.ts:3113-3146` (orchestrated / app runs) both resolve the
 * mode from the wired inputs, remap a split-id provider for that mode, and
 * fail when the result is a text-to-video run on a model with no
 * text-to-video path. Using the same two shared helpers means the editor
 * cannot disagree with either engine.
 *
 * The subtlety worth keeping: reference images alone do NOT lift the gate for
 * a SINGLE-id i2v-only model (`kling-3-omni`, `happyhorse-ref2v`, …), because
 * `resolveVideoModeForInputs` sends that run to text-to-video and it throws —
 * `payload-builder-image-required.test.ts` pins it. They DO lift it for a
 * split-id model whose i2v twin alone carries refs (Grok Imagine 1). Both
 * facts come from the catalog; never hardcode a provider list here.
 *
 * A connected source video (the `videoReferences` handle) ALSO lifts the gate,
 * but only for the Gemini Omni family (gemini-omni-video / gemini-omni-flash):
 * both engines route that combination to their V2V image-to-video path
 * (`isGeminiOmniProvider(provider) && hasVideoRef`) regardless of what
 * `resolveVideoModeForInputs` would otherwise resolve to. Family predicate,
 * never a literal id — a new Omni SKU inherits this for free.
 *
 * (The direct `POST /v1/generate-video` API is more permissive — it accepts a
 * references-only run for a ref-capable model. The editor never takes that
 * path, so the gate follows the engines, and the API's own message says so.)
 */
export function videoImageGateBlocked(
  node: { id: string; type?: string; data?: Record<string, unknown> } | undefined,
  edges: readonly { target: string; targetHandle?: string | null }[],
): boolean {
  if (!node || node.type !== "generate-video") return false
  const provider = node.data?.provider
  if (typeof provider !== "string" || !provider) return false

  const startFrameHandles = new Set<string>(VIDEO_IMAGE_START_FRAME_HANDLES)
  const refHandles = new Set<string>(VIDEO_IMAGE_REF_HANDLES)
  const videoRefHandles = new Set<string>(VIDEO_IMAGE_VIDEO_REF_HANDLES)
  let hasStartFrame = false
  let hasImageRefs = false
  let hasVideoRef = false
  for (const e of edges) {
    if (e.target !== node.id || !e.targetHandle) continue
    if (startFrameHandles.has(e.targetHandle)) hasStartFrame = true
    else if (refHandles.has(e.targetHandle)) hasImageRefs = true
    else if (videoRefHandles.has(e.targetHandle)) hasVideoRef = true
  }

  if (isGeminiOmniProvider(provider) && hasVideoRef) return false

  const mode = resolveVideoModeForInputs(provider, { hasStartFrame, hasImageRefs })
  if (mode !== "text-to-video") return false
  return videoProviderRequiresImage(resolveVideoProviderForMode(provider, mode))
}
