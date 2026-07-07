#!/usr/bin/env node
// Forbids private-extraction implementation symbols from leaking back into
// this public repo's tracked files.
//
// Context: Stage 1 of the VCP private-extraction plan moved the
// voice-changer-pro engine (diarization, per-speaker stem building, voice-map
// resolution, and the worker handler that drove them) out of this repo and
// into the proprietary `@nodaroai/cloud-plugins` package (private repo
// `nodaroai/nodaro-cloud-plugins`). It is loaded at runtime — never via a
// static, tsc-visible import — by `backend/src/lib/private-plugins/load.ts`
// (see that file's header comment for why). This repo now only knows about
// the plugin through the structural `PluginToolkit` contract
// (`backend/src/lib/private-plugins/types.ts`); it never references these
// symbol names again.
//
// A hit anywhere in the tracked tree means the extracted implementation
// detail crept back in — a revert, a stale doc, a copy-pasted comment, a test
// fixture pulled from the wrong branch, etc.
//
// tools/ is excluded from the scan: this script's own pattern list is,
// necessarily, the literal symbol names being searched for, so scanning
// tools/ would make the check self-trip on every run.
//
// Run locally: node tools/check-private-leaks.mjs

import { execFileSync } from "node:child_process"

const SYMBOLS = [
  "handleVoiceChangerPro",
  "runVoiceChangerPro",
  "buildSpeakerStemFilter",
  "directDiarize",
  "groupWordsIntoSpeakerSegments",
  "resolveSpeakerVoiceMap",
]

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
    "These symbols identify the voice-changer-pro implementation extracted to " +
      "the proprietary @nodaroai/cloud-plugins package (VCP Stage 1 private " +
      "extraction — see backend/src/lib/private-plugins/). They must not " +
      "appear in this public repo outside tools/ (excluded because this " +
      "script's own pattern list necessarily contains them).",
  )
  process.exit(1)
}

console.log(
  "OK: no private-extraction symbol leaks found across tracked files (excluding tools/)",
)
