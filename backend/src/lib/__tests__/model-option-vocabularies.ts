// Read by censuses that check every node type, so a unit change selects them.
// @test-watches frontend/src/nodes/** backend/src/nodes/**
/**
 * The values a workflow node's model fields accept, from the shared lists its
 * route's schema and its node are built from — never a list of ids written
 * out here. One source for the censuses that judge a node by the option that
 * names its model:
 *  - lib/__tests__/provider-model-census.test.ts (an engine name is not judged
 *    as a model id),
 *  - services/workflow-engine/__tests__/default-model-judge-census.test.ts
 *    (every option a node accepts names a model a restriction can name, or
 *    its node is the lever).
 *
 * The route lane reads each route's own Zod schema instead
 * (src/__tests__/credit-guard-run-model-census.test.ts).
 */
import {
  DIALOGUE_PROVIDERS,
  EXTEND_VIDEO_PROVIDERS,
  FACE_SWAP_PROVIDERS,
  IMAGE_EDIT_PROVIDERS,
  IMAGE_GEN_PROVIDERS,
  IMAGE_I2I_PROVIDERS,
  IMAGE_TO_VIDEO_PROVIDERS,
  MODIFY_IMAGE_PROVIDERS,
  MOTION_TRANSFER_PROVIDERS,
  QA_CHECK_PROVIDERS,
  SCRIPT_PROVIDERS,
  SUNO_ADD_TRACK_MODELS,
  SUNO_MODELS,
  TEXT_TO_AUDIO_PROVIDERS,
  TEXT_TO_VIDEO_PROVIDERS,
  TTS_PROVIDERS,
  UPSCALE_IMAGE_PROVIDERS,
  VIDEO_TO_VIDEO_NODE_PROVIDERS,
  VIDEO_UPSCALE_PROVIDERS,
} from "@nodaro/shared/models"
import { NODE_REGISTRY } from "../node-registry.js"

/** Node types the node registry lists no `providers` for, with the enum their route validates `provider` against. */
export const DECLARED_PROVIDER_VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  "generate-image": IMAGE_GEN_PROVIDERS,
  "modify-image": MODIFY_IMAGE_PROVIDERS,
  "upscale-image": UPSCALE_IMAGE_PROVIDERS,
  "image-to-video": IMAGE_TO_VIDEO_PROVIDERS,
  "text-to-video": TEXT_TO_VIDEO_PROVIDERS,
  "video-to-video": VIDEO_TO_VIDEO_NODE_PROVIDERS,
  "extend-video": EXTEND_VIDEO_PROVIDERS,
  "motion-transfer": MOTION_TRANSFER_PROVIDERS,
  "video-upscale": VIDEO_UPSCALE_PROVIDERS,
  "face-swap": FACE_SWAP_PROVIDERS,
  "text-to-speech": TTS_PROVIDERS,
  "text-to-audio": TEXT_TO_AUDIO_PROVIDERS,
  "text-to-dialogue": DIALOGUE_PROVIDERS,
  "generate-script": SCRIPT_PROVIDERS,
  "qa-check": QA_CHECK_PROVIDERS,
}

/**
 * The other node types whose build hands its `provider` to the job, with the
 * list it is chosen from. Kept apart from the map above, which the provider
 * census judges against the catalog's own node targets:
 *  - node types a graph can still carry that the registry no longer lists:
 *    Image to Image (its menu: the image-to-image models) and Edit Image (its
 *    route's enum);
 *  - the entity nodes and Scene, which run Generate Image's models (the
 *    provider census's `RUNS_MODELS_OF`); their routes take any string, and
 *    their menus offer Generate Image's list.
 */
export const OTHER_PROVIDER_VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  "image-to-image": IMAGE_I2I_PROVIDERS,
  "edit-image": IMAGE_EDIT_PROVIDERS,
  character: IMAGE_GEN_PROVIDERS,
  face: IMAGE_GEN_PROVIDERS,
  object: IMAGE_GEN_PROVIDERS,
  creature: IMAGE_GEN_PROVIDERS,
  location: IMAGE_GEN_PROVIDERS,
  scene: IMAGE_GEN_PROVIDERS,
}

/** Model fields other than `provider`, by node type: the Suno nodes name their version in `model`. */
export const MODEL_FIELD_VOCABULARIES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  "suno-generate": { model: SUNO_MODELS },
  "suno-cover": { model: SUNO_MODELS },
  "suno-extend": { model: SUNO_MODELS },
  "suno-mashup": { model: SUNO_MODELS },
  "suno-upload-extend": { model: SUNO_MODELS },
  "suno-add-instrumental": { model: SUNO_ADD_TRACK_MODELS },
  "suno-add-vocals": { model: SUNO_ADD_TRACK_MODELS },
}

/**
 * Every value each model field of a node type accepts: `provider` from the
 * registry's `providers` and the declared enums, and the other model fields.
 * Empty for a node type that names no model.
 */
export function nodeModelOptions(type: string): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>()
  const providers = new Set<string>([
    ...(NODE_REGISTRY.find((d) => d.type === type)?.providers ?? []),
    ...(DECLARED_PROVIDER_VOCABULARIES[type] ?? []),
    ...(OTHER_PROVIDER_VOCABULARIES[type] ?? []),
  ])
  if (providers.size > 0) out.set("provider", [...providers])
  for (const [field, values] of Object.entries(MODEL_FIELD_VOCABULARIES[type] ?? {})) out.set(field, values)
  return out
}
