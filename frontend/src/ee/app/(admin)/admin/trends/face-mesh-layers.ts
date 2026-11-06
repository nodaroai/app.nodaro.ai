// The face mesh's layers as the Nodaro Motion admin sets them (Admin → Nodaro
// Motion: the Motion column's masking, and the Precise art-style route): one
// switch per layer, any combination. A set a parts value names is saved as
// that value, exactly as before the switches existed (the server saves it so
// too); any other as `faceMeshLayers`.

import {
  VIDEO_FACE_MESH_LAYERS,
  videoFaceMeshLayersDrawLines,
  videoFaceMeshLayersOfParts,
  videoFaceMeshLayersOn,
  videoFaceMeshPartsOfLayers,
  type VideoFaceMeshLayer,
  type VideoFaceMeshLayers,
  type VideoFaceMeshParts,
} from "@nodaro/shared/media"

/** Each layer's switch: its label and what it draws. */
export const FACE_MESH_LAYER_OPTIONS: ReadonlyArray<{ value: VideoFaceMeshLayer; label: string; hint: string }> = [
  { value: "wireframe", label: "Wireframe", hint: "The thin mesh over the whole face." },
  { value: "eyes", label: "Eye outlines", hint: "The outline of each eye." },
  { value: "lips", label: "Lip outline", hint: "The lips' outer and inner outline." },
  { value: "contours", label: "Contours", hint: "The face's outline, eyebrows and nose. With it on, every line leaves out what a turned face hides." },
  { value: "irises", label: "Irises", hint: "A circle and a centre dot on each iris, drawn only inside the open eye." },
  { value: "bold", label: "Bold lines", hint: "Every line drawn twice as thick and darker. Draws nothing on its own." },
]

/** The layers a saved setting draws: its own set, else its parts value's (left out: the full mesh). Each named, a new object. */
export function layersOfSetting(s: { faceMeshLayers?: VideoFaceMeshLayers; faceMeshParts?: VideoFaceMeshParts } | null | undefined): VideoFaceMeshLayers {
  return s?.faceMeshLayers ? videoFaceMeshLayersOn(s.faceMeshLayers) : videoFaceMeshLayersOfParts(s?.faceMeshParts ?? "full")
}

/** The set with `layer` turned on or off: a new object, only the layers on. */
export function withLayer(layers: VideoFaceMeshLayers, layer: VideoFaceMeshLayer, on: boolean): VideoFaceMeshLayers {
  return videoFaceMeshLayersOn({ ...layers, [layer]: on })
}

/**
 * How a set is saved, among the parts values the setting takes (`among`): the
 * value that names it, else the set itself. The full mesh is no key where it
 * is the setting's default (`fullIsDefault`, the masking's), else `"full"`.
 */
export function savedFormOfLayers(
  layers: VideoFaceMeshLayers,
  among: readonly VideoFaceMeshParts[],
  { fullIsDefault = true }: { fullIsDefault?: boolean } = {},
): { faceMeshParts?: VideoFaceMeshParts; faceMeshLayers?: VideoFaceMeshLayers } {
  const parts = videoFaceMeshPartsOfLayers(layers, among)
  if (parts === "full" && fullIsDefault) return {}
  if (parts !== undefined) return { faceMeshParts: parts }
  return { faceMeshLayers: videoFaceMeshLayersOn(layers) }
}

/** Whether the set draws anything (a layer other than bold on): one that does not cannot be saved. */
export const layersDrawLines = (layers: VideoFaceMeshLayers): boolean => videoFaceMeshLayersDrawLines(layers)

/**
 * What a masking saves of its face mesh's lines (`meshDrawn`: the mesh on, not
 * Keep people): its parts other than the full mesh, or its layers as the
 * parts value that names them, else as layers (`savedFormOfLayers`); nothing
 * otherwise, as before either existed.
 */
export function faceMeshLinesSaved(
  m: { faceMeshParts?: "full" | "features" | "mouth"; faceMeshLayers?: VideoFaceMeshLayers },
  meshDrawn: boolean,
): { faceMeshParts?: "features" | "mouth"; faceMeshLayers?: VideoFaceMeshLayers } {
  if (!meshDrawn) return {}
  if (m.faceMeshLayers) return savedFormOfLayers(m.faceMeshLayers, ["full", "features", "mouth"]) as { faceMeshParts?: "features" | "mouth"; faceMeshLayers?: VideoFaceMeshLayers }
  return m.faceMeshParts && m.faceMeshParts !== "full" ? { faceMeshParts: m.faceMeshParts } : {}
}

/** Every layer, in order: what the switches list. */
export const FACE_MESH_LAYERS = VIDEO_FACE_MESH_LAYERS
