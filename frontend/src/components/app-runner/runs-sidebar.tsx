import { useEffect, useRef } from "react"
import { Plus, ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { RunSlot } from "./types"
import { RunSlotItem } from "./run-slot-item"

export function RunsSidebar({
  slots,
  activeSlotId,
  onSelectSlot,
  onCreateNew,
  onDuplicateSlot,
  onDeleteSlot,
  onRenameSlot,
  onClose,
  versions,
  selectedVersion,
  onSelectVersion,
  latestVersion,
}: {
  slots: RunSlot[]
  activeSlotId: string | null
  onSelectSlot: (slotId: string) => void
  onCreateNew: () => void
  onDuplicateSlot: (slotId: string) => void
  onDeleteSlot: (slotId: string) => void
  onRenameSlot: (slotId: string, name: string | null) => void
  onClose: () => void
  versions: { version: number; id: string; createdAt: string }[]
  selectedVersion: number | null
  onSelectVersion: (version: number | null) => void
  latestVersion: number
}) {
  const hasMultipleVersions = versions.length > 1
  const sidebarRef = useRef<HTMLDivElement>(null)

  // Arrow key navigation
  useEffect(() => {
    const el = sidebarRef.current
    if (!el) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
      if (slots.length === 0) return

      e.preventDefault()
      const currentIndex = activeSlotId ? slots.findIndex((s) => s.id === activeSlotId) : -1

      let nextIndex: number
      if (e.key === "ArrowDown") {
        nextIndex = currentIndex < slots.length - 1 ? currentIndex + 1 : 0
      } else {
        nextIndex = currentIndex > 0 ? currentIndex - 1 : slots.length - 1
      }

      onSelectSlot(slots[nextIndex].id)
    }

    el.addEventListener("keydown", handleKeyDown)
    return () => el.removeEventListener("keydown", handleKeyDown)
  }, [slots, activeSlotId, onSelectSlot])

  return (
    <div
      ref={sidebarRef}
      tabIndex={-1}
      className="w-full sm:w-72 h-full border-r border-border bg-card flex flex-col shrink-0 outline-none"
    >
      <div className="flex items-center justify-between px-4 h-14 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Runs</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onCreateNew} title="New run">
            <Plus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} title="Close">
            <ChevronLeft className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Version selector — only shown when multiple versions exist */}
      {hasMultipleVersions && (
        <div className="px-4 py-2 border-b border-border/50">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
            Run on version
          </label>
          <select
            value={selectedVersion ?? ""}
            onChange={(e) => {
              const v = e.target.value
              onSelectVersion(v ? Number(v) : null)
            }}
            className="w-full text-xs bg-background border border-border rounded px-2 py-1.5 text-foreground"
          >
            <option value="">Latest (v{latestVersion})</option>
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}{v.version === latestVersion ? " (latest)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {slots.map((slot) => (
          <RunSlotItem
            key={slot.id}
            slot={slot}
            isActive={activeSlotId === slot.id}
            hasMultipleVersions={hasMultipleVersions}
            onSelect={() => onSelectSlot(slot.id)}
            onDuplicate={() => onDuplicateSlot(slot.id)}
            onDelete={() => onDeleteSlot(slot.id)}
            onRename={(name) => onRenameSlot(slot.id, name)}
          />
        ))}
        {slots.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            Click + to create a new run
          </div>
        )}
      </div>
    </div>
  )
}
