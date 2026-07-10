import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react"
import { Upload } from "lucide-react"
import { useCharacterStudio, type CharacterStudioState, type SaveStatus } from "./use-character-studio"
import { useCharacterStudioJobs, type CharacterStudioJobs, type StudioAssetType } from "./use-character-studio-jobs"
import { StudioShell } from "../studio-shell/studio-shell"
import { CHARACTER_STUDIO_NAV } from "./character-nav-config"
import { usePortraitCandidates } from "./use-portrait-candidates"
import { PortraitCandidatesContext } from "./portrait-candidates-context"
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
import { getCharacter } from "@/lib/api"
import type { CharacterNodeData } from "@/types/nodes"

// Lazy dynamic import keeps this core file off the ee/ static-import graph
// (check-ee-imports.mjs only flags top-level `import ... from "@/ee/..."`,
// not `import()` call expressions — same pattern as router.tsx).
const PublishDialog = lazy(() => import("@/ee/components/community/publish-dialog"))

const ASSET_FIELD: Record<StudioAssetType, keyof CharacterNodeData> = {
  expressions: "expressions",
  poses: "poses",
  angles: "angles",
  bodyAngles: "bodyAngles",
  lighting: "lightingVariations",
  motions: "motions",
  boards: "boards",
}

// Boards refetch delay: the worker marks the job completed BEFORE the
// attach RPC lands, so a resolve-triggered refetch waits a beat.
const BOARD_REFETCH_DELAY_MS = 1500

/**
 * Meta-absent boards resolve (job seeded from a previous session's
 * pendingJobs, so the originating selection is gone): adopt the server's
 * boards array after the attach-write gap.
 *
 * Debounced on `timerRef` (clear-before-set: several resolves inside one
 * window collapse into ONE trailing refetch, which is correct because it
 * adopts the FULL fresh array) and guarded by `closedRef`. The guard is
 * load-bearing: React still runs a functional setState updater dispatched
 * after unmount, so without it a modal close during the delay/fetch would
 * run `patchWith` against the hook's FROZEN post-unmount `stagedRef`
 * (render-body assignment), mark `boards` dirty, and schedule a debounced
 * PATCH of the stale pre-completion array — a full-column replace that
 * ERASES the board the worker just attached. The worker's write is
 * authoritative; the next studio open refetches it anyway.
 *
 * Exported for tests — mounting CharacterStudioModal itself needs a
 * disproportionate harness (workflow store, auth, shell, portrait
 * candidates), so the branch is unit-tested directly
 * (see __tests__/board-refetch-adoption.test.ts).
 */
export function scheduleBoardsRefetchAdoption(opts: {
  dbId: string
  timerRef: { current: ReturnType<typeof setTimeout> | null }
  closedRef: { current: boolean }
  patchWith: CharacterStudioState["patchWith"]
}): void {
  const { dbId, timerRef, closedRef, patchWith } = opts
  if (timerRef.current) clearTimeout(timerRef.current)
  timerRef.current = setTimeout(() => {
    getCharacter(dbId)
      .then((fresh) => {
        if (closedRef.current) return
        patchWith(() => ({ boards: (fresh.boards ?? []) as CharacterNodeData["boards"] }))
      })
      .catch(() => { /* next studio open refetches anyway */ })
  }, BOARD_REFETCH_DELAY_MS)
}

export function CharacterStudioModal({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  const studio = useCharacterStudio(nodeId)
  const [errored, setErrored] = useState<Set<string>>(new Set())

  // Boards delayed-refetch lifecycle: the timer AND the in-flight fetch must
  // die with the modal (see scheduleBoardsRefetchAdoption — a post-unmount
  // patchWith silently erases the worker's DB write).
  const boardRefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closedRef = useRef(false)
  useEffect(() => {
    // Reset on mount: StrictMode (on in main.tsx) runs mount→cleanup→mount,
    // and without this the fake unmount would trip the guard for the whole
    // session, silently disabling boards adoption in dev.
    closedRef.current = false
    return () => {
      closedRef.current = true
      if (boardRefetchTimer.current) clearTimeout(boardRefetchTimer.current)
    }
  }, [])

  const onResolved = useCallback(
    (a: { assetType: StudioAssetType; name: string; url: string; meta?: Record<string, unknown> }) => {
      if (!studio) return
      if (a.assetType === "boards") {
        const sourceImages = Array.isArray(a.meta?.sourceImages)
          ? (a.meta.sourceImages as string[])
          : undefined
        if (sourceImages) {
          // Same-session completion: append the FULL identity entry locally
          // (instant UX). The worker attached the identical entry server-side;
          // URL-dedup + the debounced boards PATCH converge on one copy.
          studio.patchWith((prev) => {
            const arr = prev.boards ?? []
            if (arr.some((b) => b.url === a.url)) return {}
            return {
              boards: [...arr, { name: a.name, url: a.url, type: "identity" as const, sourceImages }],
            }
          })
        } else {
          // Reopened-mid-flight (seeded from pendingJobs): the originating
          // session's selection is gone. The worker attached the full entry —
          // adopt the server's array after the attach-write gap. Debounced +
          // unmount-guarded via the modal-owned refs (see the helper's doc).
          const dbId = studio.staged.characterDbId
          if (!dbId) return
          scheduleBoardsRefetchAdoption({
            dbId,
            timerRef: boardRefetchTimer,
            closedRef,
            patchWith: studio.patchWith,
          })
        }
        return
      }
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

  return <StudioModalBody studio={studio} jobs={jobs} errored={errored} onClose={onClose} />
}

/**
 * Modal body — mounted only once the studio state has loaded (non-null). Owning
 * the portrait candidate state HERE (not inside ProfilePage) is what makes
 * in-flight candidate spinners + their poll intervals survive Profile↔Appearance
 * page switches: those pages are separate mounts, but this body persists for the
 * whole modal session, so `usePortraitCandidates`'s cleanup fires on modal close
 * rather than on every navigation.
 */
function StudioModalBody({
  studio,
  jobs,
  errored,
  onClose,
}: {
  studio: CharacterStudioState
  jobs: CharacterStudioJobs
  errored: Set<string>
  onClose: () => void
}) {
  const { isAdmin } = useAuth()
  const [showPublish, setShowPublish] = useState(false)
  const portrait = usePortraitCandidates(studio)

  const counts = {
    expr: studio.staged.expressions.length,
    poses: studio.staged.poses.length,
    motions: studio.staged.motions.length,
  }

  return (
    <div className={`fixed inset-0 ${STUDIO_MODAL_Z} bg-[#0d1017] flex flex-col`}>
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
      <PortraitCandidatesContext.Provider value={portrait}>
        <StudioShell
          config={CHARACTER_STUDIO_NAV}
          state={studio}
          jobs={jobs}
          hasCredits={hasCredits()}
          defaultActiveKey="profile"
        />
      </PortraitCandidatesContext.Provider>
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
