/**
 * A2 emitter — turns the repricing sheet into the two Phase 2 artifacts.
 *
 * Emits BOTH the STATIC_CREDIT_COSTS edit and the model_pricing migration from
 * the SAME sheet, so the code table and the DB cannot diverge (design §8
 * mitigation 1 — the thing that keeps a mid-cutover window a fallback-path
 * discrepancy rather than a 10x error).
 *
 * The code edit is a SURGICAL line rewrite, not a regeneration: it replaces the
 * number on each `"id": N,` literal line and leaves everything else — comments,
 * ordering, and crucially the `...FLUX2_STATIC` / `...AI_AVATAR_STATIC` /
 * `...CINEMATIC_STATIC` / `...VIDEO_ANALYSIS_STATIC` spreads — untouched. Those
 * spreads are computed from CREDIT_BASE_USD and re-derive themselves when the
 * constant flips; rewriting them into literals would freeze them at the old base.
 *
 * SELF-PROVING: --check rewrites using each row's OLD credits and asserts the
 * file comes back byte-identical. A rewriter that cannot reproduce the current
 * file is not trusted to produce the new one.
 *
 * Usage:
 *   npx tsx scripts/a2-emit.mts --sheet <a2-sheet.json> --check
 *   npx tsx scripts/a2-emit.mts --sheet <a2-sheet.json> --write --migration <path.sql>
 */
// @reads backend/src/ee/billing/credits.ts packages/shared/src/model-catalog.ts
import { readFileSync, writeFileSync } from "node:fs"

const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined }
const has = (n: string) => process.argv.includes(n)

const CREDITS_TS = new URL("../src/ee/billing/credits.ts", import.meta.url).pathname
const sheet = JSON.parse(readFileSync(arg("--sheet")!, "utf8")) as {
  rows: { identifier: string; old_credits: number | null; new_credits: number; basis: string; flag: string }[]
}
const byId = new Map(sheet.rows.map(r => [r.identifier, r]))

const src = readFileSync(CREDITS_TS, "utf8")
const lines = src.split("\n")

const start = lines.findIndex(l => l.startsWith("export const STATIC_CREDIT_COSTS"))
if (start < 0) throw new Error("STATIC_CREDIT_COSTS literal not found")
let end = -1
for (let i = start + 1; i < lines.length; i++) if (lines[i] === "}") { end = i; break }
if (end < 0) throw new Error("literal end not found")

/** `"some-id": 12` — number-valued literal entries, ANYWHERE on the line.
 *
 *  Global and unanchored on purpose: several blocks pack multiple entries onto
 *  one line (`"happyhorse:3s:720p": 17, "happyhorse:4s:720p": 23, ...`). An
 *  anchored one-per-line pattern silently skipped all of them, which left 98
 *  composites at the old base while the DB had the new one.
 *
 *  Whitespace after the colon is preserved rather than normalised: several
 *  blocks column-align their values (`"replicate-mmaudio":       1,`). */
const ENTRY = /"([^"]+)":(\s*)(\d+)\b/g

const useOld = has("--check")
let rewritten = 0, unchanged = 0
const missing: string[] = []
const out = [...lines]

for (let i = start + 1; i < end; i++) {
  const line = lines[i]
  if (!line.includes('":')) continue // spread, comment, computed expression
  // Strip a trailing line comment first so prose like `// was 12` is never rewritten.
  const cut = line.indexOf("//")
  const code = cut >= 0 ? line.slice(0, cut) : line
  const tail = cut >= 0 ? line.slice(cut) : ""
  const rewrittenCode = code.replace(ENTRY, (whole, id: string, gap: string, cur: string) => {
    const row = byId.get(id)
    if (!row) { missing.push(id); return whole }
    const next = useOld ? (row.old_credits ?? Number(cur)) : row.new_credits
    if (String(next) === cur) unchanged++
    else rewritten++
    return `"${id}":${gap}${next}`
  })
  out[i] = rewrittenCode + tail
}

const result = out.join("\n")

