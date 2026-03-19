import { useState } from "react"
import { IterationProgress, type GalleryOutputProps } from "./shared"

export function TextCollapsibleOutput({
  results,
  status,
  iterationTotal,
  iterationCompleted,
}: GalleryOutputProps) {
  const [expandedSet, setExpandedSet] = useState<Set<number>>(new Set([0]))
  const filtered = results.filter(Boolean)

  const toggle = (i: number) => {
    setExpandedSet((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <div>
      <IterationProgress status={status} iterationTotal={iterationTotal} iterationCompleted={iterationCompleted} />
      <div className="flex flex-col gap-1.5">
        {filtered.map((text, i) => (
          <div
            key={i}
            className="bg-background border border-border rounded-md overflow-hidden"
          >
            <button
              onClick={() => toggle(i)}
              className="w-full flex items-center justify-between px-3 py-2 text-left"
            >
              <span className="text-xs font-semibold text-indigo-400">
                #{i + 1}
              </span>
              {!expandedSet.has(i) && (
                <span className="text-xs text-muted-foreground truncate ml-2 flex-1">
                  {text.slice(0, 100)}...
                </span>
              )}
              <span className="text-muted-foreground text-sm ml-1">
                {expandedSet.has(i) ? "\u25BE" : "\u25B8"}
              </span>
            </button>
            {expandedSet.has(i) && (
              <div className="px-3 pb-2 text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap">
                {text}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
