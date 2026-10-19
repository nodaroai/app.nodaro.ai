// tools/units/json-output-rules.mjs — the manifest rules of a JSON (look) output
// on a unit that is not a use case (decided 2026-10-18; tools/units/README.md
// "A worker unit's JSON outputs"). Called by manifest.mjs (validateUnit);
// built-ins only. A use-case node's outputs are read by the use-case reader
// (use-case-rules.mjs), so none of this applies to it.

/** Problems with the JSON (look) outputs of a unit whose execution.kind is not "use-case". */
export function jsonOutputProblems(m) {
  if (m.execution?.kind === "use-case") return []
  const outputs = Array.isArray(m.handles?.outputs) ? m.handles.outputs : []
  const out = []
  // The job's value under the output's id lands on this field (unitJobLanding),
  // and the saved output is read back from it (unitSavedOutput / unitOutputValue).
  for (const [i, h] of outputs.entries()) {
    if (h?.kind === "look" && h.from === undefined) out.push(`handles.outputs[${i}].from: a JSON (look) output names the node-data field its value lands on — add from`)
  }
  // runJsonNode and the server-run JSON lanes land look outputs only, and a type
  // they land takes their patch alone (never the lanes' media / text writes).
  const others = [...new Set(outputs.filter((h) => h?.kind !== "look").map((h) => h?.kind))]
  if (others.length > 0 && outputs.some((h) => h?.kind === "look")) {
    out.push(`handles.outputs: a unit with a JSON (look) output has only look outputs — no lane lands a job's JSON beside its ${others.join("/")} yet (runJsonNode, json-run-result.ts); build that seam in this PR`)
  }
  return out
}
