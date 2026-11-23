import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useT, tx } from "@/lib/i18n"

/** A read-only value with a copy button (the view link, the embed code). */
export function CopyField({ value, label, multiline = false }: { readonly value: string; readonly label: string; readonly multiline?: boolean }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(tx("workflowView.copied"))
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(tx("workflowView.copyFailed"))
    }
  }, [value])

  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <textarea
          aria-label={label}
          value={value}
          readOnly
          rows={3}
          className="min-w-0 flex-1 resize-none rounded-md border border-input bg-transparent px-3 py-2 font-mono text-[11px] leading-snug"
          onFocus={(e) => e.currentTarget.select()}
        />
      ) : (
        <Input aria-label={label} value={value} readOnly className="text-xs" onFocus={(e) => e.currentTarget.select()} />
      )}
      <Button aria-label={t("common.copy")} variant="outline" size="sm" onClick={copy}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}
