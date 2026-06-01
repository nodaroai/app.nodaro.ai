"use client"
import { useState, useRef, useEffect } from "react"
import type { ReactNode } from "react"
import { useStore } from "@xyflow/react"
import { NODE_VISUAL_SCALE_FLOOR } from "@/lib/zoom-floor"

interface EditableNodeLabelProps {
  label: string
  icon: ReactNode
  onSave: (newLabel: string) => void
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

  useEffect(() => { setValue(label) }, [label])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  function handleBlur() {
    setEditing(false)
    if (value.trim() && value !== label) onSave(value.trim())
    else setValue(label)
  }

  return (
    <div
      className={`absolute -top-6 left-0 flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 dark:text-white/70 ${editing ? "nopan nodrag nowheel" : "select-none"}`}
      style={{ transform: `scale(${compensateScale})`, transformOrigin: "0 100%" }}
    >
      <button
        type="button"
        className="nopan nodrag flex items-center transition-colors hover:text-[#ff0073] cursor-pointer"
        onClick={(e) => { e.stopPropagation(); onIconClick?.() }}
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
          className="bg-white border border-border rounded-md px-2 py-0.5 text-foreground outline-none min-w-[8rem] max-w-[20rem] text-[14px] focus:ring-1 focus:ring-[#ff0073]/40 focus:border-[#ff0073] dark:bg-zinc-900 dark:border-white/20 dark:text-white/90"
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
