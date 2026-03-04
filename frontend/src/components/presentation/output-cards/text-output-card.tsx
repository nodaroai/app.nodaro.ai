import { Copy, FileText } from "lucide-react"
import { toast } from "sonner"
import { StatusBadge, GlassCard, GlassButton, type OutputStatus } from "./shared"

interface TextOutputCardProps {
  label: string
  status: OutputStatus
  text?: string
}

export function TextOutputCard({ label, status, text }: TextOutputCardProps) {
  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-white/50 uppercase tracking-wider">{label}</span>
        <div className="flex items-center gap-2">
          <StatusBadge status={status} />
          {text && (
            <GlassButton
              onClick={() => { navigator.clipboard.writeText(text); toast.success("Text copied") }}
              title="Copy"
            >
              <Copy className="w-3.5 h-3.5" />
            </GlassButton>
          )}
        </div>
      </div>

      {status === "running" ? (
        <div className="flex items-center h-20 rounded-lg bg-white/[0.03] px-4">
          {/* Animated typing dots */}
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="w-2 h-2 rounded-full bg-[#ff0073]/50"
                style={{
                  animation: "typing-dots 1.4s ease-in-out infinite",
                  animationDelay: `${i * 0.2}s`,
                }}
              />
            ))}
          </div>
        </div>
      ) : text ? (
        <div className="bg-white/[0.03] rounded-lg p-3 text-sm text-white/80 whitespace-pre-wrap max-h-64 overflow-y-auto border border-white/5 leading-relaxed">
          {text}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-20 rounded-lg bg-gradient-to-br from-white/[0.03] to-white/[0.01] text-white/20">
          <FileText className="w-8 h-8 mb-1 animate-pulse" />
          <span className="text-xs">
            {status === "failed" ? "Generation failed" : "Awaiting generation"}
          </span>
        </div>
      )}
    </GlassCard>
  )
}
