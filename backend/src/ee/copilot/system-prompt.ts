/**
 * The copilot's system prompt: doctrine + the workflow-editor sections that
 * apply to it. Composed ONCE per process so the cached prefix stays stable —
 * a per-turn rebuild would cost a cache write on every message.
 *
 * `update-contract` and `result-fields` are deliberately left out: the first
 * describes a tool the copilot does not have (`update_workflow_json`), and the
 * second tells an MCP client to hand-write generated result fields, which
 * `edit_workflow` strips.
 */
import { getWorkflowEditorSections } from "../../lib/mcp/tools/skill-loaders.js"
import { COPILOT_DOCTRINE } from "./doctrine.js"

let cached: string | null = null

export function buildSystemPrompt(): string {
  if (cached === null) {
    const editor = getWorkflowEditorSections(["shape", "edges", "catalog", "gotchas"])
    cached = `${COPILOT_DOCTRINE}\n\n---\n\n# Nodaro workflow reference\n\n${editor}`
  }
  return cached
}

/** Test hook — the composition is cached, and a test that changes the skill file needs a way to re-read it. */
export function resetSystemPromptCache(): void {
  cached = null
}
