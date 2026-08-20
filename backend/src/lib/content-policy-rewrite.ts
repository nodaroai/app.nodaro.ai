/**
 * CONTENT-POLICY REWRITE-ONCE — plain generate-video route (Task A2, 2026-08-03).
 *
 * SIBLING of the private plugin repo's own copy (Task P5, same date). That repo cannot import app code and this repo cannot
 * import it back (see `backend/CLAUDE.md`'s "Private Plugins" section), so
 * `REWRITE_SYSTEM` below is a HAND-SYNCED VERBATIM duplicate of the plugin's
 * prompt string — edit BOTH copies together; nothing enforces the sync but
 * this comment (and the mirrored one over there).
 *
 * Motivating incident: a KIE task failed generation with "the output video
 * may be related to copyright restrictions" — a DETERMINISTIC output-side IP
 * screen, not a transient provider hiccup, so a bare retry with the identical
 * prompt would fail again. `providers/kie/client.ts`'s `classifyContentPolicy`
 * tags the resulting `KieError.contentPolicy = true` (Task A1); the plain t2v
 * dispatch in `workers/handlers/video-ai.ts` catches that flag, calls
 * `rewriteForContentPolicy` below for ONE disclosed LLM rewrite of the
 * rejected prompt, and retries ONCE with the rewritten text. Success is
 * recorded on the job's persisted output (`contentPolicyRewrite`) — never
 * silent.
 */
import { z } from "zod"
import { llmCompleteStructured } from "./llm-client.js"

/**
 * VERBATIM rewrite-once system prompt — see the file header for the
 * hand-sync contract with the plugin repo's sibling copy.
 */
const REWRITE_SYSTEM = `A video-generation provider rejected the prompt below because the rendered output may resemble protected film/TV content. Rewrite it to clear that screen while changing as little as possible:
- Keep every Element block: same names, same physical identity descriptions.
- Keep choreography, camera language, lighting, mood, and audio notes.
- Remove or genericize what makes the scene match a recognizable movie sequence: distinctive vehicle/aircraft/location configurations, franchise-specific props, beat-for-beat famous set pieces — replace with functionally equivalent generic staging.
- Soften wording that evokes a specific real actor's appearance.
Return only JSON matching the schema.`

// Google constrained-decode congruence (global-constraints.md): objects,
// required, strings w/ minLength only — no .int(), no array .max(). A single
// required minLength string clears that bar trivially.
const RewriteSchema = z.object({ rewrittenPrompt: z.string().min(40) })

/**
 * ONE disclosed rewrite-and-retry. Returns the rewritten prompt, or `null` on
 * ANY failure — LLM error, schema validation failure, or the model echoing
 * back the input unchanged (a byte-identical resubmit would fail the same
 * deterministic screen again, which is the exact bug this feature exists to
 * fix). Never throws: a broken rewrite call must degrade to the caller's
 * existing terminal error, not crash the handler a second way.
 */
export async function rewriteForContentPolicy(prompt: string): Promise<string | null> {
  try {
    const { output } = await llmCompleteStructured(
      {
        modelId: "gemini-3.6-flash",
        system: REWRITE_SYSTEM,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        maxTokens: 4096,
        timeoutMs: 60_000,
      },
      RewriteSchema,
      { schemaName: "content_policy_rewrite", maxRetries: 1 },
    )
    const text = output.rewrittenPrompt.trim()
    return text.length >= 40 && text !== prompt ? text : null
  } catch {
    return null
  }
}
