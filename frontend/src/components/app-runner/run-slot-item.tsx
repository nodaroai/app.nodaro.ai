import { useState, useCallback, useRef } from "react"
import { Trash2, Copy, Info, Pencil, Check, X } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { RunSlot } from "./types"
import { isMediaUrl } from "./types"

export function SlotStatusBadge({ status }: { status: RunSlot["executionStatus"] }) {
  const config: Record<string, { label: string; className: string }> = {
    idle: { label: "draft", className: "bg-muted text-muted-foreground" },
    running: { label: "running", className: "bg-blue-500/10 text-blue-500" },
    completed: { label: "done", className: "bg-emerald-500/10 text-emerald-500" },
    failed: { label: "failed", className: "bg-red-500/10 text-red-500" },
  }
  const c = config[status] ?? config.idle
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${c.className}`}>
      {c.label}
    </span>
  )
}

export function RunSlotItem({
  slot,
  isActive,
  hasMultipleVersions,
  onSelect,
  onDuplicate,
  onDelete,
  onRename,
}: {
  slot: RunSlot
  isActive: boolean
  hasMultipleVersions: boolean
  onSelect: () => void
  onDuplicate: () => void
  onDelete: () => void
  onRename: (name: string | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  const startEditing = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(slot.name ?? "")
    setEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [slot.name])

  const commitEdit = useCallback(() => {
    setEditing(false)
    const trimmed = editValue.trim()
    onRename(trimmed || null)
  }, [editValue, onRename])

  const cancelEdit = useCallback(() => {
    setEditing(false)
  }, [])

  const mediaType = slot.thumbnailUrl ? isMediaUrl(slot.thumbnailUrl) : null

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left px-3 py-2.5 border-b border-border/50 hover:bg-muted/50 transition-colors group ${
        isActive ? "bg-muted/80" : ""
      }`}
    >
      <div className="flex gap-2.5">
        {/* Thumbnail */}
        {slot.thumbnailUrl && mediaType && (
          <div className="w-10 h-10 rounded overflow-hidden shrink-0 bg-muted">
            {mediaType === "image" ? (
              <img src={slot.thumbnailUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <video src={slot.thumbnailUrl} className="w-full h-full object-cover" muted />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Name row */}
          {editing ? (
            <div className="flex items-center gap-1 mb-0.5" onClick={(e) => e.stopPropagation()}>
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit()
                  if (e.key === "Escape") cancelEdit()
                }}
                onBlur={commitEdit}
                className="text-xs bg-background border border-border rounded px-1.5 py-0.5 text-foreground w-full outline-none focus:border-[#ff0073]/50"
                placeholder="Run name..."
                maxLength={100}
              />
              <button type="button" onClick={commitEdit} className="p-0.5 hover:bg-muted rounded">
                <Check className="h-3 w-3 text-emerald-500" />
              </button>
              <button type="button" onClick={cancelEdit} className="p-0.5 hover:bg-muted rounded">
                <X className="h-3 w-3 text-muted-foreground" />
              </button>
            </div>
          ) : (
            slot.name && (
              <div className="flex items-center gap-1 mb-0.5">
                <span className="text-xs font-medium text-foreground truncate">{slot.name}</span>
                <button
                  type="button"
                  onClick={startEditing}
                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted rounded transition-all shrink-0"
                  title="Rename"
                >
                  <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                </button>
              </div>
            )
          )}

          {/* Time + status row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {new Date(slot.createdAt).toLocaleTimeString()}
              </span>
              {hasMultipleVersions && slot.version != null && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                  v{slot.version}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <SlotStatusBadge status={slot.executionStatus} />

              {/* Credits info */}
              {slot.creditsUsed > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all"
                    >
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="w-48 p-2.5">
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="opacity-70">Credits used</span>
                        <span className="font-medium">{slot.creditsUsed} CR</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-70">Status</span>
                        <span className="font-medium capitalize">{slot.executionStatus}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-70">Progress</span>
                        <span className="font-medium">{slot.completedNodes}/{slot.totalNodes} nodes</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="opacity-70">Created</span>
                        <span className="font-medium">{new Date(slot.createdAt).toLocaleString()}</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              )}

              {/* Rename (when no name yet) */}
              {!slot.name && !editing && (
                <button
                  type="button"
                  onClick={startEditing}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all"
                  title="Name this run"
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDuplicate()
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all"
                title="Duplicate"
              >
                <Copy className="h-3 w-3 text-muted-foreground" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-all"
                title="Delete"
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </button>
  )
}
