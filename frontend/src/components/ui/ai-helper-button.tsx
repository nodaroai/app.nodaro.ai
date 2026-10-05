import { useState } from "react"
import { Sparkles, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/lib/i18n"

interface AiHelperButtonProps {
  /**
   * Ask for a suggestion. The text it resolves with, trimmed and when not
   * empty, goes to `onReplace`.
   *
   * A suggestion that must be written inside the run that paid for it writes
   * the text itself, resolves with nothing and passes no `onReplace`: one whose
   * answer lands on a canvas node runs inside `withRunInFlight`, and that mark
   * has to outlast the write (T100).
   */
  readonly onSuggest: () => Promise<string | void>
  readonly onReplace?: (text: string) => void
  readonly title?: string
  readonly disabled?: boolean
}

export function AiHelperButton({
  onSuggest,
  onReplace,
  title: titleProp,
  disabled,
}: AiHelperButtonProps) {
  const t = useT()
  const title = titleProp ?? t("misc.suggestWithAi")
  const [busy, setBusy] = useState(false)

  const click = async () => {
    if (busy) return
    setBusy(true)
    try {
      const answer = await onSuggest()
      const text = typeof answer === "string" ? answer.trim() : ""
      if (text.length > 0) onReplace?.(text)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("misc.suggestionFailed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      disabled={busy || disabled}
      onClick={click}
      className="inline-flex items-center justify-center h-6 w-6 rounded-md text-[#3b82f6] hover:bg-[#3b82f6]/10 disabled:opacity-40 transition"
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Sparkles className="w-3.5 h-3.5" />
      )}
    </button>
  )
}
