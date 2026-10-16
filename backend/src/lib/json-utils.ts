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
 * The balanced JSON object or array that opens at `start` (`{` or `[`), string
 * contents and escapes respected — or null when it never closes.
 */
function balancedJsonAt(raw: string, start: number): string | null {
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]
    if (escaped) { escaped = false; continue }
    if (ch === "\\") { escaped = true; continue }
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === "{" || ch === "[") depth++
    else if (ch === "}" || ch === "]") {
      depth--
      if (depth === 0) return raw.slice(start, i + 1)
    }
  }
  return null
}

/** `candidate` when it parses as JSON, else null. */
function parsedOrNull(candidate: string | null): string | null {
  if (candidate === null) return null
  try {
    JSON.parse(candidate)
    return candidate
  } catch {
    return null
  }
}

/**
 * Extract JSON from AI responses that may include markdown fences or prose.
 *
 * A model asked for "only JSON" (KIE's Claude prompt-JSON lane,
 * `kieClaudePromptJson`) still sometimes fences it AND adds a sentence after
 * the fence, or a sentence with braces of its own. The order matters, because
 * a JSON answer may itself CARRY a fence inside a string value (a markdown
 * body with a code block — every structured lane's answer passes through
 * here, the direct tool's `JSON.stringify(input)` included):
 *
 * 1. Text that opens as JSON and whose first balanced value parses is the
 *    answer, trailing prose dropped — a fence inside its strings is content.
 * 2. A fence is a WRAPPER only when it opens before the first `{`/`[` and
 *    what it holds parses — or, when a fence inside one of its strings cut
 *    the match short, the value it opens onto (read balanced) parses.
 * 3. Otherwise the first balanced object in the text that parses (prose may
 *    carry braces of its own, and a wrapper's lazy match may have stopped at
 *    a fence inside a string).
 * 4. Nothing parses: the wrapper's contents, the leading value, or the old
 *    greedy span, as they stand — so the parse error names a truncated answer.
 */
export function extractJsonFromAIResponse(raw: string): string {
  const text = raw.trim()
  const opensAsJson = text.startsWith("{") || text.startsWith("[")

  const leading = opensAsJson ? balancedJsonAt(text, 0) : null
  const leadingParsed = parsedOrNull(leading)
  if (leadingParsed !== null) return leadingParsed

  // A fence that opens before any JSON does.
  let fencedContent: string | null = null
  const firstJson = text.search(/[{[]/)
  const fenced = /```[\w-]*[ \t]*\n?([\s\S]*?)\n?[ \t]*```/.exec(text)
  if (fenced && (firstJson === -1 || fenced.index < firstJson)) {
    fencedContent = fenced[1].trim()
    const inner = fencedContent.startsWith("{") || fencedContent.startsWith("[")
      ? parsedOrNull(balancedJsonAt(fencedContent, 0))
      : null
    if (inner !== null) return inner
    // The lazy match may have stopped at a fence inside one of the value's
    // strings: read the value the wrapper opens onto, balanced from its first
    // `{`/`[`, strings respected — an array stays an array.
    const opened = firstJson === -1 ? null : parsedOrNull(balancedJsonAt(text, firstJson))
    if (opened !== null) return opened
  } else if (!fenced && text.startsWith("```")) {
    // An opening fence that never closes (a cut-off answer).
    fencedContent = text.replace(/^```[\w-]*\s*\n?/, "").trim()
  }

  // The first balanced object anywhere that parses.
  let firstBalanced: string | null = null
  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    const candidate = balancedJsonAt(text, i)
    if (!candidate) continue
    firstBalanced ??= candidate
    const parsed = parsedOrNull(candidate)
    if (parsed !== null) return parsed
  }

  if (fencedContent !== null) return fencedContent
  if (opensAsJson) return leading ?? text
  if (firstBalanced) return firstBalanced
  const match = text.match(/(\{[\s\S]*\})/)
  return (match ? match[1] : text).trim()
}
