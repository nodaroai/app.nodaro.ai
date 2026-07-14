/**
 * Decode a forced tool call from KIE's Claude `messages` proxy.
 *
 * KIE does not return real `tool_use` content blocks: a forced-tool response
 * arrives as ONE text block wrapping the call in a pseudo-tag —
 * `<tool_calls>[{"type":"tool_use","id":…,"name":…,"input":{…}]</tool_calls>`
 * — and that serialization is malformed BY CONSTRUCTION: the tool object's
 * closing brace is missing (live-captured 2026-07-14, claude-opus-4-7), so the
 * wrapper can never be JSON.parsed whole. The `input` object itself IS
 * well-formed, so balance-scan from the first `"input":` key and return that
 * span verbatim. Returns null when the text carries no pseudo-tag, no input
 * key, or the input object never closes (max_tokens truncation).
 */
export function extractKieToolCallInput(raw: string): string | null {
  if (!raw.includes("<tool_calls>")) return null
  const keyIdx = raw.indexOf('"input"')
  if (keyIdx === -1) return null
  const start = raw.indexOf("{", keyIdx)
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Extract JSON from AI responses that may include markdown fences or prose.
 */
export function extractJsonFromAIResponse(raw: string): string {
  let text = raw.trim()

  // Strip markdown fences (with optional language tag and whitespace)
  if (text.startsWith("```")) {
    text = text.replace(/^```\w*\s*\n?/, "").replace(/\n?\s*```\s*$/, "")
  }

  // Fallback: extract first JSON object if wrapped in prose
  if (!text.startsWith("{") && !text.startsWith("[")) {
    const match = text.match(/(\{[\s\S]*\})/)
    if (match) text = match[1]
  }

  return text.trim()
}
