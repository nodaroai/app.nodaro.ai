/**
 * The face mesh's layers in a Nodaro Motion masking setting
 * (`FaceMasking.faceMeshLayers`, the Motion setting's alone: the Flex runs) —
 * how a setting is sent to an engine and saved. Pure.
 *
 * A set of layers (`VIDEO_FACE_MESH_LAYERS`) says what the mesh draws in place
 * of `faceMeshParts`. A set that a `faceMeshParts` value names (the full mesh,
 * the eye and lip outlines, the lip outline) IS that value: it is saved and
 * sent as the value (`withCanonicalFaceMeshLayers`, `withFaceMeshLayersFor`),
 * so an engine that draws parts but not layers draws it as before, and a
 * setting whose switches show the full mesh stores exactly what it stored
 * before the switches existed. Any other set (the contours, the irises, bold
 * lines, the eyes alone…) is sent as layers, and only to an engine that
 * declares `castSwap.faceMeshLayers`; to any other the key is stripped (its
 * strict schema would refuse the whole entry) and it draws the full mesh — the
 * shared setting is saved with such a set only once every environment's
 * engine and platform take it (ee/lib/nodaro-motion-face-mesh-layers.ts).
 */
import { videoFaceMeshLayersDrawLines, videoFaceMeshLayersOn, videoFaceMeshPartsOfLayers, type VideoFaceMeshLayers } from "@nodaro/shared/media"
import {
  FACE_MASKING_FACE_MESH_PARTS,
  faceMeshOn,
  withFaceMeshPartsFor,
  type FaceMasking,
  type FaceMaskingFaceMeshParts,
} from "./cast-swap-face-masking.js"

/** The `faceMeshParts` value a set of layers is, among the masking's (`FACE_MASKING_FACE_MESH_PARTS`); undefined when none. */
export function faceMeshPartsOfLayers(layers: VideoFaceMeshLayers | undefined): FaceMaskingFaceMeshParts | undefined {
  return layers ? (videoFaceMeshPartsOfLayers(layers, FACE_MASKING_FACE_MESH_PARTS) as FaceMaskingFaceMeshParts | undefined) : undefined
}

/**
 * THE normaliser of `faceMeshLayers`: the layers on (each `true`, in order)
 * where the setting draws them — the face mesh on (`faceMeshOn`), a set that
 * draws a line, and not one a `faceMeshParts` value names; else undefined
 * (the setting is sent and read as one without the key).
 */
export function faceMeshLayersSent(m: (Pick<FaceMasking, "faceMesh" | "source" | "faceMeshLayers"> & Partial<FaceMasking>) | undefined): VideoFaceMeshLayers | undefined {
  const layers = m?.faceMeshLayers
  if (!faceMeshOn(m) || !layers || !videoFaceMeshLayersDrawLines(layers) || faceMeshPartsOfLayers(layers) !== undefined) return undefined
  return videoFaceMeshLayersOn(layers)
}

/**
 * Whether a (loaded or recorded) Cast Swap engine draws the face mesh's
 * `faceMeshLayers` (`castSwap.faceMeshLayers`). Absent ⇒ an engine from before
 * them, whose strict schema refuses the key: it is never sent one.
 */
export function engineDrawsFaceMeshLayers(cs: { readonly faceMeshLayers?: boolean } | undefined): boolean {
  return cs?.faceMeshLayers === true
}

/**
 * The setting as it is saved: a set of layers that a `faceMeshParts` value
 * names becomes that value (the full mesh: neither key), any other set is
 * kept with only its layers on. A setting without layers is returned as it
 * is. A new object when anything changes.
 */
export function withCanonicalFaceMeshLayers<T extends FaceMasking>(m: T): T {
  if (m.faceMeshLayers === undefined) return m
  const { faceMeshLayers: layers, faceMeshParts: _parts, ...rest } = m
  const parts = faceMeshPartsOfLayers(layers)
  if (parts === "full") return rest as T
  if (parts !== undefined) return { ...rest, faceMeshParts: parts } as T
  return { ...rest, faceMeshLayers: videoFaceMeshLayersOn(layers) } as T
}

/**
 * The setting as an engine is sent it, face-mesh-layers-wise (after
 * `withFaceMeshPartsFor`'s rules): a set a `faceMeshParts` value names is
 * sent as that value (where the engine draws it); any other set as
 * `faceMeshLayers` only when it is drawn (`faceMeshLayersSent`) AND the engine
 * declares layers — else no key at all, exactly the setting before the key
 * existed. A new object.
 */
export function withFaceMeshLayersFor<T extends FaceMasking>(
  m: T,
  cs: { readonly faceMeshLayers?: boolean; readonly faceMeshParts?: readonly FaceMaskingFaceMeshParts[] } | undefined,
): T {
  const { faceMeshLayers: layers, ...rest } = m
  if (layers === undefined) return rest as T
  const parts = faceMeshPartsOfLayers(layers)
  if (parts !== undefined) return withFaceMeshPartsFor({ ...rest, faceMeshParts: parts } as T, cs)
  const sent = faceMeshLayersSent(m)
  if (sent === undefined || !engineDrawsFaceMeshLayers(cs)) return rest as T
  const { faceMeshParts: _parts, ...withoutParts } = rest
  return { ...withoutParts, faceMeshLayers: sent } as T
}