if (useOld) {
  const identical = result === src
  console.error(`[emit --check] literal entries seen: ${rewritten + unchanged} (rewritten ${rewritten}, already-equal ${unchanged})`)
  if (missing.length) console.error(`[emit --check] ids in the file but NOT in the sheet: ${missing.length}\n  ${missing.slice(0, 10).join("\n  ")}`)
  console.error(identical
    ? "[emit --check] PASS — round-trips byte-identical at the old base"
    : "[emit --check] FAIL — rewriter does not reproduce the current file")
  if (!identical || missing.length) process.exit(1)
  process.exit(0)
}

if (has("--write")) {
  writeFileSync(CREDITS_TS, result)
  console.error(`[emit] credits.ts rewritten: ${rewritten} values changed, ${unchanged} unchanged`)
  if (missing.length) console.error(`[emit] WARNING ${missing.length} ids not in sheet: ${missing.join(", ")}`)
}

// ── MODEL_CATALOG (packages/shared), from the SAME sheet ──
// The catalog carries its own `{ identifier, credits }` rows and is what MCP
// list_models and the public API expose as prices. A guard test asserts it
// matches STATIC_CREDIT_COSTS exactly, so it has to move in lockstep — it is
// emitted here rather than hand-edited for the same reason as the other two.
const CATALOG_TS = new URL("../../packages/shared/src/model-catalog.ts", import.meta.url).pathname
// Matches anywhere on the line, not just at its start: many entries are inline
// (`pricing: [{ identifier: "nano-banana", credits: 1, note: "1K" }],`) and an
// anchored pattern silently skipped 73 of them.
const CAT_ENTRY = /identifier:\s*"([^"]+)"\s*,\s*credits:\s*(\d+)/g
{
  const csrc = readFileSync(CATALOG_TS, "utf8")
  const clines = csrc.split("\n")
  let cChanged = 0
  const cMissing: string[] = []
  for (let i = 0; i < clines.length; i++) {
    if (!clines[i].includes("identifier:")) continue
    clines[i] = clines[i].replace(CAT_ENTRY, (whole, id: string, cur: string) => {
      const row = byId.get(id)
      if (!row) { cMissing.push(id); return whole }
      const next = useOld ? (row.old_credits ?? Number(cur)) : row.new_credits
      if (String(next) !== cur) cChanged++
      return whole.replace(new RegExp(`credits:\\s*${cur}$`), `credits: ${next}`)
    })
  }
  const cresult = clines.join("\n")
  if (useOld) {
    const same = cresult === csrc
    console.error(same
      ? "[emit --check] MODEL_CATALOG round-trips byte-identical at the old base"
      : "[emit --check] MODEL_CATALOG FAIL — rewriter does not reproduce the current file")
    if (cMissing.length) console.error(`[emit --check] catalog ids not in sheet: ${cMissing.length} (${cMissing.slice(0, 5).join(", ")})`)
    if (!same) process.exit(1)
  } else if (has("--write")) {
    writeFileSync(CATALOG_TS, cresult)
    console.error(`[emit] model-catalog.ts rewritten: ${cChanged} values changed${cMissing.length ? `, ${cMissing.length} ids not in sheet` : ""}`)
  }
}

// ── model_pricing migration, from the SAME sheet ──
const migPath = arg("--migration")
if (migPath) {
  const rows = sheet.rows.filter(r => r.basis !== "formula-plugin") // video-analysis is the plugin's own
  const sql = [
    "-- Generated by backend/scripts/a2-emit.mts from the A2 repricing sheet.",
    "-- DO NOT hand-edit: this file and the STATIC_CREDIT_COSTS literal are emitted",
    "-- from the SAME sheet so the DB and the code fallback cannot diverge.",
    "--",
    `-- Rows: ${rows.length}. Generated ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "BEGIN;",
    "",
    ...rows.map(r =>
      // Single quotes: Postgres reads a double-quoted token as an IDENTIFIER,
      // not a string literal, so JSON.stringify here produced invalid SQL.
      `INSERT INTO model_pricing (model_identifier, credit_cost) VALUES ('${r.identifier.replace(/'/g, "''")}', ${r.new_credits})\n` +
      `  ON CONFLICT (model_identifier) DO UPDATE SET credit_cost = EXCLUDED.credit_cost;`),
    "",
    "COMMIT;",
    "",
  ].join("\n")
  writeFileSync(migPath, sql)
  console.error(`[emit] migration written: ${migPath} (${rows.length} rows)`)
}
