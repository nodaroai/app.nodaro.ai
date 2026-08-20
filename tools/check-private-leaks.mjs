#!/usr/bin/env node
// Forbids private-extraction implementation symbols from leaking back into
// this public repo's tracked files.
//
// Context: proprietary engines were moved out of this repo into the
// `@nodaroai/cloud-plugins` package, loaded at runtime — never via a static,
// tsc-visible import — by `backend/src/lib/private-plugins/load.ts` (see that
// file's header comment for why). This repo knows those engines only through
// the structural `PluginToolkit`/`PluginEngines` contract; it never references
// their internal symbol names again. A hit in the tracked tree means an
// extracted implementation detail crept back in — a revert, a stale doc, a
// copy-pasted comment, a test fixture pulled from the wrong branch.
//
// THE SYMBOL LIST IS NOT IN THIS FILE. A deny-list of proprietary function,
// constant, and prose names IS the map of what was extracted — published in
// cleartext it hands over the private engines' module layout, the algorithm
// names, and the formula constants, which is exactly what the extraction was
// meant to protect (found in the v1.29.6 artifact audit). The list lives in
// the internal repo secret PRIVATE_LEAK_SYMBOLS (newline-separated, exported
// by the CI/mirror workflows) or an untracked local `.leak-symbols` file, the
// same arrangement the marker gate in scripts/publish-to-public.sh uses.
// Symbol VALUES are never echoed — only the offending file:line is printed.
//
// Without a list this check SKIPS (and says so) rather than passing silently;
// the mirror hard-requires it via PRIVATE_LEAK_REQUIRE_SYMBOLS=1, so the
// publish path can never lose the gate unnoticed.
//
// tools/ is excluded from the scan: a pattern necessarily resembles what it
// matches, so scanning tools/ would make the check self-trip.
//
// Run locally: PRIVATE_LEAK_SYMBOLS="$(cat .leak-symbols)" node tools/check-private-leaks.mjs
//   (ask a maintainer for the list, or export the repo secret in CI)

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"


function loadSymbols() {
  const fromEnv = process.env.PRIVATE_LEAK_SYMBOLS
  if (fromEnv && fromEnv.trim()) return fromEnv.split("\n").map((l) => l.trim()).filter(Boolean)
  try {
    return readFileSync(".leak-symbols", "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

const SYMBOLS = loadSymbols()

if (SYMBOLS.length === 0) {
  if (process.env.PRIVATE_LEAK_REQUIRE_SYMBOLS === "1") {
    console.error("check-private-leaks: PRIVATE_LEAK_REQUIRE_SYMBOLS=1 but no symbol list —")
    console.error("set the PRIVATE_LEAK_SYMBOLS secret (or provide a local .leak-symbols file).")
    process.exit(1)
  }
  console.log("check-private-leaks: SKIPPED — no symbol list available (set PRIVATE_LEAK_SYMBOLS).")
  process.exit(0)
}

const PATTERN = SYMBOLS.join("|")

let output = ""
let matched = false

try {
  // `git grep` only searches tracked files in the working tree (never
  // untracked or gitignored content), which is exactly the "TRACKED file"
  // scope this check is meant to enforce.
  output = execFileSync("git", ["grep", "-nE", PATTERN, "--", ".", ":!tools/"], {
    encoding: "utf8",
  })
  matched = true
} catch (err) {
  // git grep exit codes: 0 = match found (handled in the `try` above, so it
  // never lands here), 1 = no match found (the clean/passing case), >=2 = a
  // real error (bad pattern, not a git repo, git missing, etc.) — only that
  // last case should be surfaced as a script failure distinct from "no leaks
  // found".
  if (err.status === 1) {
    matched = false
  } else {
    console.error("check-private-leaks: git grep failed to run:")
    console.error(err.stderr || err.message)
    process.exit(typeof err.status === "number" ? err.status : 1)
  }
}

if (matched) {
  const hits = output.split("\n").filter((line) => line.length > 0)
  console.error(hits.length + " private-extraction symbol leak(s) found outside tools/:")
  for (const hit of hits) console.error("  " + hit)
  console.error("")
  console.error(
    "These symbols identify implementation extracted to the proprietary " +
      "@nodaroai/cloud-plugins package (VCP Stage 1's voice-changer-pro " +
      "engine, or S8's surround-continuation color-transfer/composite engine " +
      "— see backend/src/lib/private-plugins/). They must not appear in " +
      "this public repo outside tools/ (excluded because this script's own " +
      "pattern list necessarily contains them).",
  )
  process.exit(1)
}

console.log(
  "OK: no private-extraction symbol leaks found across tracked files (excluding tools/)",
)
