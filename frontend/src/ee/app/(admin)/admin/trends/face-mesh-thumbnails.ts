// The face mesh illustrations of Admin → Nodaro Motion: which picture shows a
// set of face mesh layers, and what it says. Every set that draws lines has its
// own picture (`face-mesh-thumbnail-files.ts`, drawn by the platform's own face
// mesh code on a depth face — backend/scripts/render-face-mesh-thumbnails.mts),
// so a set of switches is shown exactly as it is drawn, never stacked up.

import { VIDEO_FACE_MESH_LAYERS, videoFaceMeshLayersDrawLines, type VideoFaceMeshLayer, type VideoFaceMeshLayers } from "@nodaro/shared/media"
import { FACE_MESH_LAYER_OPTIONS } from "./face-mesh-layers"
import { FACE_MESH_THUMBNAIL_FILES } from "./face-mesh-thumbnail-files"

/** A picture and what it shows. */
export interface FaceMeshThumbnail {
  readonly src: string | undefined
  readonly alt: string
}

/** The key of `layers`' picture: the layers on, `+`-joined in `VIDEO_FACE_MESH_LAYERS` order; "depth" when it draws no lines. */
export function faceMeshThumbnailKey(layers: VideoFaceMeshLayers): string {
  return videoFaceMeshLayersDrawLines(layers) ? VIDEO_FACE_MESH_LAYERS.filter((l) => layers[l] === true).join("+") : "depth"
}

const andList = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`

/** `layers` drawn on the depth face. */
export function faceMeshLayersThumbnail(layers: VideoFaceMeshLayers): FaceMeshThumbnail {
  const drawn = FACE_MESH_LAYER_OPTIONS.filter((o) => o.value !== "bold" && layers[o.value] === true).map((o) => o.label.toLowerCase())
  const alt = drawn.length === 0 ? "A depth face with no face mesh lines" : `A depth face with the ${andList(drawn)} drawn${layers.bold === true ? " in bold lines" : ""}`
  return { src: FACE_MESH_THUMBNAIL_FILES[faceMeshThumbnailKey(layers)], alt }
}

/**
 * A layer switch's picture: the layer alone; the irises close up (on the whole face they are a few pixels);
 * Bold lines, which draw nothing alone, as the whole mesh in bold.
 */
export function faceMeshLayerSwitchThumbnail(layer: VideoFaceMeshLayer): FaceMeshThumbnail {
  if (layer === "irises") return { src: FACE_MESH_THUMBNAIL_FILES["irises-closeup"], alt: "The irises alone, drawn on a depth face, the eyes close up" }
  if (layer === "bold") return faceMeshLayersThumbnail({ wireframe: true, eyes: true, lips: true, bold: true })
  return faceMeshLayersThumbnail({ [layer]: true })
}
