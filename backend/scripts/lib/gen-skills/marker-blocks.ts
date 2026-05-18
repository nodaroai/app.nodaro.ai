/**
 * Read and rewrite <!-- AUTO-GEN:START <id> --> ... <!-- AUTO-GEN:END <id> -->
 * blocks in a markdown document. Used by gen-skills.ts to refresh the
 * structured-data sections of skill files while preserving hand-written
 * prose between markers.
 */

export interface MarkerBlock {
  id: string
  content: string
  startOffset: number
  endOffset: number
}

const START_RE = /<!--\s*AUTO-GEN:START\s+([a-z0-9-]+)\s*-->/g

export function parseMarkerBlocks(source: string): MarkerBlock[] {
  const blocks: MarkerBlock[] = []
  const startMatches = [...source.matchAll(START_RE)]
  for (const m of startMatches) {
    const id = m[1]!
    const startMarkerStart = m.index!
    const startMarkerEnd = m.index! + m[0].length
    const endRe = new RegExp(
      `<!--\\s*AUTO-GEN:END\\s+${escapeRe(id)}\\s*-->`,
    )
    const tail = source.slice(startMarkerEnd)
    const endMatch = tail.match(endRe)
    if (!endMatch || endMatch.index === undefined) {
      throw new Error(
        `unterminated AUTO-GEN block: START '${id}' at offset ${startMarkerStart} has no matching END marker`,
      )
    }
    const endMarkerStart = startMarkerEnd + endMatch.index
    const endMarkerEnd = endMarkerStart + endMatch[0].length
    let content = source.slice(startMarkerEnd, endMarkerStart)
    content = content.replace(/^\n/, "").replace(/\n$/, "")
    blocks.push({
      id,
      content,
      startOffset: startMarkerStart,
      endOffset: endMarkerEnd,
    })
  }
  return blocks
}

export function rewriteBlock(
  source: string,
  id: string,
  newContent: string,
): string {
  const blocks = parseMarkerBlocks(source)
  const existing = blocks.find((b) => b.id === id)
  const formatted = `<!-- AUTO-GEN:START ${id} -->\n${newContent}\n<!-- AUTO-GEN:END ${id} -->`
  if (existing) {
    if (existing.content === newContent) return source
    return (
      source.slice(0, existing.startOffset) +
      formatted +
      source.slice(existing.endOffset)
    )
  }
  const sep = source.endsWith("\n") ? "\n" : "\n\n"
  return source + sep + formatted + "\n"
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
