// tools/test-select/summary.mjs
// The "ran X of Y, and why" block each test job appends to its job summary —
// how we see, PR by PR, whether selection is paying off. In shadow mode it
// is what selection WOULD have run, next to a full run.
const TITLES = { frontend: "Frontend Tests", backend: "Backend Tests" }
const LIST_CAP = 200

// shadow: the full suite ran; the block says what the selector would have run.
export function renderSummary(project, result, { shadow = false } = {}) {
  const title = shadow ? `shadow (would run: ${result.mode})` : result.mode
  const lines = [`### ${TITLES[project]}: ${title}`, "", result.reason, ""]
  if (result.mode === "affected") {
    // In shadow mode the full suite ran: these are what selection WOULD run.
    lines.push(
      shadow ? `Would run **${result.files.length}** of ${result.total ?? "?"} test files.` : `Ran **${result.files.length}** of ${result.total ?? "?"} test files.`,
      "",
      shadow ? "<details><summary>Files it would run and why</summary>" : "<details><summary>Selected files and why</summary>",
      "",
    )
    for (const f of result.files.slice(0, LIST_CAP)) lines.push(`- \`${f.file}\` — ${f.why}`)
    if (result.files.length > LIST_CAP) lines.push(`- …and ${result.files.length - LIST_CAP} more`)
    lines.push("", "</details>", "")
  }
  // The registry rule's own shadow period (registry.mjs): what it would run.
  const reg = result.registryRule
  if (reg?.mode === "shadow" && reg.selection && (reg.selection.mode !== result.mode || reg.selection.files.length !== result.files.length)) {
    const n = reg.selection.mode === "affected" ? `${reg.selection.files.length} of ${result.total ?? "?"} test files` : reg.selection.mode
    lines.push(`Registry rule (shadow until TEST_SELECT_REGISTRY_RULE=enforce): would run ${n}.`, "")
  }
  return `${lines.join("\n")}\n`
}
