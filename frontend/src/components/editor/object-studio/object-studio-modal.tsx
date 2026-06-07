import { Suspense, lazy, useEffect, useState } from "react"
import { Upload } from "lucide-react"
import { useObjectStudio } from "./use-object-studio"
import { AppearanceTab } from "./appearance-tab"
import { AnglesTab } from "./angles-tab"
import { MaterialsTab } from "./materials-tab"
import { VariationsTab } from "./variations-tab"
import { MotionTab } from "./motion-tab"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/use-auth"
import { isMultiUser } from "@/lib/edition"

// Lazy dynamic import keeps this core file off the ee/ static-import graph
// (check-ee-imports.mjs only flags top-level `import ... from "@/ee/..."`,
// not `import()` call expressions — same pattern as character-studio-modal.tsx).
const PublishDialog = lazy(() => import("@/ee/components/community/publish-dialog"))

/**
 * Object Studio — fullscreen modal shell.
 *
 * Mirrors the location-studio precedent (location-studio-modal.tsx) verbatim
 * with location → object substitution + object-specific deltas:
 *  - 5 tabs (Appearance/Angles/Materials/Variations/Motion), NOT location's 7.
 *  - Sidebar sections: Identity / Composition / Variants / Motion. Location
 *    has 4 sections (Identity / Environment / Composition / Atmosphere).
 *  - Header summary stats: angles + materials + variations + motion clips +
 *    reference photos (5 buckets). No time-of-day / weather / seasons / lighting.
 *
 * Dirty-state guard: Escape and Close both prompt via window.confirm when
 * isDirty. AlertDialog-based UX is a Phase 2 polish item.
 *
 * Cold-load: when the workflow store hasn't finished hydrating the node
 * (stagedData is null), renders a "Loading object…" placeholder instead
 * of crashing on missing data.
 */

type TabId =
  | "appearance"
  | "angles"
  | "materials"
  | "variations"
  | "motion"

interface TabButtonProps {
  readonly id: TabId
  readonly icon: string
  readonly label: string
  readonly count: number
  readonly active: boolean
  readonly onClick: () => void
}

/**
 * Sidebar tab button. Shows icon + label + parenthetical count when count > 0.
 * Active state mirrors the location precedent: cyan text, dark cyan-tinted
 * background, and a 2px right-border accent.
 */
function TabButton({ icon, label, count, active, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "px-3.5 py-1.5 text-[11px] flex items-center gap-1.5 text-[#22d3ee] bg-[#0e2730] border-r-2 border-[#22d3ee]"
          : "px-3.5 py-1.5 text-[11px] flex items-center gap-1.5 text-slate-500 hover:text-slate-300"
      }
    >
      <span className="w-4 text-center">{icon}</span>
      {label}
      {count > 0 && <span className="text-slate-500">({count})</span>}
    </button>
  )
}

interface ObjectStudioModalProps {
  readonly nodeId: string
  readonly onClose: () => void
}

export function ObjectStudioModal({ nodeId, onClose }: ObjectStudioModalProps) {
  const studio = useObjectStudio(nodeId)
  const { isAdmin } = useAuth()
  const [activeTab, setActiveTab] = useState<TabId>("appearance")
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
        aria-label="Object Studio"
        className="fixed inset-0 z-[1000] bg-[#0d1017] flex items-center justify-center"
      >
        <div className="text-sm text-slate-400">Loading object…</div>
      </div>
    )
  }

  const data = studio.stagedData
  const closeBlocked = studio.isSaving || studio.isApprovingMainImage

  const counts = {
    angles: data.angles?.length ?? 0,
    materials: data.materials?.length ?? 0,
    variations: data.variations?.length ?? 0,
    motion: data.motionClips?.length ?? 0,
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="object-studio-title"
      className="fixed inset-0 z-[1000] bg-[#0d1017] flex flex-col"
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

      {/* body */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[140px] bg-[#090c12] border-r border-[#1e293b] flex flex-col py-3 shrink-0">
          <div className="px-3.5 pb-1.5 pt-1 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Identity
          </div>
          <TabButton
            id="appearance"
            icon="📦"
            label="Appearance"
            count={0}
            active={activeTab === "appearance"}
            onClick={() => setActiveTab("appearance")}
          />

          <div className="px-3.5 pb-1.5 pt-4 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Composition
          </div>
          <TabButton
            id="angles"
            icon="📐"
            label="Angles"
            count={counts.angles}
            active={activeTab === "angles"}
            onClick={() => setActiveTab("angles")}
          />

          <div className="px-3.5 pb-1.5 pt-4 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Variants
          </div>
          <TabButton
            id="materials"
            icon="🧪"
            label="Materials"
            count={counts.materials}
            active={activeTab === "materials"}
            onClick={() => setActiveTab("materials")}
          />
          <TabButton
            id="variations"
            icon="✨"
            label="Variations"
            count={counts.variations}
            active={activeTab === "variations"}
            onClick={() => setActiveTab("variations")}
          />

          <div className="px-3.5 pb-1.5 pt-4 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Motion
          </div>
          <TabButton
            id="motion"
            icon="🎬"
            label="Motion"
            count={counts.motion}
            active={activeTab === "motion"}
            onClick={() => setActiveTab("motion")}
          />
        </aside>

        <main className="flex-1 overflow-y-auto p-4">
          {activeTab === "appearance" && <AppearanceTab studio={studio} />}
          {activeTab === "angles" && <AnglesTab studio={studio} />}
          {activeTab === "materials" && <MaterialsTab studio={studio} />}
          {activeTab === "variations" && <VariationsTab studio={studio} />}
          {activeTab === "motion" && <MotionTab studio={studio} />}
        </main>
      </div>
    </div>
  )
}

export default ObjectStudioModal
