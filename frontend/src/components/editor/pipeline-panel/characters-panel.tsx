import { useMemo, useRef, useState } from "react"
import { Upload, AlertTriangle, Loader2 } from "lucide-react"
import type { ShowrunnerPlan, PipelineMode } from "@nodaro/shared"
import { toast } from "sonner"
import { usePipelineEntities, type PipelineEntity } from "@/hooks/use-pipeline-entities"
import { pipelinesApi } from "@/lib/pipelines-api"
import { uploadImage } from "@/lib/api"
import { EntityGrid } from "./entity-grid"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface Props {
  pipelineId: string
  plan: ShowrunnerPlan | null
  /**
   * Phase 1D.2a §4.5 — only manual/guided modes get the wizard. Auto mode
   * bulk-flips `pending_description → pending` at stage start so this panel
   * never has rows to walk. Passed through so the fall-back EntityGrid can
   * hide its per-card Approve/Reject for auto runs.
   */
  mode?: PipelineMode | null
}

/**
 * Phase 3 (granular-pipeline-control) — Character Wizard Step A.
 *
 * Renders the sequential Step A walk when at least one character entity is
 * sitting at `status='pending_description'`. Once every entity has moved on
 * (`pending`, `approved`, `skipped`, etc.), the component falls back to the
 * existing EntityGrid so portrait review (Step B in Phase 4) keeps working.
 *
 * Mode contract:
 *  - manual / guided → wizard renders, user walks each entity
 *  - auto            → engine bulk-flips at stage start, so no rows ever
 *                      arrive here in `pending_description` and the
 *                      EntityGrid fall-back is used end-to-end
 */
export function CharactersPanel({ pipelineId, plan, mode }: Props) {
  const { data: entities, refetch } = usePipelineEntities(pipelineId, "character")

  // Stable sort by entity_key so the order matches the cast roster in `plan`,
  // not the DB row insertion timestamp. Cast order is the storyteller's order;
  // walking by `created_at` would put villains before heroes for some plans.
  const orderedEntities = useMemo<PipelineEntity[]>(() => {
    if (!entities) return []
    if (!plan) return entities
    const castOrder = new Map(plan.cast.map((c, idx) => [c.key, idx]))
    return [...entities].sort((a, b) => {
      const ai = castOrder.get(a.entity_key) ?? Number.MAX_SAFE_INTEGER
      const bi = castOrder.get(b.entity_key) ?? Number.MAX_SAFE_INTEGER
      return ai - bi
    })
  }, [entities, plan])

  const pendingDescription = useMemo(
    () => orderedEntities.filter((e) => e.status === "pending_description"),
    [orderedEntities],
  )

  // Wizard mounts ONLY when at least one entity is in the new state. Once the
  // user has walked them all, the existing EntityGrid takes over for Step B
  // review (portraits, critic findings, approve/reject) — which Phase 4 will
  // wire up further but already works for awaiting_approval rows today.
  if (pendingDescription.length === 0) {
    return (
      <EntityGrid
        pipelineId={pipelineId}
        entityType="character"
        title="2. Characters"
        mode={mode}
      />
    )
  }

  const approvedCount = orderedEntities.filter((e) => e.status === "approved").length
  const skippedCount = orderedEntities.filter((e) => e.status === "skipped").length
  const remainingCount = pendingDescription.length
  const totalCount = orderedEntities.length
  // The user always edits the FIRST pending_description entity (sequential
  // walk per spec line 70). When that one transitions, the next one slides
  // up into the top slot on the next refetch.
  const current = pendingDescription[0]

  return (
    <div className="mb-4" data-testid="characters-panel">
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-xs uppercase text-zinc-500 dark:text-zinc-400">
          2. Characters
        </div>
        <div className="text-[10px] uppercase tracking-wider text-sky-700 dark:text-sky-300 font-semibold">
          Step A · Description
        </div>
      </div>

      {/* Progress summary — one line, deliberately compact. */}
      <div className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        Character {approvedCount + skippedCount + 1} of {totalCount}
        {(approvedCount > 0 || skippedCount > 0) && (
          <span className="ml-1">
            ({approvedCount} approved
            {skippedCount > 0 && `, ${skippedCount} skipped`})
          </span>
        )}
      </div>

      <StepACard
        key={current.id}
        pipelineId={pipelineId}
        entity={current}
        plan={plan}
        onResolved={() => refetch()}
      />
    </div>
  )
}

/**
 * A 409 `entity_not_pending_description` means the entity already left the
 * pending_description state — almost always a duplicate submit: a slow
 * refetch, a stale read-replica re-showing the card, or an impatient
 * re-click after the first request already succeeded. The backend CAS guard
 * is idempotent by design (entity-description.ts), so from the user's point
 * of view the action is already done. Treat it as success — refresh and let
 * the wizard advance — instead of surfacing a scary error toast.
 */
function isAlreadyAdvanced(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes("entity_not_pending_description")
}

// ─── single-character card ──────────────────────────────────────────────────

interface StepACardProps {
  pipelineId: string
  entity: PipelineEntity
  plan: ShowrunnerPlan | null
  onResolved: () => void | Promise<unknown>
}

