import type { PipelineStageName } from "@nodaro/shared"
import type { MessageKey, TFunction } from "@/lib/i18n"

/**
 * Dictionary key of the human-readable label for each pipeline stage
 * (ordered). The one place a stage id becomes words — the stage list, the
 * re-run toast, the branch breadcrumb, the drift banner and the chat header
 * all read it, so a raw id ("shot_list") never reaches a sentence.
 */
export const STAGE_LABEL_KEYS: Readonly<Record<PipelineStageName, MessageKey>> = {
  script: "pipe.stageLabelScript",
  characters: "pipe.stageLabelCharacters",
  objects: "pipe.stageLabelObjects",
  locations: "pipe.stageLabelLocations",
  shot_list: "pipe.stageLabelShotList",
  scene_images: "pipe.stageLabelSceneImages",
  animate_audio_edit: "pipe.stageLabelAnimateAudio",
  post_merge: "pipe.stageLabelPostMerge",
}

/**
 * A stage's label for a stage name typed as a plain string (the API's
 * `branched_from_stage`, a drift event's `stageName`). A name the map does not
 * know yet passes through rather than rendering blank.
 */
export function stageLabel(stage: string, t: TFunction): string {
  const key = (STAGE_LABEL_KEYS as Readonly<Record<string, MessageKey | undefined>>)[stage]
  return key ? t(key) : stage
}
