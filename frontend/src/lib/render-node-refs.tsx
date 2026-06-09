import type { ReactNode } from "react"
import { parseNodeRef } from "@nodaro/shared"
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

    // Mirror resolveNodeRefs: connected non-empty output → its value; absent/empty + fallback →
    // the fallback ("" for {name || }); else unresolved. Parsing the {name || default} body keeps
    // the preview in sync with execution.
    const { name, fallback } = parseNodeRef(match[1])
    const resolved = refMap.get(name)
    const effective = resolved !== undefined && resolved !== "" ? resolved : fallback
    const isResolved = effective !== null && effective !== undefined

    if (mode === "annotated") {
      parts.push(
        <span key={key++} className="node-ref-highlight">
          {"{"}
          {name}
          {": "}
          {isResolved ? (
            <span className="ref-resolved-highlight">{effective}</span>
          ) : (
            <span className="ref-unresolved-highlight">?</span>
          )}
          {"}"}
        </span>
      )
    } else {
      if (isResolved) {
        parts.push(
          <span key={key++} className="ref-resolved-highlight">{effective}</span>
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
