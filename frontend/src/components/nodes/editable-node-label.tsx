"use client"
import { useState, useRef, useEffect } from "react"
import type { ReactNode } from "react"

interface EditableNodeLabelProps {
  label: string
  icon: ReactNode
  onSave: (newLabel: string) => void
}

export function EditableNodeLabel({ label, icon, onSave }: EditableNodeLabelProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setValue(label) }, [label])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  function handleBlur() {
    setEditing(false)
    if (value.trim() && value !== label) onSave(value.trim())
    else setValue(label)
  }

  return (
    <div
      className={`absolute -top-6 left-0 flex items-center gap-1.5 text-[12px] font-medium text-foreground/70 dark:text-white/70 ${editing ? "nopan nodrag nowheel" : "select-none"}`}
    >
      {icon}
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
          className="bg-white border border-border rounded-md px-2 py-0.5 text-foreground outline-none min-w-[8rem] max-w-[20rem] text-[12px] focus:ring-1 focus:ring-[#ff0073]/40 focus:border-[#ff0073] dark:bg-zinc-900 dark:border-white/20 dark:text-white/90"
          style={{ width: `${Math.max(8, value.length * 0.65 + 2)}ch` }}
        />
      ) : (
        <span
          className="truncate cursor-text hover:text-foreground dark:hover:text-white/90 transition-colors"
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