function StepACard({ pipelineId, entity, plan, onResolved }: StepACardProps) {
  const metadata = (entity.metadata ?? {}) as Record<string, unknown>
  const name = (metadata.name as string | undefined) ?? entity.entity_key
  const role = metadata.role as string | undefined
  const initialDescription = (metadata.visual_description as string | undefined) ?? ""

  const [description, setDescription] = useState(initialDescription)
  const [busy, setBusy] = useState<null | "approve" | "upload" | "skip">(null)
  const [skipConfirm, setSkipConfirm] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // D3 (granular-pipeline-control override) — the skip route doesn't block,
  // but the UI warns when this character is referenced by any scene's
  // cast_keys. Pure derivation from the loaded plan; no extra request.
  const sceneRefs = useMemo<number[]>(() => {
    if (!plan) return []
    const out: number[] = []
    for (const scene of plan.scenes) {
      if (scene.cast_keys?.includes(entity.entity_key)) {
        out.push(scene.scene_index)
      }
    }
    return out
  }, [plan, entity.entity_key])

  const isEdited = description.trim() !== initialDescription.trim()
  const canApprove = description.trim().length > 0

  async function handleApprove() {
    if (!canApprove) return
    setBusy("approve")
    try {
      const body = isEdited
        ? ({ mode: "user_edited", description: description.trim() } as const)
        : ({ mode: "llm" } as const)
      await pipelinesApi.approveDescription(pipelineId, entity.id, body)
      await onResolved()
    } catch (err) {
      if (isAlreadyAdvanced(err)) {
        // Duplicate submit — already approved. Refresh so the wizard
        // advances to the next character; no error to show the user.
        await onResolved()
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Couldn't approve description: ${msg}`)
      }
    } finally {
      setBusy(null)
    }
  }

  function pickFile() {
    fileInputRef.current?.click()
  }

  async function handleUpload(file: File) {
    setBusy("upload")
    try {
      const { url } = await uploadImage(file)
      await pipelinesApi.approveDescription(pipelineId, entity.id, {
        mode: "upload",
        asset_url: url,
        filename: file.name,
        mime_type: file.type || "image/jpeg",
        size_bytes: file.size,
      })
      await onResolved()
    } catch (err) {
      if (isAlreadyAdvanced(err)) {
        await onResolved()
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Upload failed: ${msg}`)
      }
    } finally {
      setBusy(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleSkip() {
    setBusy("skip")
    try {
      await pipelinesApi.skipEntity(pipelineId, entity.id)
      setSkipConfirm(false)
      await onResolved()
    } catch (err) {
      if (isAlreadyAdvanced(err)) {
        setSkipConfirm(false)
        await onResolved()
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        toast.error(`Couldn't skip character: ${msg}`)
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="rounded border border-sky-200 dark:border-sky-900 bg-white dark:bg-[#1E1E1E] p-3 flex flex-col gap-3"
      data-testid="step-a-card"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{name}</div>
          {role && (
            <div className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {role}
            </div>
          )}
        </div>
        <Badge
          variant="outline"
          className="shrink-0 bg-sky-50 border-sky-300 text-sky-800 dark:bg-sky-950 dark:border-sky-700 dark:text-sky-300"
        >
          pending description
        </Badge>
      </div>

      <div>
        <label className="text-xs text-zinc-500 dark:text-zinc-400 mb-1 block">
          Visual description
        </label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={5}
          className="text-sm resize-y min-h-[110px]"
          placeholder="Describe how this character should look in the portrait."
          disabled={busy !== null}
          data-testid="step-a-description"
        />
        <div className="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">
          {isEdited
            ? "Saving your edits — approve to generate the portrait."
            : "LLM-suggested description. Edit or approve as-is."}
        </div>
      </div>

      {/* D3 — skip warning. Inline, NOT blocking. Only shown when the user
          opens the skip confirmation; surfaces which scenes will lose the
          character so the user can make an informed choice. */}
      {skipConfirm && sceneRefs.length > 0 && (
        <div
          className="flex items-start gap-2 rounded border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950 p-2"
          data-testid="step-a-skip-warning"
        >
          <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800 dark:text-amber-200">
            <span className="font-medium">{name}</span> appears in{" "}
            {sceneRefs.length === 1 ? "scene" : "scenes"}{" "}
            {sceneRefs.join(", ")}. Skipping leaves those scenes without a
            character portrait reference.
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          onClick={handleApprove}
          disabled={!canApprove || busy !== null}
          data-testid="step-a-approve"
          className="bg-[#ff0073] hover:bg-[#ff0073]/90 text-white"
        >
          {busy === "approve" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
          {isEdited ? "Save & Approve" : "Approve"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={pickFile}
          disabled={busy !== null}
          data-testid="step-a-upload"
        >
          {busy === "upload" ? (
            <Loader2 className="w-3 h-3 mr-1 animate-spin" />
          ) : (
            <Upload className="w-3 h-3 mr-1" />
          )}
          Upload image
        </Button>
        {!skipConfirm ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              // No scene refs → skip directly; otherwise reveal warning + confirm.
              if (sceneRefs.length === 0) {
                void handleSkip()
              } else {
                setSkipConfirm(true)
              }
            }}
            disabled={busy !== null}
            data-testid="step-a-skip"
            className="text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            Skip
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSkipConfirm(false)}
              disabled={busy !== null}
              data-testid="step-a-skip-cancel"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleSkip}
              disabled={busy !== null}
              data-testid="step-a-skip-confirm"
              className={cn(
                "border-amber-300 text-amber-700 hover:bg-amber-50",
                "dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950",
              )}
            >
              {busy === "skip" && <Loader2 className="w-3 h-3 mr-1 animate-spin" />}
              Skip anyway
            </Button>
          </>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleUpload(f)
        }}
      />
    </div>
  )
}
