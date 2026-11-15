"use client"

import { Scissors } from "lucide-react"
import { useT, type MessageKey } from "@/lib/i18n"
import { videoEditorOffered } from "@/lib/runtime-config"

/**
 * "Edit video": the scissors on a video result that opens the embedded video
 * editor. Every canvas surface offering the action draws it through this one
 * button — the shared result overlay (`VideoResultOverlay`'s `onEdit`) and every
 * node that lays out its own result buttons — so an install with the editor
 * switched off (`FREECUT_URL=off`) shows it nowhere: no button, no tooltip.
 * `edit-video-action-funnel.test.ts` fails a file that opens the editor or
 * draws the action any other way.
 *
 * It takes the open as a callback, not a node id: a node unit reaches the store
 * only through its kit (G5), and the callback is what every caller already has.
 */

const BUTTON_CLASS = "w-7 h-7 flex items-center justify-center bg-black/40 backdrop-blur-sm hover:bg-black/60 border border-white/10 text-white rounded-full shadow-sm"

/** The two wordings in use: a result names the editor; the Component node's preview says what it does. */
const WORDING_KEY = {
  editor: "node.editInNodarcut",
  action: "common.editVideo",
} as const satisfies Record<string, MessageKey>

export interface EditVideoButtonProps {
  /** Opens the editor on this result (the node's `openFreeCut`). */
  readonly onEdit: () => void
  /** The button's name: "Edit in NodarCut" (default) or "Edit video". */
  readonly wording?: keyof typeof WORDING_KEY
  /** Show the name as a hover tooltip too (default). Two nodes never had one; kept as they were. */
  readonly tooltip?: boolean
}

export function EditVideoButton({ onEdit, wording = "editor", tooltip = true }: EditVideoButtonProps) {
  const t = useT()
  if (!videoEditorOffered()) return null
  const name = t(WORDING_KEY[wording])
  return (
    <button
      type="button"
      aria-label={name}
      className={BUTTON_CLASS}
      onClick={(e) => { e.stopPropagation(); onEdit() }}
      title={tooltip ? name : undefined}
    >
      <Scissors className="w-3.5 h-3.5" />
    </button>
  )
}
