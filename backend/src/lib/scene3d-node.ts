/**
 * Canvas-node → Scene3D wire helpers.
 *
 * The orchestrator resolves graph inputs before sending them through the
 * same authoring route as single-node runs. These helpers preserve reference
 * identity, conditioning and timing across the two surfaces.
 */
import { createHash } from "node:crypto"
import {
  ASPECT_RATIO_DIMENSIONS,
  LLM_FEATURE_DEFAULTS,
  SCENE3D_DEFAULT_DURATION_SECONDS,
  SCENE3D_DEFAULT_FPS,
  SCENE3D_LIMITS,
  scene3DReferenceSchema,
  type Scene3DReference,
} from "@nodaro/shared"
import { scene3DImageModalityError, scene3DReferenceListError } from "../services/scene3d/scene3d-references.js"

interface WiredReferences {
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
}

/** A reference role the node's config may pin per modality; anything else
 *  falls back to the modality's natural default. */
function roleFor(kind: "image" | "video", data: Record<string, unknown>): Scene3DReference["role"] {
  const configured = kind === "image" ? data.imageReferenceRole : data.videoReferenceRole
  if (configured === "appearance" || configured === "layout" || configured === "motion") return configured
  return kind === "video" ? "motion" : "appearance"
}

/** Preserve authored identity, role and time-window fields. Refuse invalid
 * or oversized input rather than changing the conditioning silently. */
export function scene3DReferencesFromNode(
  data: Record<string, unknown>,
  wired: WiredReferences,
  graphReferences: readonly Scene3DReference[] = [],
): Scene3DReference[] {
  const references: Scene3DReference[] = []
  const seenIds = new Set<string>()
  const seenUrls = new Set<string>()
  const add = (candidate: unknown) => {
    const parsed = scene3DReferenceSchema.safeParse(candidate)
    if (!parsed.success) throw new Error(`Invalid 3D scene reference: ${parsed.error.issues[0]?.message}`)
    const reference = parsed.data as Scene3DReference
    if (seenIds.has(reference.id)) throw new Error(`Duplicate 3D scene reference id "${reference.id}"`)
    seenIds.add(reference.id)
    seenUrls.add(reference.url)
    references.push(reference)
  }
  for (const entry of Array.isArray(data.references) ? data.references : []) add(entry)
  for (const reference of graphReferences) {
    const index = references.findIndex((entry) => entry.id === reference.id)
    if (index < 0) add(reference)
    else {
      references[index] = scene3DReferenceSchema.parse(reference) as Scene3DReference
      seenUrls.add(reference.url)
    }
  }
  const addUrl = (url: string, kind: "image" | "video") => {
    if (seenUrls.has(url)) return
    add({ id: `ref-${createHash("sha256").update(url).digest("hex").slice(0, 32)}`,
      url, kind, role: roleFor(kind, data) })
  }
  for (const url of wired.referenceImageUrls ?? []) addUrl(url, "image")
  for (const url of wired.referenceVideoUrls ?? []) addUrl(url, "video")
  const error = scene3DReferenceListError(references)
  if (error) throw new Error(error)
  return references
}

/**
 * The orchestrated path's pre-flight, run from `payload-builder` BEFORE it
 * returns a payload — which is before the reservation, so a refusal here costs
 * nothing. It is the same pair of checks `routes/3d-scene.ts` runs, from the
 * same helpers, because a node that the route would refuse must not become a
 * paid job just because it was reached through a workflow instead.
 */
export function scene3DNodePreflightError(
  references: readonly Scene3DReference[],
  llmModel: string | undefined,
  deterministic: boolean,
): string | undefined {
  const listError = scene3DReferenceListError(references)
  if (listError) return listError
  if (deterministic) return undefined
  return scene3DImageModalityError(llmModel ?? LLM_FEATURE_DEFAULTS["3d-scene"], references)
}

/** The render frame a generate node runs at — the route's `scene3DRenderFrame`,
 *  reading node data instead of a request body. */
export function scene3DFrameFromNode(data: Record<string, unknown>): {
  fps: number
  durationInFrames: number
  width: number
  height: number
} {
  const fps = typeof data.fps === "number" ? data.fps : SCENE3D_DEFAULT_FPS
  // Clamped to the contract's floor, which the route's Zod also quotes: the
  // canvas must not be able to ask for a shorter scene than the wire allows.
  const seconds = Math.max(
    SCENE3D_LIMITS.minDurationSeconds,
    typeof data.durationSeconds === "number" ? data.durationSeconds : SCENE3D_DEFAULT_DURATION_SECONDS,
  )
  const aspect = typeof data.aspectRatio === "string" ? data.aspectRatio : "16:9"
  const dimensions = ASPECT_RATIO_DIMENSIONS[aspect] ?? ASPECT_RATIO_DIMENSIONS["16:9"]
  return {
    fps,
    durationInFrames: Math.min(
      SCENE3D_LIMITS.maxDurationInFrames,
      Math.max(SCENE3D_LIMITS.minDurationInFrames, Math.round(seconds * fps)),
    ),
    width: dimensions.width,
    height: dimensions.height,
  }
}
