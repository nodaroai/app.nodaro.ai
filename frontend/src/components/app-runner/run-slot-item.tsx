import { useState, useCallback, useRef } from "react"
import { Trash2, Copy, Info, Pencil, Check, X } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { RunSlot } from "./types"
import { ORIGINAL_SLOT_ID, isMediaUrl } from "./types"

function StatusDot({ status }: { status: RunSlot["executionStatus"] }) {
  const colors: Record<string, string> = {
    idle: "bg-muted-foreground/40",
    running: "bg-blue-500",
    completed: "bg-emerald-500",
    failed: "bg-red-500",
  }
  return <span className={`w-2 h-2 rounded-full shrink-0 ${colors[status] ?? colors.idle}`} />
}

export function SlotStatusBadge({ status }: { status: RunSlot["executionStatus"] }) {
  const config: Record<string, { label: string; className: string }> = {
    idle: { label: "draft", className: "bg-muted text-muted-foreground" },
    running: { label: "running", className: "bg-blue-500/10 text-blue-500" },
    completed: { label: "done", className: "bg-emerald-500/10 text-emerald-500" },
    failed: { label: "failed", className: "bg-red-500/10 text-red-500" },
  }
  const c = config[status] ?? config.idle
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${c.className}`}>
      {c.label}
    </span>
  )
}

/** Compact slot for collapsed sidebar — thumbnail + status dot */
export function CompactSlotItem({
  slot,
  isActive,
  onSelect,
}: {
  slot: RunSlot
  isActive: boolean
  onSelect: () => void
}) {
  const mediaType = slot.thumbnailUrl ? isMediaUrl(slot.thumbnailUrl) : null

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          onClick={onSelect}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect() }}
          className={`w-full py-2 px-1.5 border-b border-border/50 border-l-2 flex flex-col items-center gap-1 cursor-pointer hover:bg-muted/50 transition-colors ${
            isActive ? "bg-muted/80 border-l-[#ff0073]" : "border-l-transparent"
          }`}
        >
          {slot.thumbnailUrl && mediaType ? (
            <div className="w-11 h-11 rounded overflow-hidden bg-muted shrink-0">
              {mediaType === "image" ? (
                <img src={slot.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <video src={slot.thumbnailUrl} className="w-full h-full object-cover" muted />
              )}
            </div>
          ) : (
            <div className="w-11 h-11 rounded bg-muted/50 flex items-center justify-center">
              <StatusDot status={slot.executionStatus} />
            </div>
          )}
          <span className="text-[9px] text-muted-foreground truncate max-w-full px-0.5 text-center leading-tight">
            {slot.name ?? new Date(slot.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="text-xs">
        <div>{slot.name ?? new Date(slot.createdAt).toLocaleTimeString()}</div>
        <div className="text-muted-foreground capitalize">{slot.executionStatus === "idle" ? "draft" : slot.executionStatus}</div>
      </TooltipContent>
    </Tooltip>
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
  const isOriginal = slot.id === ORIGINAL_SLOT_ID
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
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSelect() }}
      className={`w-full text-left px-3 py-2.5 border-b border-border/50 border-l-2 hover:bg-muted/50 transition-colors group cursor-pointer ${
        isActive ? "bg-muted/80 border-l-[#ff0073]" : "border-l-transparent"
      }`}
    >
      <div className="flex gap-2.5">
        {/* Thumbnail */}
        {slot.thumbnailUrl && mediaType && (
          <div className="w-10 h-10 rounded overflow-hidden shrink-0 bg-muted self-center">
            {mediaType === "image" ? (
              <img src={slot.thumbnailUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <video src={slot.thumbnailUrl} className="w-full h-full object-cover" muted />
            )}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Row 1: Name/time + status badge (always aligned) */}
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1 min-w-0 flex-1">
              {editing && !isOriginal ? (
                <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
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
                  <span role="button" tabIndex={0} onClick={commitEdit} onKeyDown={(e) => { if (e.key === "Enter") commitEdit() }} className="p-0.5 hover:bg-muted rounded cursor-pointer">
                    <Check className="h-3 w-3 text-emerald-500" />
                  </span>
                  <span role="button" tabIndex={0} onClick={cancelEdit} onKeyDown={(e) => { if (e.key === "Enter") cancelEdit() }} className="p-0.5 hover:bg-muted rounded cursor-pointer">
                    <X className="h-3 w-3 text-muted-foreground" />
                  </span>
                </div>
              ) : (
                <>
                  <span className="text-xs font-medium text-foreground truncate">
                    {slot.name ?? new Date(slot.createdAt).toLocaleTimeString()}
                  </span>
                  {!isOriginal && slot.name && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={startEditing}
                      onKeyDown={(e) => { if (e.key === "Enter") startEditing(e as unknown as React.MouseEvent) }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-muted rounded transition-all shrink-0 cursor-pointer"
                      title="Rename"
                    >
                      <Pencil className="h-2.5 w-2.5 text-muted-foreground" />
                    </span>
                  )}
                </>
              )}
            </div>
            <SlotStatusBadge status={slot.executionStatus} />
          </div>

          {/* Row 2: Time (when name exists) + actions */}
          <div className="flex items-center justify-between mt-0.5">
            <div className="flex items-center gap-1.5">
              {slot.name && (
                <span className="text-[11px] text-muted-foreground">
                  {new Date(slot.createdAt).toLocaleTimeString()}
                </span>
              )}
              {hasMultipleVersions && slot.version != null && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                  v{slot.version}
                </span>
              )}
            </div>
            <div className="flex items-center gap-0.5">
              {/* Credits info */}
              {slot.creditsUsed > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => e.stopPropagation()}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all cursor-pointer"
                    >
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </span>
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

              {/* Rename (when no name yet) — hidden for Original */}
              {!isOriginal && !slot.name && !editing && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={startEditing}
                  onKeyDown={(e) => { if (e.key === "Enter") startEditing(e as unknown as React.MouseEvent) }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all cursor-pointer"
                  title="Name this run"
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </span>
              )}

              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  onDuplicate()
                }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDuplicate() } }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-muted rounded transition-all cursor-pointer"
                title="Duplicate"
              >
                <Copy className="h-3 w-3 text-muted-foreground" />
              </span>
              {/* Delete — hidden for Original */}
              {!isOriginal && (
                <span
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete()
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDelete() } }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:bg-destructive/10 rounded transition-all cursor-pointer"
                  title="Delete"
                >
                  <Trash2 className="h-3 w-3 text-destructive" />
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
