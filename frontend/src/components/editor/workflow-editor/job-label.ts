import { tx, type MessageKey } from "@/lib/i18n"
import { localizeNodeLabel } from "@/lib/i18n/labels"
import { useLocaleStore } from "@/lib/locale-store"

/**
 * Job labels that are not a node's own label. The pollers name a job in their
 * toasts ("Trim Audio complete"); most executors pass the node's English
 * label, which the node-label tables already translate. These are the ones
 * that describe the job instead. `job-label-coverage.test.ts` fails when an
 * executor passes a label that is in neither place.
 */
const JOB_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  "Reference board generation": "jobLabel.referenceBoardGeneration",
  "Video continuation": "jobLabel.videoContinuation",
  "Video generation": "jobLabel.videoGeneration",
  "Edit Video": "jobLabel.editVideo",
  "Image generation": "jobLabel.imageGeneration",
  "Image editing": "jobLabel.imageEditing",
  "Image transformation": "jobLabel.imageTransformation",
  "Image modification": "jobLabel.imageModification",
  "Image upscale": "jobLabel.imageUpscale",
  "Background removal": "jobLabel.backgroundRemoval",
  "Video-to-video generation": "jobLabel.videoToVideoGeneration",
  "Relight & Switch generation": "jobLabel.relightSwitchGeneration",
  "Text-to-video generation": "jobLabel.textToVideoGeneration",
  "Text-to-speech generation": "jobLabel.textToSpeechGeneration",
  "Combine videos": "jobLabel.combineVideos",
}

/** Whether `label` has a translation of its own (a job label, not a node label). */
export function isJobLabel(label: string): boolean {
  return Object.hasOwn(JOB_LABEL_KEYS, label)
}

/** A job's label in the interface language; an unknown label passes through. */
export function localizeJobLabel(label: string): string {
  return isJobLabel(label) ? tx(JOB_LABEL_KEYS[label]) : localizeNodeLabel(label, useLocaleStore.getState().locale)
}
