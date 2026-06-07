import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react"
import { Upload } from "lucide-react"
import { useCharacterStudio, type SaveStatus } from "./use-character-studio"
import { useCharacterStudioJobs, type StudioAssetType } from "./use-character-studio-jobs"
import { AppearanceTab } from "./appearance-tab"
import { ExpressionsTab } from "./expressions-tab"
import { PosesTab } from "./poses-tab"
import { MotionsTab } from "./motions-tab"
import { VoiceTab } from "./voice-tab"
import { PersonalityTab } from "./personality-tab"
import { ReferenceSheetTab } from "../reference-sheet/reference-sheet-tab"
import { SHEET_TAB_ADAPTERS } from "../reference-sheet/sheet-tab-adapter"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAuth } from "@/hooks/use-auth"
import { isMultiUser } from "@/lib/edition"
import type { CharacterNodeData } from "@/types/nodes"

// Lazy dynamic import keeps this core file off the ee/ static-import graph
// (check-ee-imports.mjs only flags top-level `import ... from "@/ee/..."`,
// not `import()` call expressions — same pattern as router.tsx).
const PublishDialog = lazy(() => import("@/ee/components/community/publish-dialog"))

type TabKey = "appearance" | "expressions" | "poses" | "motions" | "sheet" | "voice" | "personality"

const ASSET_FIELD: Record<StudioAssetType, keyof CharacterNodeData> = {
  expressions: "expressions",
  poses: "poses",
  angles: "angles",
  bodyAngles: "bodyAngles",
  lighting: "lightingVariations",
  motions: "motions",
}

