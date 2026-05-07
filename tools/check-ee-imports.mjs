#!/usr/bin/env node
// Forbids core code from importing enterprise (ee/) code.
//
// Allowed:    ee  -> core, ee  -> ee, core -> core
// Disallowed: core -> ee  (except for files in ALLOWLIST below)
//
// Enterprise code is identified by EITHER:
//   1. Path contains a directory segment named exactly "ee" (case-sensitive), OR
//   2. Filename ends in .ee.ts, .ee.tsx, .ee.sql, or .ee.md
//
// Run locally: node tools/check-ee-imports.mjs

import { readdirSync, readFileSync } from "node:fs"
import { join, extname, sep } from "node:path"

const ROOTS = ["backend/src", "frontend/src", "packages"]
const EXTS = new Set([".ts", ".tsx"])
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", "__tests__"])

// ALLOWLIST — core files explicitly allowed to import from ee/.
//
// PERMANENT entries: boot/orchestration files that MUST reference both core
// and ee routes for registration. The edition gate (hasAdmin/hasCredits) lives
// at the registration site, so the import itself is harmless.
//
// TEMPORARY entries: files that the migration plan moves to ee/ in a later
// phase. Each such entry MUST include a TODO comment naming the phase.
const ALLOWLIST = new Set([
  // PERMANENT — boot orchestrators
  "backend/src/app.ts",                                    // route registration
  "backend/src/server.ts",                                 // cleanup cron + worker startup

  // TODO Phase 3.5 — convert to dynamic-require shims (mirror workers/shared.ts).
  // These 26 files predate the migration and import CreditsService / pricing
  // constants / TIER_* directly. They run-time gate behavior with hasCredits()
  // already, but the static import forces ee/ to load even in community builds.
  // Each one needs the same dynamic-require pattern used in workers/shared.ts.
  "backend/src/lib/mcp/tools/models.ts",                   // CreditsService for cost display
  "backend/src/lib/node-registry.ts",                      // STATIC_CREDIT_COSTS for NODE_REGISTRY
  "backend/src/utils/file-validation.ts",                  // TIER_STORAGE_LIMITS
  "backend/src/services/workflow-engine/node-executor.ts", // estimateWorkflowCredits
  "backend/src/workers/orchestrator-worker.ts",            // TIER_PARALLELISM
  "backend/src/routes/after-effects-ai.ts",
  "backend/src/routes/ai-writer.ts",
  "backend/src/routes/api-tokens.ts",
  "backend/src/routes/app-runner.ts",
  "backend/src/routes/cancel-jobs.ts",
  "backend/src/routes/component-execute.ts",
  "backend/src/routes/image-to-text.ts",
  "backend/src/routes/llm-chat.ts",
  "backend/src/routes/lottie-overlay-ai.ts",
  "backend/src/routes/motion-graphics-ai.ts",
  "backend/src/routes/presentation.ts",
  "backend/src/routes/prompt-helper.ts",
  "backend/src/routes/published-apps.ts",
  "backend/src/routes/qa-check.ts",
  "backend/src/routes/scene-graph-ai.ts",
  "backend/src/routes/social-publish.ts",
  "backend/src/routes/suno.ts",
  "backend/src/routes/three-d-title-ai.ts",
  "backend/src/routes/web-scrape.ts",
  "backend/src/routes/workflow-execution.ts",
  "backend/src/routes/workflow-templates.ts",

  // TODO Phase 4.5 — convert frontend imports of useModelCredits, CreditBalance,
  // GenerateButton, InsufficientCreditsModal, StorageExceededModal etc. into core
  // shims that return null/no-op when !hasCredits(). Most imports are useModelCredits
  // sprinkled across ~60 node components for the cost badge under each node.
  "frontend/src/app/(dashboard)/library/page.tsx",
  "frontend/src/app/(dashboard)/projects/page.tsx",
  "frontend/src/app/pricing/page.tsx",
  "frontend/src/components/app-runner/mobile-app-header.tsx",
  "frontend/src/components/app-runner/mobile-app-shell.tsx",
  "frontend/src/components/editor/config-panel.tsx",
  "frontend/src/components/editor/config-panels/entity-configs.tsx",
  "frontend/src/components/editor/config-panels/image-configs.tsx",
  "frontend/src/components/editor/config-panels/input-configs.tsx",
  "frontend/src/components/editor/config-panels/kling3-studio-config.tsx",
  "frontend/src/components/editor/config-panels/model-select-option.tsx",
  "frontend/src/components/editor/config-panels/prompt-helper-dialog.tsx",
  "frontend/src/components/editor/config-panels/video-configs.tsx",
  "frontend/src/components/editor/config-panels/voice-browser.tsx",
  "frontend/src/components/editor/editor-toolbar.tsx",
  "frontend/src/components/editor/kling3-director-modal.tsx",
  "frontend/src/components/editor/scene-config.tsx",
  "frontend/src/components/editor/workflow-editor/run-handlers.ts",
  "frontend/src/components/editor/workflow-editor/workflow-editor-main.tsx",
  "frontend/src/components/layout/app-sidebar.tsx",
  "frontend/src/components/nodes/add-captions-node.tsx",
  "frontend/src/components/nodes/adjust-volume-node.tsx",
  "frontend/src/components/nodes/after-effects-node.tsx",
  "frontend/src/components/nodes/ai-writer-node.tsx",
  "frontend/src/components/nodes/audio-isolation-node.tsx",
  "frontend/src/components/nodes/character-node.tsx",
  "frontend/src/components/nodes/combine-audio-node.tsx",
  "frontend/src/components/nodes/combine-videos-node.tsx",
  "frontend/src/components/nodes/dubbing-node.tsx",
  "frontend/src/components/nodes/edit-image-node.tsx",
  "frontend/src/components/nodes/extend-video-node.tsx",
  "frontend/src/components/nodes/extract-frame-node.tsx",
  "frontend/src/components/nodes/face-node.tsx",
  "frontend/src/components/nodes/fade-video-node.tsx",
  "frontend/src/components/nodes/forced-alignment-node.tsx",
  "frontend/src/components/nodes/generate-image-node.tsx",
  "frontend/src/components/nodes/generate-music-node.tsx",
  "frontend/src/components/nodes/generate-script-node.tsx",
  "frontend/src/components/nodes/image-to-image-node.tsx",
  "frontend/src/components/nodes/image-to-text-node.tsx",
  "frontend/src/components/nodes/image-to-video-node.tsx",
  "frontend/src/components/nodes/lip-sync-node.tsx",
  "frontend/src/components/nodes/llm-chat-node.tsx",
  "frontend/src/components/nodes/location-node.tsx",
  "frontend/src/components/nodes/loop-node.tsx",
  "frontend/src/components/nodes/loop-video-node.tsx",
  "frontend/src/components/nodes/lottie-overlay-node.tsx",
  "frontend/src/components/nodes/manual-edit-node.tsx",
  "frontend/src/components/nodes/merge-video-audio-node.tsx",
  "frontend/src/components/nodes/mix-audio-node.tsx",
  "frontend/src/components/nodes/modify-image-node.tsx",
  "frontend/src/components/nodes/motion-graphics-node.tsx",
  "frontend/src/components/nodes/motion-transfer-node.tsx",
  "frontend/src/components/nodes/object-node.tsx",
  "frontend/src/components/nodes/qa-check-node.tsx",
  "frontend/src/components/nodes/remove-background-node.tsx",
  "frontend/src/components/nodes/render-video-node.tsx",
  "frontend/src/components/nodes/resize-video-node.tsx",
  "frontend/src/components/nodes/scene-node.tsx",
  "frontend/src/components/nodes/social-media-format-node.tsx",
  "frontend/src/components/nodes/social-node.tsx",
  "frontend/src/components/nodes/speech-to-video-node.tsx",
  "frontend/src/components/nodes/speed-ramp-node.tsx",
  "frontend/src/components/nodes/split-media-node.tsx",
  "frontend/src/components/nodes/suno-add-instrumental-node.tsx",
  "frontend/src/components/nodes/suno-add-vocals-node.tsx",
  "frontend/src/components/nodes/suno-convert-wav-node.tsx",
  "frontend/src/components/nodes/suno-cover-node.tsx",
  "frontend/src/components/nodes/suno-extend-node.tsx",
  "frontend/src/components/nodes/suno-generate-node.tsx",
  "frontend/src/components/nodes/suno-lyrics-node.tsx",
  "frontend/src/components/nodes/suno-mashup-node.tsx",
  "frontend/src/components/nodes/suno-music-video-node.tsx",
  "frontend/src/components/nodes/suno-replace-section-node.tsx",
  "frontend/src/components/nodes/suno-separate-node.tsx",
  "frontend/src/components/nodes/suno-style-boost-node.tsx",
  "frontend/src/components/nodes/suno-upload-extend-node.tsx",
  "frontend/src/components/nodes/text-to-audio-node.tsx",
  "frontend/src/components/nodes/text-to-dialogue-node.tsx",
  "frontend/src/components/nodes/text-to-speech-node.tsx",
  "frontend/src/components/nodes/text-to-video-node.tsx",
  "frontend/src/components/nodes/three-d-title-node.tsx",
  "frontend/src/components/nodes/transcode-video-node.tsx",
  "frontend/src/components/nodes/transcribe-node.tsx",
  "frontend/src/components/nodes/trim-audio-node.tsx",
  "frontend/src/components/nodes/trim-video-node.tsx",
  "frontend/src/components/nodes/upload-audio-node.tsx",
  "frontend/src/components/nodes/upload-image-node.tsx",
  "frontend/src/components/nodes/upload-video-node.tsx",
  "frontend/src/components/nodes/upscale-image-node.tsx",
  "frontend/src/components/nodes/video-composer-node.tsx",
  "frontend/src/components/nodes/video-to-video-node.tsx",
  "frontend/src/components/nodes/video-upscale-node.tsx",
  "frontend/src/components/nodes/voice-changer-node.tsx",
  "frontend/src/components/nodes/voice-design-node.tsx",
  "frontend/src/components/nodes/voice-remix-node.tsx",
  "frontend/src/components/presentation/presentation-view.tsx",
  "frontend/src/hooks/use-workflow-persistence.ts",
])

