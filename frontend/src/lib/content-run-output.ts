/**
 * What a finished Content Recipe / Content Ideas job writes onto its node.
 *
 * ONE mapping for both ways a result arrives: the live run
 * (workflow-editor/execute-node.ts) and the load-time recovery of a job that
 * finished while the editor was closed (lib/reconcile-completed-jobs.ts). Two
 * copies would drift, and a recovered node would then look or feed downstream
 * differently from one that ran live.
 *
 * The job's `output_data`:
 *  - content-recipe: `{ json: recipe, text, model, warnings? }`
 *  - content-ideas:  `{ json: ideas[], text: digest, listResults: one brief per
 *    idea, model, warnings? }`
 *
 * Ideas land on `ideaBriefs`, never `__listResults` (that would clone the node
 * on the canvas) and never `generatedResults` (a history there is read as a
 * list).
 */

export type ContentNodeType = "content-recipe" | "content-ideas"

export function isContentNodeType(type: string | undefined): type is ContentNodeType {
  return type === "content-recipe" || type === "content-ideas"
}

function warningsOf(output: Record<string, unknown>): string[] | undefined {
  const warnings = Array.isArray(output.warnings)
    ? output.warnings.filter((w): w is string => typeof w === "string" && w.trim() !== "")
    : []
  return warnings.length > 0 ? warnings : undefined
}

/** The completed-node patch for a finished job, or null when the output holds
 *  no result (nothing to paint — the caller leaves the node alone). */
export function contentRunResultPatch(
  nodeType: ContentNodeType,
  output: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!output) return null
  if (nodeType === "content-recipe") {
    const json = output.json && typeof output.json === "object" && !Array.isArray(output.json) ? output.json : undefined
    const text = typeof output.text === "string" ? output.text : ""
    if (!json && !text.trim()) return null
    return { executionStatus: "completed", generatedJson: json, generatedText: text, runWarnings: warningsOf(output) }
  }
  const ideas = Array.isArray(output.json) ? output.json : []
  const briefs = Array.isArray(output.listResults)
    ? output.listResults.filter((b): b is string => typeof b === "string" && b.trim() !== "")
    : []
  if (ideas.length === 0 && briefs.length === 0) return null
  const text = typeof output.text === "string" ? output.text : briefs.join("\n\n")
  return {
    executionStatus: "completed",
    generatedJson: ideas,
    ideaBriefs: briefs,
    generatedText: text,
    runWarnings: warningsOf(output),
  }
}