export function CharacterStudioModal({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const studio = useCharacterStudio(nodeId)
  const { isAdmin } = useAuth()
  const [tab, setTab] = useState<TabKey>("appearance")
  const [errored, setErrored] = useState<Set<string>>(new Set())
  const [showPublish, setShowPublish] = useState(false)

  const onResolved = useCallback(
    (a: { assetType: StudioAssetType; name: string; url: string }) => {
      if (!studio) return
      const field = ASSET_FIELD[a.assetType]
      const arr = (studio.staged[field] as { name: string; url: string }[] | undefined) ?? []
      // Local merge for instant UX. The backend has also auto-attached the asset
      // to the characters row (see worker entity.ts), so this debounced save
      // will be a no-op patch for the array but still flushes other staged
      // fields. De-duplicates by URL so we don't append twice when a refetch
      // races with a poll completion.
      if (arr.some((it) => it.url === a.url)) return
      studio.patch({ [field]: [...arr, { name: a.name, url: a.url }] } as Partial<CharacterNodeData>)
    },
    [studio],
  )

  const onFailed = useCallback((jobId: string) => {
    setErrored((prev) => new Set(prev).add(jobId))
  }, [])

  const jobs = useCharacterStudioJobs(onResolved, onFailed)

  // Re-mount spinner cards for jobs that were in flight when the studio was
  // closed in a previous session. The backend returns them in the refetch on
  // open; we seed the local pending Map exactly once per modal mount, and the
  // hook's normal polling takes it from there.
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current) return
    const seeds = studio?.initialPendingJobs
    if (!seeds) return
    seededRef.current = true
    for (const s of seeds) jobs.track(s.jobId, s.assetType, s.name)
  }, [studio?.initialPendingJobs, jobs])

  if (!studio) return null

  const counts = {
    expr: studio.staged.expressions.length,
    poses: studio.staged.poses.length,
    motions: studio.staged.motions.length,
    sheets: studio.staged.sheets?.length ?? 0,
  }
  const switchToAppearance = () => setTab("appearance")
  const tabBody = {
    appearance: <AppearanceTab state={studio} jobs={jobs} />,
    expressions: <ExpressionsTab state={studio} jobs={jobs} onSwitchToAppearance={switchToAppearance} />,
    poses: <PosesTab state={studio} jobs={jobs} onSwitchToAppearance={switchToAppearance} />,
    motions: <MotionsTab state={studio} jobs={jobs} onSwitchToAppearance={switchToAppearance} />,
    sheet: (
      <div className="flex-1 overflow-y-auto p-4">
        <ReferenceSheetTab adapter={SHEET_TAB_ADAPTERS.character} studio={studio} jobs={jobs} accent="#3b82f6" />
      </div>
    ),
    voice: <VoiceTab state={studio} />,
    personality: <PersonalityTab state={studio} />,
  }[tab]

  const SideBtn = ({ k, icon, label, badge }: { k: TabKey; icon: string; label: string; badge?: string | number }) => (
    <button
      onClick={() => setTab(k)}
      className={`px-3.5 py-1.5 text-[11px] flex items-center gap-1.5 ${
        tab === k ? "text-[#3b82f6] bg-[#1a2744] border-r-2 border-[#3b82f6]" : "text-slate-500 hover:text-slate-300"
      }`}
    >
      <span className="w-4 text-center">{icon}</span>
      {label}
      {badge !== undefined && <span className="ml-auto text-[9px] bg-[#1e293b] rounded-full px-1.5">{badge}</span>}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[100] bg-[#0d1017] flex flex-col">
      {/* header */}
      <div className="flex items-center justify-between px-4.5 py-2.5 border-b border-[#1e293b] bg-[#090c12] shrink-0">
        <div className="flex items-center gap-3">
          {studio.staged.sourceImageUrl ? (
            <img
              src={studio.staged.sourceImageUrl}
              className="w-8 h-8 rounded-full object-cover border border-[#3b82f644]"
              alt=""
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-[#1a1d27] border border-[#3b82f644]" />
          )}
          <div>
            <div className="text-[13px] font-semibold text-slate-200">
              {studio.staged.characterName || "Unnamed character"}
            </div>
            <div className="text-[10px] text-slate-500">
              {studio.staged.style} · {studio.staged.gender} · {counts.expr} expr · {counts.poses} poses ·{" "}
              {counts.motions} motions
              {errored.size > 0 && <span className="text-[#ef4444]"> · {errored.size} failed</span>}
            </div>
          </div>
        </div>
        <div className="flex gap-3 items-center">
          <SaveIndicator status={studio.saveStatus} />
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
                      disabled={!studio.staged.characterDbId}
                      onClick={() => setShowPublish(true)}
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Share to community
                    </Button>
                  </span>
                </TooltipTrigger>
                {!studio.staged.characterDbId && (
                  <TooltipContent side="bottom">
                    Generate an appearance to save the character first
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          )}
          <button onClick={onClose} className="text-[10px] bg-[#1e293b] rounded px-3 py-1.5 text-slate-400">
            ✕ Close
          </button>
        </div>
      </div>
      {isAdmin && isMultiUser() && studio.staged.characterDbId && (
        <Suspense fallback={null}>
          <PublishDialog
            entityType="character"
            entityId={studio.staged.characterDbId}
            defaultTitle={studio.staged.characterName}
            open={showPublish}
            onOpenChange={setShowPublish}
          />
        </Suspense>
      )}
      {/* body */}
      <div className="flex flex-1 overflow-hidden">
        <div className="w-[140px] bg-[#090c12] border-r border-[#1e293b] flex flex-col py-3 shrink-0">
          <div className="px-3.5 pb-1.5 pt-1 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Identity
          </div>
          <SideBtn k="appearance" icon="🖼" label="Appearance" />
          <div className="px-3.5 pb-1.5 pt-2.5 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Visuals
          </div>
          <SideBtn k="expressions" icon="😄" label="Expressions" badge={counts.expr} />
          <SideBtn k="poses" icon="🧍" label="Poses" badge={counts.poses} />
          <SideBtn k="motions" icon="🏃" label="Motions" badge={counts.motions} />
          <SideBtn k="sheet" icon="📋" label="Sheet" badge={counts.sheets || undefined} />
          <div className="px-3.5 pb-1.5 pt-2.5 text-[9px] uppercase tracking-widest text-slate-700 font-semibold">
            Character
          </div>
          <SideBtn k="voice" icon="🎤" label="Voice" badge={studio.staged.voice ? "✓" : undefined} />
          <SideBtn k="personality" icon="🧠" label="Personality" badge={studio.staged.personality ? "✓" : undefined} />
        </div>
        <div className="flex-1 flex flex-col overflow-hidden">{tabBody}</div>
      </div>
    </div>
  )
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null
  const { dot, text } =
    status === "saving"
      ? { dot: "bg-amber-500 animate-pulse", text: "Saving…" }
      : status === "saved"
        ? { dot: "bg-emerald-500", text: "Saved" }
        : { dot: "bg-red-500", text: "Save failed" }
  return (
    <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
      {text}
    </span>
  )
}

export default CharacterStudioModal
