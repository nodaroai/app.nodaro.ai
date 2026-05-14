import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { buildPersonHints, type PersonValue } from "@nodaro/shared"
import { PersonPicker } from "@/components/editor/config-panels/person-picker"

interface PersonPickerExpanderProps {
  readonly onPromptFragment: (fragment: string) => void
}

/**
 * Default-collapsed wrapper for the existing Person Picker. When opened, lets
 * the user pick age/build/hair/etc. across the 19 person dimensions, then
 * composes a prompt fragment via `buildPersonHints` and emits it through
 * `onPromptFragment`.
 *
 * `onPromptFragment` is intentionally fire-and-forget — the parent decides
 * whether to append, replace, or insert at cursor.
 */
export function PersonPickerExpander({ onPromptFragment }: PersonPickerExpanderProps) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<PersonValue>({})

  // PersonPicker exposes patch-style updates (Partial<PersonValue>). Merge
  // patches into local state so the picker stays in sync across re-renders.
  const handleChange = (patch: Partial<PersonValue>) => {
    setValue((prev) => ({ ...prev, ...patch }))
  }

  const handleApply = () => {
    const hints = buildPersonHints(value as Record<string, unknown> & PersonValue)
    const fragment = hints.join(", ")
    if (fragment) {
      onPromptFragment(fragment)
    }
    setOpen(false)
  }

  const hasSelection = buildPersonHints(value as Record<string, unknown> & PersonValue).length > 0

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Person Picker
      </button>
      {open && (
        <div className="border border-[#334155] rounded p-2 bg-[#13161f] space-y-2">
          <PersonPicker value={value} onChange={handleChange} />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={handleApply}
              disabled={!hasSelection}
              className="text-[10px] px-2 py-1 rounded bg-[#ff0073] text-white hover:bg-[#ff0073]/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Apply to seed prompt
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
