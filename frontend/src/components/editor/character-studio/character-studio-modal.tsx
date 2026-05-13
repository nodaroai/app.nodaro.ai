import { useCallback, useState } from "react"
import { toast } from "sonner"
import { useCharacterStudio } from "./use-character-studio"
import { useCharacterStudioJobs, type StudioAssetType } from "./use-character-studio-jobs"
import { AppearanceTab } from "./appearance-tab"
import { ExpressionsTab } from "./expressions-tab"
import { PosesTab } from "./poses-tab"
import { MotionsTab } from "./motions-tab"
import { VoiceTab } from "./voice-tab"
import { PersonalityTab } from "./personality-tab"
import type { CharacterNodeData } from "@/types/nodes"

type TabKey = "appearance" | "expressions" | "poses" | "motions" | "voice" | "personality"

const ASSET_FIELD: Record<StudioAssetType, keyof CharacterNodeData> = {
  expressions: "expressions",
  poses: "poses",
  angles: "angles",
  lighting: "lightingVariations",
  motions: "motions",
}
const STATUS_FIELD: Record<StudioAssetType, keyof CharacterNodeData> = {
  expressions: "expressionStatus",
  poses: "poseStatus",
  angles: "anglesStatus",
  lighting: "lightingStatus",
  motions: "motionStatus",
}

export function CharacterStudioModal({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const studio = useCharacterStudio(nodeId)
  const [tab, setTab] = useState<TabKey>("appearance")
  const [errored, setErrored] = useState<Set<string>>(new Set())

  const onResolved = useCallback(
    (a: { assetType: StudioAssetType; name: string; url: string }) => {
      if (!studio) return
      const field = ASSET_FIELD[a.assetType]
      const arr = (studio.staged[field] as { name: string; url: string }[] | undefined) ?? []
      studio.patch({ [field]: [...arr, { name: a.name, url: a.url }] } as Partial<CharacterNodeData>)
    },
    [studio],
  )

  const onFailed = useCallback((jobId: string) => {
    setErrored((prev) => new Set(prev).add(jobId))
  }, [])

  const jobs = useCharacterStudioJobs(onResolved, onFailed)

  if (!studio) return null

  const handleSave = async () => {
    if (!studio.staged.characterName.trim()) {
      toast.error("Give the character a name before saving.")
      return
    }
    // Stamp *Status = "running" for any asset type with pending jobs, so the canvas node
    // shows a spinner for in-flight asset generation after the modal is saved/closed.
    const running = jobs.runningTypes()
    const statusPatch: Partial<CharacterNodeData> = {}
    for (const t of running) (statusPatch as Record<string, unknown>)[STATUS_FIELD[t]] = "running"
    try {
      await studio.save(Object.keys(statusPatch).length > 0 ? statusPatch : undefined)
    } catch {
      toast.error("Failed to save character.")
    }
  }

  const handleClose = () => {
    if (studio.isDirty && !window.confirm("Discard unsaved changes?")) return
    onClose()
  }

  const counts = {
    expr: studio.staged.expressions.length,
    poses: studio.staged.poses.length,
    motions: studio.staged.motions.length,
  }
  const tabBody = {
    appearance: <AppearanceTab state={studio} jobs={jobs} />,
    expressions: <ExpressionsTab state={studio} jobs={jobs} />,
    poses: <PosesTab state={studio} jobs={jobs} />,
    motions: <MotionsTab state={studio} jobs={jobs} />,
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
        <div className="flex gap-2 items-center">
          <button
            onClick={handleSave}
            className="text-[10px] bg-[#1e3a5f] border border-[#3b82f644] rounded px-3 py-1.5 text-[#93c5fd]"
          >
            Save
          </button>
          <button onClick={handleClose} className="text-[10px] bg-[#1e293b] rounded px-3 py-1.5 text-slate-400">
            ✕ Close
          </button>
        </div>
      </div>
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

export default CharacterStudioModal
