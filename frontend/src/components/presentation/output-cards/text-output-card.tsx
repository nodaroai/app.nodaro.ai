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
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
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

      {status === "running" || status === "waiting" ? (
        <div className="flex items-center h-20 rounded-lg bg-muted/30 px-4">
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
        <div className="bg-muted/30 rounded-lg p-3 text-sm text-foreground whitespace-pre-wrap max-h-64 overflow-y-auto border border-border leading-relaxed">
          {text}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-20 rounded-lg bg-muted/30 text-muted-foreground">
          <FileText className="w-8 h-8 mb-1 animate-pulse" />
          <span className="text-xs">
            {status === "failed" ? "Generation failed" : "Awaiting generation"}
          </span>
        </div>
      )}
    </GlassCard>
  )
}
