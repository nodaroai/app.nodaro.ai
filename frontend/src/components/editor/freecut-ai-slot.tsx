/**
 * Core shim for Edit with AI, the panel beside the embedded video editor.
 *
 * Core code may not statically import from `ee/`, so the panel arrives through
 * `lazy(() => import(...))`, as the Copilot does (`copilot-panel-slot.tsx`).
 * It is offered only on a build with credits, and only when the editor said in
 * its handshake that it can be edited from here (`edit-ops`, `timeline-read`,
 * `playback`, `presence`): an older editor simply shows no button.
 */
import { Suspense, lazy } from "react"
import { Loader2 } from "lucide-react"
import { hasCredits } from "@/lib/edition"

/** The editor capabilities the panel needs, all of them (FREECUT_READY). */
const AI_EDIT_CAPABILITIES = ["edit-ops", "timeline-read", "playback", "presence"] as const

export function aiEditAvailable(capabilities: readonly string[]): boolean {
  return hasCredits() && AI_EDIT_CAPABILITIES.every((c) => capabilities.includes(c))
}

const LazyAiEditPanel = lazy(() => import("@/ee/components/freecut-ai/ai-edit-panel"))

export interface FreeCutAiSlotProps {
  readonly editorWindow: () => Window | null | undefined
  readonly editorOrigin: string
  readonly videoUrl: string
  readonly onClose: () => void
}

export function FreeCutAiSlot(props: FreeCutAiSlotProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-[360px] shrink-0 items-center justify-center border-s border-[#2D2D2D] bg-[#161616]">
          <Loader2 className="h-5 w-5 animate-spin text-white/50" />
        </div>
      }
    >
      <LazyAiEditPanel {...props} />
    </Suspense>
  )
}
