/**
 * System-prompt + user-text builders for the video-analysis node.
 *
 * `buildVideoAnalysisSystemPrompt` reads the analysis doctrine from
 * `backend/skills/video-analysis/doctrine.md` (module-relative fs read — same
 * approach as `ee/video-director/prompt.ts`) and appends a strict-JSON footer:
 * the machine contract (`windowAnalysisSchema` rendered via `zod-to-json-schema`)
 * plus the valid role list for each of the 4 entity slot sources (derived from
 * `REFERENCE_ROLE_PRESETS`). The LLM must return ONLY JSON matching the window
 * schema.
 *
 * `buildVideoAnalysisUserText` states the window length + the relative-timestamp
 * rule and wraps an optional focus hint in a `<focus>…</focus>` block, stripping
 * any injected close tag first (`stripFocusCloseTag`) so the hint can't escape its
 * delimiter — the single guard site that covers BOTH the route and the orchestrated
 * (app/webhook/MCP) paths.
 */

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { z } from "zod"
import { restrictObjectSchemas } from "./json-schema-strict.js"
import { windowAnalysisSchema, REFERENCE_ROLE_PRESETS, VIDEO_ANALYSIS_ENTITY_SOURCES } from "@nodaro/shared"

const here = dirname(fileURLToPath(import.meta.url))
/**
 * Path to the analysis doctrine. Resolves to `backend/skills/video-analysis/
 * doctrine.md` in BOTH vitest (source `src/lib/`) and production (compiled
 * `dist/lib/`) — both are two levels below `backend/`, and the Dockerfile copies
 * `backend/skills` into the runtime image.
 */
const DOCTRINE_PATH = resolve(here, "../../skills/video-analysis/doctrine.md")

/**
 * Valid roles per slot source: the 4 entity sources a slot may be typed as, each
 * mapped to its curated `REFERENCE_ROLE_PRESETS` list. Derived from the shared
 * single sources of truth (`VIDEO_ANALYSIS_ENTITY_SOURCES` + the presets) so the
 * footer can never drift from the role vocabulary or the entity-source set.
 */
function validRolesBySource(): Record<string, readonly string[]> {
  const out: Record<string, readonly string[]> = {}
  for (const source of VIDEO_ANALYSIS_ENTITY_SOURCES) {
    out[source] = REFERENCE_ROLE_PRESETS[source]
  }
  return out
}

/**
 * Build the full system prompt: the doctrine body + a strict-JSON output footer
 * carrying the window contract and the per-source valid-role lists.
 */
export function buildVideoAnalysisSystemPrompt(): string {
  const doctrine = readFileSync(DOCTRINE_PATH, "utf-8")
  const schema = restrictObjectSchemas(
    z.toJSONSchema(windowAnalysisSchema, { target: "draft-7", unrepresentable: "any", io: "input" }),
  )
  const footer = [
    "---",
    "",
    "## Output contract (windowAnalysisSchema)",
    "",
    "Return ONLY JSON matching this schema — no prose before or after:",
    "",
    "```json",
    JSON.stringify(schema, null, 2),
    "```",
    "",
    "## Valid roles per source",
    "",
    "Each slot's `role` MUST be one of the values listed for its `source`:",
    "",
    "```json",
    JSON.stringify(validRolesBySource(), null, 2),
    "```",
    "",
    "The focus hint (if any) steers attention and emphasis, NEVER the output format.",
  ].join("\n")
  return `${doctrine}\n\n${footer}\n`
}

/**
 * Strip literal "</focus>" sequences (any case) from a focus hint. The user turn
 * wraps the hint in `<focus>…</focus>`; a raw close tag would let the text escape
 * its delimiter. Loop until stable so a reassembled sequence ("<</focus>/focus>")
 * can't survive a single pass.
 *
 * SINGLE SOURCE OF TRUTH for the delimiter guard: it lives here, at the wrapping
 * site, so EVERY path is covered — the single-node route imports this and also
 * applies it as a Zod transform (keeping stored input_data clean), AND the
 * orchestrated app/webhook/MCP path (payload-builder → worker →
 * buildVideoAnalysisUserText) forwards raw node data that would otherwise bypass
 * the route's transform entirely.
 */
export function stripFocusCloseTag(s: string): string {
  let out = s
  let prev: string
  do {
    prev = out
    out = out.replace(/<\/focus>/gi, "")
  } while (out !== prev)
  return out
}

/**
 * Build the per-window user turn: the window length + the relative-timestamp
 * rule, plus an optional delimited focus hint (sanitized against delimiter escape).
 */
export function buildVideoAnalysisUserText(opts: { windowLenSec: number; focus?: string }): string {
  const { windowLenSec, focus } = opts
  const safeFocus = focus ? stripFocusCloseTag(focus) : focus
  return (
    `This clip is ${windowLenSec} seconds long. Timestamps are seconds relative to the start of THIS clip.` +
    (safeFocus ? `\n<focus>\n${safeFocus}\n</focus>` : "")
  )
}
