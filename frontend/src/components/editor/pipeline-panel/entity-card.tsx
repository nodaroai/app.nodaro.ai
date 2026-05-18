import type { EntityStatus } from "@nodaro/shared"
import type { PipelineEntity } from "@/hooks/use-pipeline-entities"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface Props {
  entity: PipelineEntity
  onApprove: () => void
  onReject: () => void
  disabled?: boolean
}

// Same status-pill table as scene-card.tsx — kept in lock-step.
const STATUS_PILL_COLORS: Record<EntityStatus, string> = {
  pending: "bg-zinc-100 text-zinc-700",
  generating: "bg-amber-100 text-amber-800",
  awaiting_approval: "bg-blue-100 text-blue-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  failed: "bg-red-100 text-red-800",
}

export function EntityCard({ entity, onApprove, onReject, disabled }: Props) {
  const status = entity.status
  const name = String(
    (entity.metadata as Record<string, unknown> | null)?.name ?? entity.entity_key,
  )

  return (
    <div className="rounded border border-zinc-200 bg-white p-2 flex flex-col gap-2">
      <div className="aspect-square bg-zinc-100 overflow-hidden rounded relative">
        {entity.main_asset_url ? (
          <img
            src={entity.main_asset_url}
            alt={name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-500">
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
              className="aspect-square bg-zinc-100 overflow-hidden rounded"
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
      {status === "awaiting_approval" && (
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
    </div>
  )
}
