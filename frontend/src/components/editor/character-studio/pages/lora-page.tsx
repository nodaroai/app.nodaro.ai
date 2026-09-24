"use client"

/**
 * LoRA (high-fidelity model) page — Cloud edition only. Relocated + reworked
 * from the legacy `training-section.tsx` (which still lives in core for the
 * character-page-modal). Adds a curated training-image grid: every eligible
 * candidate thumbnail (the 7 buckets the backend's `collectTrainingImages`
 * aggregates) is shown and selectable. Selection is EPHEMERAL page-local state,
 * default ALL selected — unchecking excludes an image from training. The
 * "N / 4" count + min-4 gate reflect the SELECTION, and Start / Re-train send
 * exactly the selected URLs (`startCharacterTraining(id, selectedUrls)`); an
 * all-selected set behaves identically to the legacy "train on everything".
 *
 * Status (untrained/queued/training/succeeded/failed/cancelled), 8s polling,
 * trigger-word display, and Start / Re-train / Remove are ported from the legacy
 * section. LoRA status fields are worker-written and NOT in ALWAYS_PATCH_FIELDS,
 * so they are mirrored to the canvas summary via `updateNodeData` directly (NOT
 * `state.patch`, which would schedule a clobbering PATCH). Gated in the nav
 * config via `visible: (c) => c.hasCredits`; this component also no-ops on a
 * non-Cloud build as defence in depth.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { hasCredits } from "@/lib/edition"
import { CHARACTER_LORA_TRAINING_CREDITS } from "@/lib/pricing-data"
import {
  deleteCharacterLora,
  getCharacterTraining,
  startCharacterTraining,
  type TrainingStatus,
} from "@/lib/api"
import { tx, useT, type TFunction } from "@/lib/i18n"
import type { CharacterNodeData } from "@/types/nodes"
import type { StudioPageProps } from "../../studio-shell/types"
import type { CharacterStudioState } from "../use-character-studio"
import type { CharacterStudioJobs } from "../use-character-studio-jobs"
import { formatDate, formatNumber } from "@/lib/i18n/format"

const POLL_INTERVAL_MS = 8000
const MIN_PHOTOS = 4

interface TrainingCandidate {
  readonly url: string
  /** Bucket the image came from (for the grouping label). */
  readonly bucket: string
  /** Per-image label (e.g. "smile", "front"). */
  readonly label: string
}

/**
 * Mirror of backend `collectTrainingImages` bucket order + de-dup-by-URL —
 * MUST stay in sync with `backend/src/lib/character-lora.ts` so the page's
 * candidate set (and the "N / 4" count) matches what the route actually trains.
 * Returns the deduped candidate list (NOT capped at 20 here — the cap is the
 * backend's concern; the user sees every eligible image and the route slices).
 */
