/**
 * The copilot's system prompt, per surface.
 *
 * The canvas prompt is the doctrine + the workflow-editor sections that apply
 * to it. `update-contract` and `result-fields` are deliberately left out: the
 * first describes a tool the copilot does not have (`update_workflow_json`),
 * and the second tells an MCP client to hand-write generated result fields,
 * which `edit_workflow` strips.
 *
 * The studio prompt is its own doctrine + two slices the studio service SERVES
 * — the operation vocabulary and the plan format's rules. They are not copied
 * into this repo: there is one home for that text, and a second copy would
 * drift the day it is edited.
 *
 * Both are composed ONCE and cached, so the prompt prefix stays byte-stable
 * across turns and the vendor's cache keeps working. The canvas key is the
 * surface; the studio key is the surface AND a digest of the served bytes,
 * because the served guide carries no version of its own — the bytes ARE the
 * version, and a deployment that begins serving a different vocabulary must
 * compose a different prompt rather than keep answering from the old one.
 */
import { createHash } from "node:crypto"
import { getWorkflowEditorSections } from "../../lib/mcp/tools/skill-loaders.js"
import { COPILOT_DOCTRINE, STUDIO_COPILOT_DOCTRINE } from "./doctrine.js"
import type { CopilotSurface } from "./constants.js"
import type { StudioSkillTails } from "./studio-skill.js"

/**
 * How many compositions are kept. One per surface is the steady state; a
 * second studio entry appears only while a redeploy changes the served guide
 * under a running process, and the old one stops being asked for. The bound
 * exists so a service that somehow served a changing guide could not grow this
 * map without limit.
 */
const MAX_CACHED = 8

const cache = new Map<string, string>()

export function buildSystemPrompt(surface: CopilotSurface = "workflow", tails?: StudioSkillTails): string {
  const key = surface === "studio" ? `studio:${digest(tails)}` : "workflow"
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const composed = surface === "studio" ? composeStudio(tails) : composeWorkflow()
  if (cache.size >= MAX_CACHED) cache.clear()
  cache.set(key, composed)
  return composed
}

function composeWorkflow(): string {
  const editor = getWorkflowEditorSections(["shape", "edges", "catalog", "gotchas"])
  return `${COPILOT_DOCTRINE}\n\n---\n\n# Nodaro workflow reference\n\n${editor}`
}

/**
 * A slice the guide no longer carries is left OUT rather than replaced by a
 * placeholder: the model's own tool descriptions already send it to the skill
 * when it needs the vocabulary, and a heading with nothing under it reads as a
 * vocabulary with no operations in it.
 */
function composeStudio(tails: StudioSkillTails | undefined): string {
  return [STUDIO_COPILOT_DOCTRINE, tails?.vocabulary, tails?.rules].filter(Boolean).join("\n\n---\n\n")
}

/** The served bytes, as the version marker they are. */
function digest(tails: StudioSkillTails | undefined): string {
  return createHash("sha256")
    .update(`${tails?.vocabulary ?? ""}\n${tails?.rules ?? ""}`)
    .digest("hex")
}

/** Test hook — the compositions are cached, and a test that changes the served text needs a way to re-read it. */
export function resetSystemPromptCache(): void {
  cache.clear()
}
