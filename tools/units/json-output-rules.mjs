// tools/units/json-output-rules.mjs — the manifest rules of a JSON (look) output
// on a unit that is not a use case (decided 2026-10-18, widened 2026-11-11 to JSON
// beside media; tools/units/README.md "A worker unit's JSON outputs"). Called by manifest.mjs (validateUnit);
// built-ins only. A use-case node's outputs are read by the use-case reader
// (use-case-rules.mjs), so none of this applies to it.

/** The output kinds a media take carries: a JSON output may stand beside them. */
const MEDIA_KINDS = ["image", "video", "audio"]

/**
 * Problems with the JSON (look) outputs of a unit whose execution.kind is not
 * "use-case" — and, on any unit, with what an `alignedWith` names.
 */
export function jsonOutputProblems(m) {
  const outputs = Array.isArray(m.handles?.outputs) ? m.handles.outputs : []
  const out = []
  // A JSON output aligned with a list output (`alignedWith`): after a run once
  // per upstream item, its entries are handed on row by row beside that list's
  // items, each with its row (@nodaro/render-rules unit-batch-side-outputs.ts).
  // It names a list output of the same unit; its own shape (a look output, a
  // non-empty id) is checked in manifest.mjs.
  for (const [i, h] of outputs.entries()) {
    if (typeof h?.alignedWith !== "string" || h.alignedWith === "") continue
    if (m.execution?.kind === "use-case") {
      out.push(`handles.outputs[${i}].alignedWith: a use-case node's outputs are read by the use-case reader, never row by row — remove alignedWith`)
      continue
    }
    if (outputs.find((o) => o?.id === h.alignedWith)?.list !== true) {
      out.push(`handles.outputs[${i}].alignedWith: "${h.alignedWith}" is not a list output (list: true) of this unit — a JSON output lines up with one of its own list outputs`)
    }
  }
  if (m.execution?.kind === "use-case") return out
  // The job's value under the output's id lands on this field (unitJobLanding),
  // and the saved output is read back from it (unitSavedOutput / unitOutputValue).
  for (const [i, h] of outputs.entries()) {
    if (h?.kind === "look" && h.from === undefined) out.push(`handles.outputs[${i}].from: a JSON (look) output names the node-data field its value lands on — add from`)
  }
  // A JSON output stands beside other JSON outputs (runJsonNode lands them) or
  // beside media outputs (runProcessingNode lands the media take and the JSON
  // beside it — decided 2026-11-11). No lane lands a job's JSON beside a text or
  // any other output yet.
  const others = [...new Set(outputs.filter((h) => h?.kind !== "look" && !MEDIA_KINDS.includes(h?.kind)).map((h) => h?.kind))]
  if (others.length > 0 && outputs.some((h) => h?.kind === "look")) {
    out.push(`handles.outputs: a unit with a JSON (look) output has only look or media (${MEDIA_KINDS.join("/")}) outputs beside it — no lane lands a job's JSON beside its ${others.join("/")} yet (runJsonNode, runProcessingNode, json-run-result.ts); build that seam in this PR`)
  }
  // Side outputs (a JSON output or a list output beside the media) ride on the
  // media take: the run lands the take, then them beside it. The take is the
  // first output — a plain media output, what an edge naming no pip reads.
  const isPlainMedia = (h) => MEDIA_KINDS.includes(h?.kind) && h?.list !== true
  const hasSide = outputs.some((h) => h?.list === true) || (outputs.some((h) => h?.kind === "look") && outputs.some(isPlainMedia))
  if (hasSide && !isPlainMedia(outputs[0])) {
    out.push(`handles.outputs[0]: a unit with list or JSON outputs beside its media puts the media take first — a plain ${MEDIA_KINDS.join("/")} output (no list), what a run lands and an edge naming no pip reads`)
  }
  return out
}
