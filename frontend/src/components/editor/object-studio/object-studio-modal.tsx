import { Suspense, lazy, useEffect, useState } from "react"
import { Upload } from "lucide-react"
import { useObjectStudio } from "./use-object-studio"
import { useObjectStudioJobs } from "./use-object-studio-jobs"
import { useObjectCandidates } from "./use-object-candidates"
import { ObjectCandidatesContext } from "./object-candidates-context"
import { StudioShell } from "../studio-shell/studio-shell"
import { OBJECT_STUDIO_NAV } from "./object-nav-config"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/use-auth"
import { hasCredits, isMultiUser } from "@/lib/edition"
import { STUDIO_MODAL_Z } from "../studio-shell/studio-modal-z"

// Lazy dynamic import keeps this core file off the ee/ static-import graph
// (check-ee-imports.mjs only flags top-level `import ... from "@/ee/..."`,
// not `import()` call expressions — same pattern as character-studio-modal.tsx).
const PublishDialog = lazy(() => import("@/ee/components/community/publish-dialog"))

/**
 * Object Studio — fullscreen modal shell.
 *
 * Ported onto the shared config-driven `StudioShell` (mirrors the character +
 * location studio ports): the header + Style Lock toggle + Save + Close +
 * dirty-guard stay here; the 140px sidebar, the grouped page list, and the
 * body switch are now driven by `OBJECT_STUDIO_NAV`. The reference-photo
 * mood-board is promoted out of the Appearance tab into a first-class
 * **References** page (Resources group).
 *
 * Dirty-state guard: Escape and Close both prompt via window.confirm when
 * isDirty. In-flight saves / approvals block close entirely.
 *
 * Cold-load: when the workflow store hasn't finished hydrating the node
 * (stagedData is null), renders a "Loading object…" placeholder instead
 * of crashing on missing data.
 */
interface ObjectStudioModalProps {
  readonly nodeId: string
  readonly onClose: () => void
}

export function ObjectStudioModal({ nodeId, onClose }: ObjectStudioModalProps) {
  const studio = useObjectStudio(nodeId)
  // Modal-level jobs hook for the Sheet page's Stage-A panel tracking. The
  // image-asset pages each create their own; the sheet page consumes this one
  // (passed through StudioShell as `jobs`).
  const sheetJobs = useObjectStudioJobs([])
  // Main-image candidate state + jobs tracker, owned at MODAL scope so in-flight
  // candidates + the completed-candidate grid survive Appearance↔other-tab
  // navigation (StudioShell unmounts the page on every switch). Distinct from
  // `sheetJobs` above; its generate/approve handlers guard internally on
  // `studio.stagedData`, so mounting before the cold-load early return is safe.
  const candidates = useObjectCandidates(studio)
  const { isAdmin } = useAuth()
  const [showPublish, setShowPublish] = useState(false)

  // Escape closes the modal — with a dirty-check prompt so unsaved edits
  // aren't silently discarded. In-flight saves block close entirely (the
  // user can't escape an inflight network call).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      if (studio.isSaving || studio.isApprovingMainImage) return
      if (studio.isDirty) {
        if (window.confirm("Discard unsaved changes?")) onClose()
      } else {
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [studio.isDirty, studio.isSaving, studio.isApprovingMainImage, onClose])

  if (!studio.stagedData) {
    return (
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Object/Props Studio"
        className={`fixed inset-0 ${STUDIO_MODAL_Z} bg-[#0d1017] flex items-center justify-center`}
      >
        <div className="text-sm text-slate-400">Loading object…</div>
      </div>
    )
  }

  const data = studio.stagedData
  const closeBlocked = studio.isSaving || studio.isApprovingMainImage

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="object-studio-title"
      className={`fixed inset-0 ${STUDIO_MODAL_Z} bg-[#0d1017] flex flex-col`}
    >
      {/* header */}
      <div className="flex items-center justify-between px-4.5 py-2.5 border-b border-[#1e293b] bg-[#090c12] shrink-0">
        <div className="flex items-center gap-3">
          {data.sourceImageUrl ? (
            <img
              src={data.sourceImageUrl}
              className="w-8 h-8 rounded object-cover border border-[#22d3ee44]"
              alt=""
            />
          ) : (
            <div className="w-8 h-8 rounded bg-[#1a1d27] border border-[#22d3ee44]" />
          )}
          <div>
            <h1 id="object-studio-title" className="text-[13px] font-semibold text-slate-200">
              {data.objectName || "Unnamed object"}
            </h1>
            <div className="text-[10px] text-slate-500">
              {data.category} · {data.style}
              {data.styleLock && <span className="text-[#22d3ee]"> · Style locked</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={data.styleLock}
              onChange={(e) => studio.patch({ styleLock: e.target.checked })}
              disabled={closeBlocked}
              className="accent-[#22d3ee]"
            />
            Style Lock
          </label>
          <button
            type="button"
            onClick={() => {
              void studio.saveStaged().catch(() => {
                /* errors already toasted in the hook */
              })
            }}
            disabled={!studio.isDirty || closeBlocked}
            className="text-[11px] px-3 py-1.5 rounded bg-[#ff0073] hover:bg-[#ff0073]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white"
          >
            {studio.isSaving ? "Saving…" : "Save"}
          </button>
          {isAdmin && isMultiUser() && (
            <TooltipProvider delayDuration={0}>
              <Tooltip>
                <TooltipTrigger asChild>
                  {/* span wrapper so the tooltip still fires while the button is disabled */}
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1.5 text-[11px] text-slate-300 hover:text-white hover:bg-[#1e293b]"
                      disabled={!data.objectDbId}
                      onClick={() => setShowPublish(true)}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Share to community
                    </Button>
                  </span>
                </TooltipTrigger>
                {!data.objectDbId && (
                  <TooltipContent side="bottom">
                    Generate an appearance to save the object first
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
          <button
            type="button"
            onClick={() => {
              if (closeBlocked) return
              if (studio.isDirty && !window.confirm("Discard unsaved changes?")) return
              onClose()
            }}
            disabled={closeBlocked}
            className="text-[10px] bg-[#1e293b] rounded px-3 py-1.5 text-slate-400 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Close"
          >
            ✕ Close
          </button>
        </div>
      </div>

      {isAdmin && isMultiUser() && data.objectDbId && (
        <Suspense fallback={null}>
          <PublishDialog
            entityType="object"
            entityId={data.objectDbId}
            defaultTitle={data.objectName}
            open={showPublish}
            onOpenChange={setShowPublish}
          />
        </Suspense>
      )}

      <ObjectCandidatesContext.Provider value={candidates}>
        <StudioShell
          config={OBJECT_STUDIO_NAV}
          state={studio}
          jobs={sheetJobs}
          hasCredits={hasCredits()}
          defaultActiveKey="appearance"
        />
      </ObjectCandidatesContext.Provider>
    </div>
  )
}

export default ObjectStudioModal
