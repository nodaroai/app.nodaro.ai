"use client"

/**
 * High-fidelity model (Character LoRA training) section, rendered inside the
 * Character page modal's Main tab. Self-contained: owns its own polling, busy
 * state, image-count derivation, and mutation handlers. Writes back to the
 * canvas character node via `updateNodeData` so the badge + payload-builder
 * see fresh state.
 *
 * Cloud edition only. Renders nothing when `hasCredits()` is false.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { hasCredits } from "@/lib/edition"
import {
  deleteCharacterLora,
  getCharacterTraining,
  startCharacterTraining,
  type TrainingStatus,
} from "@/lib/api"
import type { CharacterNodeData } from "@/types/nodes"

interface TrainingSectionProps {
  readonly characterNodeId: string
  readonly data: CharacterNodeData | null
}

const POLL_INTERVAL_MS = 8000
const MIN_PHOTOS = 4

export function TrainingSection({ characterNodeId, data }: TrainingSectionProps) {
  const trainingEnabled = hasCredits()
  const [training, setTraining] = useState<TrainingStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)

  // Mirror of backend `collectTrainingImages` — must include the same 7
  // buckets or the "N / 4 photos" gate disagrees with the route's actual
  // count. Keep in sync with backend/src/lib/character-lora.ts.
  const trainingImageCount = useMemo(() => {
    if (!data) return 0
    const urls = new Set<string>()
    if (data.sourceImageUrl) urls.add(data.sourceImageUrl)
    for (const r of data.referencePhotos ?? []) if (r.url) urls.add(r.url)
    for (const a of data.expressions ?? []) if (a.url) urls.add(a.url)
    for (const a of data.poses ?? []) if (a.url) urls.add(a.url)
    for (const a of data.angles ?? []) if (a.url) urls.add(a.url)
    for (const a of data.bodyAngles ?? []) if (a.url) urls.add(a.url)
    for (const a of data.lightingVariations ?? []) if (a.url) urls.add(a.url)
    return urls.size
  }, [data])

  // Fetch + 8s-interval poll while in-flight. Polling-primary live updates
  // per design §6.5 (Realtime would require a separate migration to publish
  // `characters` on supabase_realtime).
  useEffect(() => {
    if (!trainingEnabled || !data?.characterDbId) return
    const characterId = data.characterDbId
    let cancelled = false
    const tick = async () => {
      try {
        const t = await getCharacterTraining(characterId)
        if (cancelled) return
        setTraining(t)
        // Only write to canvas when something actually changed — polling for
        // ~15 min would otherwise produce ~112 noisy updateNodeData calls.
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
        // Network blip — retry once after the same interval.
        if (!cancelled) pollTimerRef.current = setTimeout(tick, POLL_INTERVAL_MS)
      }
    }
    tick()
    return () => {
      cancelled = true
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    }
  }, [trainingEnabled, data?.characterDbId, characterNodeId, updateNodeData])

  const handleStart = useCallback(async () => {
    if (!data?.characterDbId || busy) return
    setBusy(true)
    try {
      await startCharacterTraining(data.characterDbId)
      toast.success("Training started — usually takes 15 minutes.")
      setTraining({
        status: "queued",
        trainingId: null,
        error: null,
        trainedAt: null,
        version: null,
        triggerWord: null,
        imageCount: trainingImageCount,
      })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [data?.characterDbId, busy, trainingImageCount])

  const handleRemove = useCallback(async () => {
    if (!data?.characterDbId || busy) return
    if (
      !window.confirm(
        "Remove the trained model? Generations will fall back to reference images.",
      )
    )
      return
    setBusy(true)
    try {
      await deleteCharacterLora(data.characterDbId)
      toast.success("Trained model removed.")
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
  const insufficientPhotos = trainingImageCount < MIN_PHOTOS

  return (
    <section className="mb-6 border-t border-[#2D2D2D] pt-4">
      <header className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold">High-fidelity model</h3>
        <span className="text-[11px] text-muted-foreground">150 credits · ~15 min</span>
      </header>

      {status === "succeeded" && (
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-medium">
            Trained
          </span>
          <span className="text-muted-foreground text-xs">
            {training?.trainedAt
              ? `Trained ${new Date(training.trainedAt).toLocaleDateString()}`
              : ""}
          </span>
          <button
            type="button"
            className="text-xs underline text-muted-foreground hover:text-foreground disabled:opacity-40"
            disabled={busy || insufficientPhotos}
            onClick={handleStart}
            title="Re-training replaces the current model."
          >
            Re-train
          </button>
          <button
            type="button"
            className="text-xs underline text-muted-foreground hover:text-red-500 ml-auto disabled:opacity-40"
            disabled={busy}
            onClick={handleRemove}
          >
            Remove
          </button>
        </div>
      )}

      {(status === "queued" || status === "training") && (
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Training… (~15 min)</span>
          <button
            type="button"
            className="text-xs underline text-muted-foreground hover:text-red-500 ml-auto disabled:opacity-40"
            disabled={busy}
            onClick={handleRemove}
          >
            Cancel
          </button>
        </div>
      )}

      {status === "failed" && (
        <div className="flex flex-col gap-2 text-sm">
          <div className="text-red-500 text-xs">
            Training failed: {training?.error ?? "Unknown error"}
          </div>
          <button
            type="button"
            className="self-start text-xs underline hover:text-foreground disabled:opacity-40"
            disabled={busy || insufficientPhotos}
            onClick={handleStart}
          >
            Try again
          </button>
        </div>
      )}

      {(status === "untrained" || status === "cancelled") && (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-muted-foreground text-xs">
            Train a custom model on this character's references for the
            highest-fidelity identity match in image generations.
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
                "Train high-fidelity model"
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {trainingImageCount} / {MIN_PHOTOS} photos
              {insufficientPhotos && " — add more references first"}
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
