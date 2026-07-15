#!/usr/bin/env node
// Forbids private-extraction implementation symbols from leaking back into
// this public repo's tracked files.
//
// Context: two private extractions moved code out of this repo and into the
// proprietary `@nodaroai/cloud-plugins` package (private repo
// `nodaroai/nodaro-cloud-plugins`), loaded at runtime — never via a static,
// tsc-visible import — by `backend/src/lib/private-plugins/load.ts` (see
// that file's header comment for why):
//
//   - VCP (Stage 1): the voice-changer-pro engine (diarization, per-speaker
//     stem building, voice-map resolution, and the worker handler that drove
//     them).
//   - S8: the surround-continuation color-science/compositing engine
//     (per-channel Reinhard color transfer, half-carry seam geometry) — the
//     worker handler and route stay in this repo (`workers/handlers/
//     surround.ts`, `routes/generate-surround-continuation.ts`), but the two
//     IP-sensitive functions it calls into (`buildSurroundComposite`,
//     `harmonizeSurround`) are now reached only through the additive
//     `engines` capability (`backend/src/lib/private-plugins/types.ts`'s
//     `PluginSurroundEngine`).
//
// This repo now only knows about either plugin through the structural
// `PluginToolkit`/`PluginEngines` contract (`backend/src/lib/private-plugins/
// types.ts`); it never references these symbol names again.
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
  // VCP
  "handleVoiceChangerPro",
  "runVoiceChangerPro",
  "buildSpeakerStemFilter",
  "directDiarize",
  "groupWordsIntoSpeakerSegments",
  "resolveSpeakerVoiceMap",
  // S8 (surround)
  "Reinhard",
  "BASE_FEATHER",
  "RESIDUAL_THRESHOLD",
  "seamGeometry",
  // S9 (film-studio prompts) — unlike VCP/S8, S9 moved DATA (prompt string
  // VALUES), not code symbols; the constants that used to hold those strings
  // were deleted from ee/pipelines/llms/** entirely (replaced by
  // getPipelinePrompt(PIPELINE_PROMPT_KEYS.x) calls). These names guard
  // against the constant declarations reappearing anywhere in the tracked
  // tree (a revert, a stale doc, a copy-pasted comment). 20 of the 25 moved
  // constant names are listed — the 21st distinct name, bare `SYSTEM_PROMPT`
  // (shared by 5 of the 25: character-image-critic.ts, location-image-critic.ts,
  // video-critic.ts, storyboard-cohesion-critic.ts, chat-refine-postmerge.ts),
  // is DELIBERATELY excluded: it already collides with two unrelated,
  // legitimate constants elsewhere in this repo
  // (providers/script/script-generator.ts, services/reduce-strategies/
  // pick-best-llm.ts), so adding it here would false-positive on every run.
  "DETECTION_SYSTEM_PROMPT",
  "SHOWRUNNER_SYSTEM_PROMPT",
  "SCENE_DIRECTOR_SYSTEM_PROMPT",
  "EDITOR_SYSTEM",
  "SCENE_REFINER_SYSTEM_PROMPT",
  "SCRIPT_CRITIC_SYSTEM_PROMPT",
  "CAST_COVERAGE_SYSTEM_PROMPT",
  "LOCATIONS_COVERAGE_SYSTEM_PROMPT",
  "SHOT_LIST_CRITIC_SYSTEM_PROMPT",
  "IMAGE_CRITIC_SYSTEM",
  "VOICE_MATCHER_SYSTEM_PROMPT_BASE",
  "SYSTEM_PROMPT_BASE",
  "ADD_BROLL_SYSTEM",
  "ANCHOR_SCENE_STYLE_SYSTEM",
  "AUDIT_PROMPT_SYSTEM",
  "BRIDGE_TO_NEXT_SCENE_SYSTEM",
  "GENERATE_MOTION_SYSTEM",
  "IMPROVE_PROMPT_SYSTEM",
  "OPTIMIZE_FOR_MODEL_SYSTEM",
  "VALIDATE_MATCH_CUT_SYSTEM",
  // video-analysis: the whole node implementation (route + windowed multimodal
  // LLM handler + segmentation/merge/checkpoint pipeline + prompt builders +
  // the analysis doctrine) moved to @nodaroai/cloud-plugins
  // (src/plugins/video-analysis/). This repo keeps ONLY the public wire
  // contract (@nodaro/shared schemas/pricing), the node UI, the orchestration
  // glue keyed on the "video-analysis" node-type string, the MCP verb, and the
  // credit formula (lib/pricing/video-analysis-cost.ts — public by the
  // 2026-07-06 IP audit). These implementation symbols must never reappear
  // here. NOTE: `VIDEO_ANALYSIS_TMP_PREFIX` is DELIBERATELY excluded — the
  // core cleanup-cron reaper legitimately re-declares that literal (a
  // documented sync-twin of the plugin's constant).
  "handleVideoAnalysis",
  "analyzeWindowViaKie",
  "segmentAndUploadWindows",
  "recutWindowFromSource",
  "mergeWindowResults",
  "computeWindowPlan",
  "buildVideoAnalysisSystemPrompt",
  "buildVideoAnalysisUserText",
  "stripFocusCloseTag",
  "vaTmpKeys",
  "readVaState",
  "writeVaState",
  "deleteVaTmp",
  "VaDurationError",
  "resolveVideoAnalysisIdentifier",
  "probeVideoAnalysisDurationPreHandler",
  // A distinctive line from the analysis doctrine (guards the doctrine PROSE
  // reappearing, since it moved as a bundled string, not a named constant).
  "second unit to reshoot",
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
