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
    <div className="absolute -top-6 left-0 flex items-center gap-1.5 text-[12px] font-medium text-white/70 select-none"
      style={{ pointerEvents: editing ? 'auto' : 'auto' }}
    >
      {icon}
      {editing ? (
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleBlur}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === "Enter") inputRef.current?.blur()
            if (e.key === "Escape") { setValue(label); setEditing(false) }
          }}
          onClick={(e) => e.stopPropagation()}
          className="bg-black/40 border border-white/20 rounded px-1 text-white/90 outline-none w-32 text-[12px]"
        />
      ) : (
        <span
          className="truncate cursor-text hover:text-white/90 transition-colors"
          onClick={(e) => { e.stopPropagation(); setEditing(true) }}
          title="Click to rename"
        >
          {label}
        </span>
      )}
    </div>
  )
}
