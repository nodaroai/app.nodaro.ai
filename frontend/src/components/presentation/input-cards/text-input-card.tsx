import { useRef, useEffect } from "react"
import { GlassCard } from "../output-cards/shared"
import { ReadOnlyPromptBlock } from "../readonly-prompt-block"

interface TextInputCardProps {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
  readOnly?: boolean
  refMap?: Map<string, string>
  presentationReadOnly?: boolean
}

export function TextInputCard({ label, value, placeholder, onChange, readOnly, refMap, presentationReadOnly }: TextInputCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.max(80, el.scrollHeight)}px`
  }, [value])

  if (presentationReadOnly && refMap) {
    return (
      <GlassCard>
        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
          {label}
        </label>
        <ReadOnlyPromptBlock text={value} refMap={refMap} />
      </GlassCard>
    )
  }

  return (
    <GlassCard>
      <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        {label}
      </label>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        readOnly={readOnly}
        className={`w-full min-h-[80px] max-h-[40vh] overflow-y-auto bg-muted/30 border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:border-[#ff0073]/50 focus:ring-1 focus:ring-[#ff0073]/30 transition-all duration-200${readOnly ? " opacity-70 cursor-default" : ""}`}
      />
    </GlassCard>
  )
}
