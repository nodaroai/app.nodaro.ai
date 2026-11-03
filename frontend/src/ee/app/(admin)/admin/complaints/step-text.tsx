import { useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/**
 * A short text asked for before a step on the case: a note, or (when
 * `required`) a reason. Shared by the counter-notices' steps and the
 * account's record; the form stays until the step's caller closes it.
 */
export function StepText({
  label,
  placeholder,
  cta,
  required,
  busy,
  initial = "",
  maxLength = 2000,
  onSubmit,
  onCancel,
}: {
  readonly label: string
  readonly placeholder: string
  readonly cta: string
  readonly required: boolean
  readonly busy: boolean
  /** What the field starts with: a suggestion the administrator may change. */
  readonly initial?: string
  readonly maxLength?: number
  readonly onSubmit: (text: string | null) => void
  readonly onCancel: () => void
}) {
  const [text, setText] = useState(initial)
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(text.trim() || null)
      }}
    >
      <Input className="max-w-md" aria-label={label} placeholder={placeholder} value={text} maxLength={maxLength} autoFocus onChange={(e) => setText(e.target.value)} />
      <Button type="submit" size="sm" disabled={busy || (required && text.trim() === "")}>
        {busy && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
        {cta}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
    </form>
  )
}
