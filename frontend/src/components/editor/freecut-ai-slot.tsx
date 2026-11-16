/**
 * Core shim for Edit with AI, the panel beside the embedded video editor.
 *
 * Core code may not statically import from `ee/`, so the panel arrives through
 * `lazy(() => import(...))`, as the Copilot does (`copilot-panel-slot.tsx`).
 * It is offered only on a build with credits, and only when the editor said in
 * its handshake that it can be edited from here (`aiPanelOffered`: `edit-ops`,
 * `timeline-read`, `playback`, `presence`): an older editor simply shows no button.
 */
import { Suspense, lazy, useMemo } from "react"
import { Loader2 } from "lucide-react"
import { aiPanelOffered } from "@nodaro/shared/media"
import { hasCredits } from "@/lib/edition"

export function aiEditAvailable(capabilities: readonly string[]): boolean {
  return hasCredits() && aiPanelOffered(capabilities)
}

const LazyAiEditPanel = lazy(() => import("@/ee/components/freecut-ai/ai-edit-panel"))

export interface FreeCutAiSlotProps {
  readonly editorWindow: () => Window | null | undefined
  readonly editorOrigin: string
  readonly videoUrl: string
  /** What the editor says it can do (`FREECUT_READY.capabilities`). */
  readonly capabilities?: readonly string[]
  readonly onClose: () => void
  /** The panel asks for the whole editor area (`true`, while it shows the original video) or its side column. */
  readonly onLayout?: (wide: boolean) => void
  /** Which project the editor holds; a new number (New project) makes the panel forget the old one. */
  readonly project?: number
}

/** The file name in an address, for the panel to show the video by. */
function fileNameOf(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "") || url
  } catch {
    return url
  }
}

export function FreeCutAiSlot({ videoUrl, ...props }: FreeCutAiSlotProps) {
  // This editor was opened on one video, loaded under a name of the editor's choosing.
  const videos = useMemo(() => [{ url: videoUrl, name: fileNameOf(videoUrl) }], [videoUrl])
  return (
    <Suspense
      fallback={
        <div className="flex h-full w-[360px] shrink-0 items-center justify-center border-s border-[#2D2D2D] bg-[#161616]">
          <Loader2 className="h-5 w-5 animate-spin text-white/50" />
        </div>
      }
    >
      <LazyAiEditPanel {...props} videos={videos} openedVideoUrl={videoUrl} />
    </Suspense>
  )
}
