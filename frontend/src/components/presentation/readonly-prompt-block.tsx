import { useMemo } from "react"
import { renderNodeRefs } from "@/lib/render-node-refs"

interface ReadOnlyPromptBlockProps {
  readonly text: string
  readonly refMap: Map<string, string>
  readonly className?: string
}

export function ReadOnlyPromptBlock({ text, refMap, className }: ReadOnlyPromptBlockProps) {
  const rendered = useMemo(
    () => renderNodeRefs(text, refMap, "resolved"),
    [text, refMap],
  )

  return (
    <div
      className={`bg-muted/30 rounded-lg p-3 text-sm text-foreground whitespace-pre-wrap leading-relaxed border border-border ${className ?? ""}`}
      role="textbox"
      aria-readonly="true"
    >
      {rendered.length > 0 ? rendered : (
        <span className="text-muted-foreground italic">No prompt text</span>
      )}
    </div>
  )
}