function deriveCandidates(data: CharacterNodeData | null, t: TFunction): TrainingCandidate[] {
  if (!data) return []
  const out: TrainingCandidate[] = []
  if (data.sourceImageUrl)
    out.push({ url: data.sourceImageUrl, bucket: t("inputcfg.source"), label: t("studio.sourceLower") })
  for (const r of data.referencePhotos ?? [])
    if (r.url) out.push({ url: r.url, bucket: t("studio.referencePhotosHeading"), label: r.kind ?? "ref" })
  for (const a of data.expressions ?? [])
    if (a.url) out.push({ url: a.url, bucket: t("studio.expressions"), label: a.name ?? "expr" })
  for (const a of data.poses ?? [])
    if (a.url) out.push({ url: a.url, bucket: t("node.assetBadgePoses"), label: a.name ?? "pose" })
  for (const a of data.angles ?? [])
    if (a.url) out.push({ url: a.url, bucket: t("studio.lbHeadAngles"), label: a.name ?? "angle" })
  for (const a of data.bodyAngles ?? [])
    if (a.url) out.push({ url: a.url, bucket: t("studio.lbBodyAngles"), label: a.name ?? "body" })
  for (const a of data.lightingVariations ?? [])
    if (a.url) out.push({ url: a.url, bucket: t("paramcfg.lighting"), label: a.name ?? "light" })

  const seen = new Set<string>()
  return out.filter((c) => {
    if (seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })
}

export function LoraPage({ state }: StudioPageProps<CharacterStudioState, CharacterStudioJobs>) {
  const t = useT()
  const trainingEnabled = hasCredits()
  const data = state.staged
  const characterNodeId = state.nodeId
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  const [training, setTraining] = useState<TrainingStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Bumped by handleStart/Re-train to RE-ARM the poll effect. Without this the
  // poll only self-perpetuates while the *fetched* status is queued/training;
  // on mount with an untrained character tick() fetches "untrained" and
  // schedules nothing, so a freshly-started training stayed on "Training…"
  // until the page was reopened.
  const [pollNonce, setPollNonce] = useState(0)

  // Candidate images (the 7 buckets, de-duped). Recomputed when staged changes.
  const candidates = useMemo(() => deriveCandidates(data, t), [data, t])

  // Ephemeral, page-local selection: which candidate URLs to include in training.
  // Default = ALL selected. Immutable toggles (always copy the Set, never mutate).
  const [excludedUrls, setExcludedUrls] = useState<ReadonlySet<string>>(new Set())

  // When the candidate set changes (e.g. a new pose generates while the page is
  // open), drop stale exclusions so removed images don't linger as "excluded".
  // New images default to selected (not in the excluded set) — matches "default
  // ALL selected". Only prune; never auto-exclude.
  useEffect(() => {
    setExcludedUrls((prev) => {
      if (prev.size === 0) return prev
      const valid = new Set<string>()
      for (const c of candidates) if (prev.has(c.url)) valid.add(c.url)
      return valid.size === prev.size ? prev : valid
    })
  }, [candidates])

  const selectedUrls = useMemo(
    () => candidates.filter((c) => !excludedUrls.has(c.url)).map((c) => c.url),
    [candidates, excludedUrls],
  )
  const selectedCount = selectedUrls.length

  const toggle = useCallback((url: string) => {
    setExcludedUrls((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }, [])

  const selectAll = useCallback(() => setExcludedUrls(new Set()), [])
  const clearAll = useCallback(
    () => setExcludedUrls(new Set(candidates.map((c) => c.url))),
    [candidates],
  )

  // Fetch + 8s-interval poll while in-flight (ported from training-section).
  // Only writes to the canvas summary on an actual status change.
  useEffect(() => {
    if (!trainingEnabled || !data?.characterDbId) return
    const characterId = data.characterDbId
    let cancelled = false
    const tick = async () => {
      try {
        const t = await getCharacterTraining(characterId)
        if (cancelled) return
        setTraining(t)
        const nextStatus = t.status === "untrained" ? null : t.status
        const currentNode = useWorkflowStore
          .getState()
          .nodes.find((n) => n.id === characterNodeId)
        const currentData = currentNode?.data as CharacterNodeData | undefined
        if (
          currentData?.loraTrainingStatus !== nextStatus ||
          currentData?.loraReplicateVersion !== t.version ||
          currentData?.loraTriggerWord !== t.triggerWord
        ) {
          updateNodeData(characterNodeId, {
            loraTrainingStatus: nextStatus,
            loraReplicateVersion: t.version,
            loraTriggerWord: t.triggerWord,
          })
        }
        if (t.status === "queued" || t.status === "training") {
          pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS)
        }
      } catch {
        if (!cancelled) pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS)
      }
    }
    tick()
    return () => {
      cancelled = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [trainingEnabled, data?.characterDbId, characterNodeId, updateNodeData, pollNonce])

  const handleStart = useCallback(async () => {
    if (!data?.characterDbId || busy) return
    setBusy(true)
    try {
      // Send the curated selection. When everything is selected this is the
      // full set — backend treats a full/empty selection identically.
      await startCharacterTraining(data.characterDbId, selectedUrls)
      toast.success(tx("studio.trainingStarted"))
      setTraining({
        status: "queued",
        trainingId: null,
        error: null,
        trainedAt: null,
        version: null,
        triggerWord: null,
        imageCount: selectedCount,
      })
      // Re-arm the status poll — the effect's other deps are stable, so without
      // this nothing would poll the just-queued training to completion.
      setPollNonce((n) => n + 1)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [data?.characterDbId, busy, selectedUrls, selectedCount])

  const handleRemove = useCallback(async () => {
    if (!data?.characterDbId || busy) return
    if (
      !window.confirm(
        tx("studio.confirmRemoveTrainedModel"),
      )
    )
      return
    setBusy(true)
    try {
      await deleteCharacterLora(data.characterDbId)
      toast.success(tx("studio.trainedModelRemoved"))
      setTraining({
        status: "untrained",
        trainingId: null,
        error: null,
        trainedAt: null,
        version: null,
        triggerWord: null,
        imageCount: null,
      })
      updateNodeData(characterNodeId, {
        loraTrainingStatus: null,
        loraReplicateVersion: null,
        loraTriggerWord: null,
      })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [data?.characterDbId, busy, characterNodeId, updateNodeData])

  if (!trainingEnabled) return null

  const status = training?.status ?? "untrained"
  const insufficientPhotos = selectedCount < MIN_PHOTOS
  const inFlight = status === "queued" || status === "training"

  // Group candidates by bucket for the grid headings (preserves bucket order).
  // Plain const (NOT a Hook) — this runs after the early return above, and it
  // only feeds the render `.map` below, so memoization isn't needed.
  const order: string[] = []
  const groupMap = new Map<string, TrainingCandidate[]>()
  for (const c of candidates) {
    if (!groupMap.has(c.bucket)) {
      groupMap.set(c.bucket, [])
      order.push(c.bucket)
    }
    groupMap.get(c.bucket)!.push(c)
  }
  const groups = order.map((bucket) => ({ bucket, items: groupMap.get(bucket)! }))

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* ── Status / actions header ─────────────────────────────────────── */}
      <section>
        <header className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-200">{t("studio.highFidelityModel")}</h3>
          <span className="text-[11px] text-slate-500">
            {t("studio.loraCostEta", { credits: formatNumber(CHARACTER_LORA_TRAINING_CREDITS) })}
          </span>
        </header>

        {status === "succeeded" && (
          <div className="flex items-center gap-3 text-sm flex-wrap">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-xs font-medium">
              {t("studio.trained")}
            </span>
            {training?.triggerWord && (
              <span className="text-[11px] text-slate-500 font-mono">
                {training.triggerWord}
              </span>
            )}
            <span className="text-slate-500 text-xs">
              {training?.trainedAt
                ? t("studio.trainedOn", { date: formatDate(training.trainedAt) })
                : ""}
            </span>
            <button
              type="button"
              className="text-xs underline text-slate-500 hover:text-slate-300 disabled:opacity-40"
              disabled={busy || insufficientPhotos}
              onClick={handleStart}
              title={t("studio.retrainTitle")}
            >
              {t("studio.retrain")}
            </button>
            <button
              type="button"
              className="text-xs underline text-slate-500 hover:text-red-400 ms-auto disabled:opacity-40"
              disabled={busy}
              onClick={handleRemove}
            >
              {t("common.remove")}
            </button>
          </div>
        )}

        {inFlight && (
          <div className="flex items-center gap-3 text-sm">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-500" />
            <span className="text-slate-400">{t("studio.trainingEta")}</span>
            <button
              type="button"
              className="text-xs underline text-slate-500 hover:text-red-400 ms-auto disabled:opacity-40"
              disabled={busy}
              onClick={handleRemove}
            >
              {t("common.cancel")}
            </button>
          </div>
        )}

        {status === "failed" && (
          <div className="flex flex-col gap-2 text-sm">
            <div className="text-red-400 text-xs">
              {t("studio.trainingFailedWith", { error: training?.error ?? t("lib.unknownError") })}
            </div>
            <button
              type="button"
              className="self-start text-xs underline text-slate-400 hover:text-slate-200 disabled:opacity-40"
              disabled={busy || insufficientPhotos}
              onClick={handleStart}
            >
              {t("common.tryAgain")}
            </button>
          </div>
        )}

        {(status === "untrained" || status === "cancelled") && (
          <div className="flex flex-col gap-2 text-sm">
            <p className="text-slate-500 text-xs">
              {t("studio.loraExplainer")}
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={handleStart}
                disabled={busy || insufficientPhotos}
                className="bg-[#ff0073] hover:bg-[#ff0073]/90 text-white text-xs font-medium"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  t("studio.trainHighFidelityModel")
                )}
              </Button>
              <span className="text-xs text-slate-500">
                {t("studio.nOfMaxSelectedSpaced", { n: selectedCount, max: MIN_PHOTOS })}
                {insufficientPhotos && ` — ${t("studio.selectAtLeastImages", { n: MIN_PHOTOS })}`}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ── Curated training-image grid ─────────────────────────────────── */}
      <section className="border-t border-[#1e293b] pt-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[9px] uppercase tracking-wide text-slate-500">
            {t("studio.trainingImages")}
          </div>
          {candidates.length > 0 && (
            <div className="flex items-center gap-3 text-[10px]">
              <span className="text-slate-500">
                {t("studio.nOfMaxSelectedSpaced", { n: selectedCount, max: candidates.length })}
              </span>
              <button
                type="button"
                className="underline text-slate-500 hover:text-slate-300 disabled:opacity-40"
                disabled={selectedCount === candidates.length}
                onClick={selectAll}
              >
                {t("studio.selectAll")}
              </button>
              <button
                type="button"
                className="underline text-slate-500 hover:text-slate-300 disabled:opacity-40"
                disabled={selectedCount === 0}
                onClick={clearAll}
              >
                {t("common.clear")}
              </button>
            </div>
          )}
        </div>

        {candidates.length === 0 ? (
          <p className="text-[11px] text-slate-500">
            {t("studio.noReferenceImagesYet")}
          </p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.bucket}>
                <div className="text-[10px] text-slate-500 mb-1">{group.bucket}</div>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-5 md:grid-cols-6">
                  {group.items.map((c) => {
                    const selected = !excludedUrls.has(c.url)
                    return (
                      <button
                        key={c.url}
                        type="button"
                        onClick={() => toggle(c.url)}
                        disabled={inFlight}
                        title={selected ? t("studio.labelIncluded", { label: c.label }) : t("studio.labelExcluded", { label: c.label })}
                        aria-pressed={selected}
                        className={`relative aspect-square overflow-hidden rounded border transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          selected
                            ? "border-[#3b82f6] ring-1 ring-[#3b82f6]/40"
                            : "border-[#334155] opacity-50 hover:opacity-75"
                        }`}
                      >
                        <CachedImage
                          src={c.url}
                          alt={c.label}
                          className="h-full w-full object-cover"
                          thumbnail
                        />
                        <span
                          className={`absolute top-0.5 end-0.5 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold ${
                            selected
                              ? "bg-[#3b82f6] text-white"
                              : "bg-[#0d1017]/80 text-slate-500 border border-[#334155]"
                          }`}
                        >
                          {selected ? "✓" : ""}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
