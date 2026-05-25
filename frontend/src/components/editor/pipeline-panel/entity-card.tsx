import { useMutation } from "@tanstack/react-query"
import type {
  CharacterImageCriticVerdict,
  EntityStatus,
  PipelineMode,
} from "@nodaro/shared"
import { IMAGE_CRITIC_UNRESOLVABLE } from "@nodaro/shared"
import type { PipelineEntity } from "@/hooks/use-pipeline-entities"
import { pipelinesApi } from "@/lib/pipelines-api"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Props {
  entity: PipelineEntity
  /**
   * Phase 1D.2c-a §7 (E1) follow-up — the recovery surface
   * (Skip/Regenerate) makes specialized POSTs to /force-approve-image-critic-failure
   * and /retry-image-generation; it needs the parent pipeline id directly
   * instead of routing through the generic onApprove/onReject callbacks
   * (which CAS-gate on status='awaiting_approval' server-side and would
   * 409 here).
   */
  pipelineId: string
  onApprove: () => void
  onReject: () => void
  /**
   * Phase 1D.2c-a §7 (E1) follow-up — called after a successful Skip or
   * Regenerate so the parent EntityGrid can refetch the entity list. The
   * recovery POSTs don't return the new entity row, so the parent owns the
   * cache-invalidation step.
   */
  onRecovered?: () => void
  disabled?: boolean
  /**
   * Phase 1D.2a §4.5 — in auto mode the orchestrator bulk-approves entities
   * once the per-stage critic chain accepts the batch, so the per-card
   * Approve/Reject controls are hidden. Optional; undefined keeps the
   * existing manual behavior.
   */
  mode?: PipelineMode | null
}

// Same status-pill table as scene-card.tsx — kept in lock-step.
const STATUS_PILL_COLORS: Record<EntityStatus, string> = {
  pending: "bg-zinc-100 text-zinc-700 dark:bg-[#2D2D2D] dark:text-zinc-300",
  // Phase 3 — Step A is awaiting the user's description-approval click; cyan
  // differentiates from `awaiting_approval` (post-generation review) blue.
  pending_description: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  generating: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  awaiting_approval: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300",
  rejected: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  // Phase 3 — terminal "user opted out"; muted so it visually recedes.
  skipped: "bg-zinc-100 text-zinc-500 dark:bg-zinc-900 dark:text-zinc-500",
}

/**
 * Phase 1D.2c-a §7 (E1) — shape of one critic issue, as written by the Stage
 * 2 / Stage 4 image-critic chain into `pipeline_entities.metadata.critic_findings`.
 * Derived from `CharacterImageCriticVerdictSchema.issues[*]`; the Location
 * verdict shares the same shape modulo the `category` enum — both inferred
 * types render the same way in the UI.
 */
type CriticFinding = CharacterImageCriticVerdict["issues"][number]

interface CriticState {
  findings: CriticFinding[] | undefined
  isFailed: boolean
  displayUrl: string | undefined
}

/**
 * Pure helper — derives the critic-related surface state from the metadata
 * blob written by the Stage 2/4 image-critic chain.
 *
 * The chain writes:
 *   metadata.last_error = IMAGE_CRITIC_UNRESOLVABLE  (on terminal fail)
 *   metadata.last_attempted_image_url = <URL of the FAILED image>
 *   metadata.critic_findings = [...issues]  (also written on success retries
 *     when the critic flagged warnings that the next attempt addressed)
 *
 * On terminal fail we surface the FAILED image (the main_asset_url may be
 * null because the cap-exhausted run never committed). On success paths we
 * keep the existing main-asset preview.
 */
function readCriticState(
  metadata: Record<string, unknown> | null,
  mainAssetUrl: string | undefined,
): CriticState {
  const findings = Array.isArray(metadata?.critic_findings)
    ? (metadata?.critic_findings as CriticFinding[])
    : undefined
  const lastError =
    typeof metadata?.last_error === "string" ? metadata?.last_error : undefined
  const lastAttemptedUrl =
    typeof metadata?.last_attempted_image_url === "string"
      ? metadata?.last_attempted_image_url
      : undefined
  const isFailed = lastError === IMAGE_CRITIC_UNRESOLVABLE
  const displayUrl = isFailed ? lastAttemptedUrl ?? mainAssetUrl : mainAssetUrl
  return { findings, isFailed, displayUrl }
}

