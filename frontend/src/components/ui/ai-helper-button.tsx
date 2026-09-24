import { useState } from "react"
import { Sparkles, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useT } from "@/lib/i18n"

interface AiHelperButtonProps {
  readonly onSuggest: () => Promise<string>
  readonly onReplace: (text: string) => void
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
      const text = await onSuggest()
      if (text.trim().length > 0) onReplace(text.trim())
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
