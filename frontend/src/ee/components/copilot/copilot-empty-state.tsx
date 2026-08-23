/**
 * What the panel says before anyone has asked it anything: who it is, what it
 * will do, and what it will not do without permission — plus four openers, so
 * the first message costs a click rather than a blank-page decision.
 */
import { Bot, Image as ImageIcon, Sparkles, User, Video } from "lucide-react"
import { COPILOT_STRINGS as S, COPILOT_SUGGESTIONS } from "@/ee/lib/copilot/strings"

const ICONS = {
  image: { Icon: ImageIcon, className: "text-[var(--copilot-mention)]" },
  sparkles: { Icon: Sparkles, className: "text-primary" },
  video: { Icon: Video, className: "text-[var(--copilot-ok)]" },
  user: { Icon: User, className: "text-[#475569]" },
} as const

interface CopilotEmptyStateProps {
  firstName: string
  onPick: (text: string) => void
  disabled?: boolean
}

export function CopilotEmptyState({ firstName, onPick, disabled }: CopilotEmptyStateProps) {
  return (
    <div className="flex flex-col gap-[18px] pt-9">
      <div className="flex flex-col items-center gap-3 text-center">
        <Bot className="w-[26px] h-[26px] text-primary" strokeWidth={1.6} />
        <div className="text-[26px] font-semibold text-foreground tracking-[-0.02em]">{S.emptyGreeting(firstName)}</div>
        <p className="text-[12.5px] leading-[1.55] text-[var(--copilot-muted)] max-w-[270px]">{S.emptyBlurb}</p>
      </div>

      <div className="flex flex-col gap-2 mt-1.5">
        {COPILOT_SUGGESTIONS.map(({ text, icon }) => {
          const { Icon, className } = ICONS[icon]
          return (
            <button
              key={text}
              type="button"
              disabled={disabled}
              onClick={() => onPick(text)}
              className="flex items-center gap-2.5 w-full px-3 py-[11px] bg-[var(--copilot-card)] border border-border rounded-[10px] text-[12.5px] text-foreground text-left transition-colors hover:border-[var(--copilot-strong)] hover:bg-[var(--copilot-surface)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Icon className={`w-3.5 h-3.5 flex-none ${className}`} strokeWidth={1.8} />
              {text}
            </button>
          )
        })}
      </div>
    </div>
  )
}