export function EntityCard({
  entity,
  pipelineId,
  onApprove,
  onReject,
  onRecovered,
  disabled,
  mode,
}: Props) {
  const status = entity.status
  const metadata = entity.metadata as Record<string, unknown> | null
  const name = String(metadata?.name ?? entity.entity_key)

  // Recovery POSTs go through React Query mutations — `isPending` blocks a
  // double-click, the mutations surface their loading state directly, and
  // the pattern matches sibling `mode-switch-button.tsx`. The parent owns
  // the entity-list cache invalidation via `onRecovered`.
  const skipMutation = useMutation({
    mutationFn: () =>
      pipelinesApi.forceApproveImageCriticFailure(pipelineId, entity.id),
    onSuccess: () => onRecovered?.(),
  })
  const regenerateMutation = useMutation({
    mutationFn: () => pipelinesApi.retryImageGeneration(pipelineId, entity.id),
    onSuccess: () => onRecovered?.(),
  })
  const recovering = skipMutation.isPending || regenerateMutation.isPending

  // Phase 1D.2c-a §7 — image-critic surface.
  const { findings, isFailed, displayUrl } = readCriticState(
    metadata,
    entity.main_asset_url ?? undefined,
  )

  return (
    <div className="rounded border border-zinc-200 dark:border-[#2D2D2D] bg-white dark:bg-[#1E1E1E] p-2 flex flex-col gap-2">
      <div className="aspect-square bg-zinc-100 dark:bg-[#2D2D2D] overflow-hidden rounded relative">
        {displayUrl ? (
          <img
            src={displayUrl}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500 dark:text-zinc-400">
            {status === "generating" ? "Generating..." : "—"}
          </div>
        )}
        <div
          className={cn(
            "absolute top-1 right-1 text-xs px-1.5 py-0.5 rounded",
            STATUS_PILL_COLORS[status],
          )}
        >
          {status}
        </div>
      </div>
      <div className="text-sm font-medium truncate">{name}</div>
      {entity.variants.length > 0 && (
        <div className="grid grid-cols-3 gap-1">
          {entity.variants.slice(0, 6).map((v) => (
            <div
              key={v.variant_key}
              className="aspect-square bg-zinc-100 dark:bg-[#2D2D2D] overflow-hidden rounded"
              title={v.variant_key}
            >
              {v.asset_url ? (
                <img
                  src={v.asset_url}
                  alt={v.variant_key}
                  className="w-full h-full object-cover"
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
      {/* Phase 1D.2c-a §7 — critic findings list. Rendered whenever non-empty,
       * regardless of status. Red tint when the image-critic terminally failed
       * (so the warnings read as the blocking reason); muted zinc otherwise
       * (informational warnings the user can accept and move on from). */}
      {findings && findings.length > 0 && (
        <ul
          data-testid="critic-findings"
          className={cn(
            "text-xs space-y-1",
            isFailed
              ? "text-red-700 dark:text-red-300"
              : "text-zinc-600 dark:text-zinc-300",
          )}
        >
          {findings.map((f, i) => (
            <li key={i}>
              <span className="font-semibold">{f.category}:</span> {f.description}
              {f.suggested_fix && (
                <div className="ml-3 text-zinc-500 dark:text-zinc-400">
                  Try: {f.suggested_fix}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {status === "awaiting_approval" && mode !== "auto" && (
        <div className="flex gap-1">
          <Button size="sm" onClick={onApprove} disabled={disabled} className="flex-1">
            Approve
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={onReject}
            disabled={disabled}
            className="flex-1"
          >
            Reject
          </Button>
        </div>
      )}
      {/* Phase 1D.2c-a §7 — image-critic recovery buttons. Visible ONLY when
       * the image-critic chain terminally failed AND we're not in auto mode
       * (auto-mode pipelines are already on the failure path; surfacing
       * recovery here would race the orchestrator's own gating). These call
       * the dedicated POST routes directly (force-approve-image-critic-failure
       * / retry-image-generation) — the general approveEntity/rejectEntity
       * routes can't handle this case because they CAS-gate on
       * status='awaiting_approval' server-side. */}
      {isFailed && mode !== "auto" && (
        <div className="flex gap-1">
          <Button
            size="sm"
            onClick={() => skipMutation.mutate()}
            disabled={disabled || recovering}
            className="flex-1"
          >
            {skipMutation.isPending ? "Skipping…" : "Skip"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => regenerateMutation.mutate()}
            disabled={disabled || recovering}
            className="flex-1"
          >
            {regenerateMutation.isPending ? "Regenerating…" : "Regenerate"}
          </Button>
        </div>
      )}
    </div>
  )
}
