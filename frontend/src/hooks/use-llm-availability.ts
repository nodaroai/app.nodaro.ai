import { useEffect, useState } from "react"
import { hasCredits } from "@/lib/edition"

/**
 * Module-level cache: the answer is session-static in practice, and this
 * hook mounts once per PromptHelperButton (~16 render sites, some inside
 * lists). A short TTL keeps the paste-a-key-on-/setup → return-to-editor
 * flow honest without a reload. Failures resolve false and are NOT cached
 * past the TTL, so a booting backend heals on its own.
 */
const TTL_MS = 60_000
let cachedAt = 0
let cached: Promise<boolean> | null = null

function fetchLlmAvailable(): Promise<boolean> {
  const now = Date.now()
  if (!cached || now - cachedAt > TTL_MS) {
    cachedAt = now
    cached = fetch("/v1/setup/status")
      .then(async (res) => {
        if (!res.ok) return false
        const body = (await res.json()) as { checks?: { providers?: { llm?: boolean } } }
        return body.checks?.providers?.llm === true
      })
      .catch(() => false)
  }
  return cached
}

/** Test seam — reset the module cache between tests. */
export function _resetLlmAvailabilityCacheForTests(): void {
  cached = null
  cachedAt = 0
}

/**
 * Can this install reach an LLM? — a CAPABILITY question, deliberately not
 * hasCredits() (which answers "do we charge for this" and hid the
 * "Generate with AI" prompt helper from every Community/Business install
 * where the feature works fine — #752).
 *
 * Cloud always can (its keys are the platform's; no fetch). Self-host
 * editions ask GET /v1/setup/status — the backend derives
 * `checks.providers.llm` from the same live key resolution the LLM router
 * uses (KIE key, Anthropic/Gemini key, or the nodaro.ai connection), so
 * the answer cannot drift from routing reality. Public endpoint,
 * registered on every non-cloud edition.
 *
 * Conservative while unknown: false during load/error, so the entry points
 * appear only once the capability is confirmed — the same hidden-by-default
 * the old gate had, minus the permanent lie.
 */
export function useLlmAvailability(): boolean {
  const billing = hasCredits()
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (billing) return
    let alive = true
    void fetchLlmAvailable().then((v) => {
      if (alive) setAvailable(v)
    })
    return () => {
      alive = false
    }
  }, [billing])
  return billing || available
}