function listFiles(dir) {
  const out = []
  let entries = []
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listFiles(full))
    } else if (EXTS.has(extname(entry.name))) {
      out.push(full)
    }
  }
  return out
}

// Mirrors the scope defined in backend/src/ee/LICENSE:
//   "all source code files containing '.ee.' in their filename, all files
//    residing in any directory whose path contains a segment named 'ee'
//    or ending with '.ee', and any compiled artifacts derived from such
//    files"
function isEnterprisePath(filePath) {
  const segments = filePath.split(sep)
  // Directory segment named exactly "ee" or ending with ".ee"
  if (segments.slice(0, -1).some((s) => s === "ee" || s.endsWith(".ee"))) return true
  // Filename containing the ".ee." substring (any extension)
  const filename = segments[segments.length - 1] ?? ""
  if (filename.includes(".ee.")) return true
  return false
}

function isEnterpriseImportSpecifier(spec) {
  // Path containing an "ee" or "*.ee" directory segment
  if (/(?:^|\/)ee\//.test(spec) || /\.ee\//.test(spec)) return true
  // Specifier ending with ".ee" or containing ".ee." in filename
  if (/\.ee(?:\.|$)/.test(spec)) return true
  return false
}

const importRe = /^\s*(?:import|export)\s+(?:[^'"]+from\s+)?['"]([^'"]+)['"]/gm

const violations = []
let scanned = 0

for (const root of ROOTS) {
  const files = listFiles(root)
  for (const file of files) {
    scanned++
    if (isEnterprisePath(file)) continue
    if (ALLOWLIST.has(file)) continue
    const src = readFileSync(file, "utf8")
    let match
    while ((match = importRe.exec(src))) {
      const spec = match[1]
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) {
        if (isEnterpriseImportSpecifier(spec)) {
          violations.push({ file, spec })
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(violations.length + " core-to-ee import violation(s) across " + scanned + " files:")
  for (const v of violations) console.error("  " + v.file + " -> " + v.spec)
  console.error("")
  console.error("Core code (everything outside ee/ and *.ee.{ts,tsx}) cannot import from enterprise.")
  console.error("If the dependency is legitimate, extract the shared piece to a core helper, OR")
  console.error("add the file to ALLOWLIST in tools/check-ee-imports.mjs with a justifying comment.")
  process.exit(1)
}

console.log("OK: no core-to-ee imports found across " + scanned + " files (excluding " + ALLOWLIST.size + " allowlisted)")
