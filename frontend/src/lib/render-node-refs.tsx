import type { ReactNode } from "react"
import type { VariableDisplayMode } from "@/components/editor/config-panels/types"

/**
 * Render text with {nodeRef} placeholders highlighted.
 * Shared between TagTextarea (editor) and ReadOnlyPromptBlock (presentation).
 *
 * - "resolved": replaces {ref} with its value (green) or keeps as amber if unresolved
 * - "annotated": shows {ref: value} with name in cyan and value in green/amber
 */
export function renderNodeRefs(
  text: string,
  refMap: Map<string, string>,
  mode: Exclude<VariableDisplayMode, "raw">,
): ReactNode[] {
  const parts: ReactNode[] = []
  const pattern = /\{([^}]+)\}/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const refName = match[1]
    const resolvedValue = refMap.get(refName)
    const isResolved = resolvedValue !== undefined && resolvedValue !== ""

    if (mode === "annotated") {
      parts.push(
        <span key={key++} className="node-ref-highlight">
          {"{"}
          {refName}
          {": "}
          {isResolved ? (
            <span className="ref-resolved-highlight">{resolvedValue}</span>
          ) : (
            <span className="ref-unresolved-highlight">?</span>
          )}
          {"}"}
        </span>
      )
    } else {
      if (isResolved) {
        parts.push(
          <span key={key++} className="ref-resolved-highlight">{resolvedValue}</span>
        )
      } else {
        parts.push(
          <span key={key++} className="ref-unresolved-highlight">{match[0]}</span>
        )
      }
    }

    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return parts
}
