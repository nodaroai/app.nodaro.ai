import type { ImageCriticMode } from "@nodaro/shared"
import type { MessageKey } from "@/lib/i18n"

/**
 * Each Image Critic mode by its label. The mode id is what the node stores and
 * the backend reads; the label is what a person sees. Keyed by the shared
 * union, so a new mode without a label fails tsc.
 */
export const IMAGE_CRITIC_MODE_LABEL: Readonly<Record<ImageCriticMode, MessageKey>> = {
  "character-consistency": "criticMode.characterConsistency",
  realism: "criticMode.realism",
  "prompt-adherence": "criticMode.promptAdherence",
  anatomy: "criticMode.anatomy",
  aesthetic: "criticMode.aesthetic",
  "style-match": "criticMode.styleMatch",
  all: "criticMode.all",
}
