"use client"
import { useState, useRef, useEffect } from "react"
import type { ReactNode } from "react"
import { useStore, useNodeId } from "@xyflow/react"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"
import { NODE_TITLE_TYPOGRAPHY } from "@/lib/node-title-style"
import { useWorkflowStore } from "@/hooks/use-workflow-store"

interface EditableNodeLabelProps {
  label: string
  icon: ReactNode
  onSave: (newLabel: string) => void
  /** Optional override for the icon click. When omitted, the icon opens this
   *  node's config in fullscreen — the default for EVERY node, so individual
   *  node files don't each have to wire it (drift-proof single source). */
  onIconClick?: () => void
}

export function EditableNodeLabel({ label, icon, onSave, onIconClick }: EditableNodeLabelProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)
  // Compensate React Flow's canvas scale when we drop below the floor. The
  // label is rendered inside the node, which is already CSS-scaled by RF
  // (`visual = DOM × zoom`). When `zoom < MIN_SCALE`, we apply an additional
  // `scale(MIN_SCALE / zoom)` so the net visual size stays at the floor.
  const zoom = useStore((s) => s.transform[2])
  const compensateScale = Math.max(1, NODE_VISUAL_SCALE_FLOOR / Math.max(zoom, 0.01))

  // Default icon-click behavior: open THIS node's settings in fullscreen.
  // `useNodeId()` reads the id from React Flow's NodeIdContext (every custom
  // node renders inside it), so we don't need each of the ~110 node files to
  // thread an `onIconClick` prop — clicking any node's icon opens fullscreen.
  const nodeId = useNodeId()
  const openFullscreenSettings = useWorkflowStore((s) => s.openFullscreenSettings)
  const handleIconClick = () => {
    if (onIconClick) onIconClick()
    else if (nodeId) openFullscreenSettings(nodeId)
  }

  useEffect(() => { setValue(label) }, [label])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  function handleBlur() {
    setEditing(false)
    if (value.trim() && value !== label) onSave(value.trim())
    else setValue(label)
  }

  return (
    <div
      className={`absolute -top-6 left-1 flex items-center gap-2 text-[11px] ${NODE_TITLE_TYPOGRAPHY} text-foreground/70 dark:text-white/70 ${editing ? "nopan nodrag nowheel" : "select-none"}`}
      style={{ transform: `scale(${compensateScale})`, transformOrigin: "0 100%" }}
    >
      <button
        type="button"
        // The button TIGHT-WRAPS the glyph (no fixed `w-6 h-6` box): with a
        // fixed box, glyphs of different widths were centered inside it, so a
        // narrow icon (e.g. layers) floated with extra space on both sides —
        // making its distance-from-left and its gap-to-label visibly differ
        // from a wide icon (e.g. image). Wrapping the 16px glyph directly
        // makes the left offset (`left-2`) and the `gap-2` to the label
        // uniform across every node, determined only by the normalized
        // lucide glyph. `[&>svg]:size-4` is still the single source of truth
        // for the 16px glyph size, overriding any per-node `w-3.5`/bare size.
        className="nopan nodrag inline-flex items-center justify-center [&>svg]:size-4 transition-colors hover:text-[#ff0073] cursor-pointer"
        onClick={(e) => { e.stopPropagation(); handleIconClick() }}
        onMouseDown={(e) => e.stopPropagation()}
        title="Open settings"
      >
        {icon}
      </button>
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onMouseDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter") inputRef.current?.blur()
            if (e.key === "Escape") { setValue(label); setEditing(false) }
          }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white border border-border rounded-md px-2 py-0.5 text-foreground outline-none min-w-[8rem] max-w-[20rem] text-[11px] normal-case tracking-normal focus:ring-1 focus:ring-[#ff0073]/40 focus:border-[#ff0073] dark:bg-zinc-900 dark:border-white/20 dark:text-white/90"
          style={{ width: `${Math.max(8, value.length * 0.65 + 2)}ch` }}
        />
      ) : (
        <span
          className="truncate cursor-text hover:text-[#ff0073] transition-colors"
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}
          onMouseDown={(e) => e.stopPropagation()}
          title="Click to rename"
        >
          {label}
        </span>
      )}
    </div>
  )
}
