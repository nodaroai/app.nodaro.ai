import { useRef, useEffect } from "react"
import { GlassCard } from "../output-cards/shared"

interface TextInputCardProps {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}

export function TextInputCard({ label, value, placeholder, onChange }: TextInputCardProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.max(80, el.scrollHeight)}px`
  }, [value])

  return (
    <GlassCard>
      <label className="block text-xs font-medium text-white/50 uppercase tracking-wider mb-2">
        {label}
      </label>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full min-h-[80px] bg-white/[0.03] border border-white/10 rounded-lg px-3 py-2 text-sm text-white/90 placeholder:text-white/20 resize-none focus:outline-none focus:border-[#ff0073]/50 focus:ring-1 focus:ring-[#ff0073]/30 transition-all duration-200"
      />
    </GlassCard>
  )
}
