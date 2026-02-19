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
