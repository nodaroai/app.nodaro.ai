/**
 * The nodes one click away: the canvas right-click menu offers all of them,
 * the empty canvas's "Or start manually" row the first three.
 *
 * Availability is the add-node catalogue's (`getNodeOptions`): a node this
 * deployment hides is not offered here either. The look is this list's own —
 * a short name for what the node makes ("Image generation", "Text / LLM")
 * beside a coloured square, the same pairing in the menu and on the empty
 * canvas, so a person learns one mark per kind.
 */
import { getNodeOptions } from "@/lib/node-options"
import type { MessageKey } from "@/lib/i18n"
import type { SceneNodeType } from "@/types/nodes"

/** Image, video, text, an upload and an upscale — in menu order. */
export const QUICK_ADD_NODE_TYPES = [
  "generate-image",
  "generate-video",
  "llm-chat",
  "upload-image",
  "upscale-image",
] as const satisfies readonly SceneNodeType[]

export type QuickAddNodeType = (typeof QUICK_ADD_NODE_TYPES)[number]

/** "Or start manually" on an empty canvas: image, video and text. */
export const START_MANUALLY_NODE_TYPES: readonly QuickAddNodeType[] = QUICK_ADD_NODE_TYPES.slice(0, 3)

export interface QuickAddEntry {
  readonly type: QuickAddNodeType
  readonly labelKey: MessageKey
  /** The background class of the small square beside the name. */
  readonly swatchClass: string
}

const QUICK_ADD_LOOK: Record<QuickAddNodeType, Omit<QuickAddEntry, "type">> = {
  "generate-image": { labelKey: "canvas.quickAddImage", swatchClass: "bg-violet-400" },
  "generate-video": { labelKey: "canvas.quickAddVideo", swatchClass: "bg-emerald-400" },
  "llm-chat": { labelKey: "canvas.quickAddText", swatchClass: "bg-blue-400" },
  "upload-image": { labelKey: "canvas.quickAddUpload", swatchClass: "bg-amber-400" },
  "upscale-image": { labelKey: "canvas.quickAddUpscale", swatchClass: "bg-pink-400" },
}

/** The entries for `types`, in that order, leaving out any this deployment does not offer. */
export function quickAddEntries(types: readonly QuickAddNodeType[]): QuickAddEntry[] {
  const offered = getNodeOptions()
  return types.flatMap((type) =>
    offered.some((o) => o.type === type && !o.adminOnly) ? [{ type, ...QUICK_ADD_LOOK[type] }] : [],
  )
}
