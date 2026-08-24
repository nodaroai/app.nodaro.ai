/**
 * What an empty canvas says while the Copilot is building into it.
 *
 * `EmptyCanvasState` is suppressed during a turn — "add your first node" is
 * wrong advice while nodes are being added for you — and what replaced it was
 * nothing at all: a blank grid for however long the model took to plan. That is
 * the single worst version of the "is it broken?" problem, because the user
 * watching the canvas has no panel text to fall back on.
 *
 * CORE, not `ee/`: the canvas may not import from `ee/`, and it does not need
 * to. `useCopilotUiStore.turnActive` is a core store the ee engine writes to,
 * so a community build renders this never and pays nothing for it.
 */
import { Bot } from "lucide-react"

export function CanvasCopilotPlanning() {
  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none" role="status">
      <div className="flex flex-col items-center gap-3 px-6 text-center">
        <span className="relative flex items-center justify-center w-11 h-11">
          <span className="absolute inset-0 rounded-full bg-primary/15 animate-ping" aria-hidden />
          <span className="relative flex items-center justify-center w-11 h-11 rounded-full bg-[var(--copilot-surface,var(--muted))] border border-border">
            <Bot className="w-5 h-5 text-primary" strokeWidth={1.7} />
          </span>
        </span>
        <div className="text-sm font-medium text-foreground">Copilot is planning this workflow</div>
        <div className="text-xs text-muted-foreground max-w-[280px]">
          The nodes appear here as it builds them. You can keep working — nothing runs without your OK.
        </div>
      </div>
    </div>
  )
}
