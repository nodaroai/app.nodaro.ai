// Empty export — this file has an S9 top-level `await` below (registering
// the pipeline-prompt test fixture), and top-level await is only legal in a
// file TypeScript treats as an ES module. Without any import/export, tsc
// classifies a .ts file with no other module syntax as a plain "script"
// (global scope) and rejects the await. Runtime (Vitest/esbuild) already
// treats every file as ESM regardless, so this has no behavioral effect —
// it's purely the compile-time module marker `tsc --noEmit` needs.
export {}

// Set required env vars before config.ts Zod validation fires
process.env.SUPABASE_URL = "https://test.supabase.co"
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key"
process.env.EDITION = "cloud"
process.env.NODE_ENV = "test"
process.env.INTERNAL_ORCHESTRATOR_SECRET = "0".repeat(64)
// EDITION=cloud above means hasCredits() is true by default in every test
// file, so any test that calls the real buildApp() (or imports
// video-worker.ts) exercises the real loadPrivatePlugins() path
// (backend/src/lib/private-plugins/load.ts). That loader requires the
// proprietary @nodaroai/cloud-plugins package at REAL cloud boot — but CI
// and most local dev environments never install it (private repo, no
// registry token — see backend/src/lib/private-plugins/CLAUDE.md-equivalent
// doc in load.ts), so without this default every such test would hit the
// loader's fatal `process.exit(1)` path. Default to the documented
// PRIVATE_MODULES=optional escape hatch (warn + continue with no private
// plugins) so the suite stays green whether or not the plugin happens to be
// file-installed. Tests of the loader itself
// (lib/private-plugins/__tests__/load.test.ts) fully manage this env var
// per-test (save/delete/restore) and are unaffected by this default.
if (process.env.PRIVATE_MODULES === undefined) {
  process.env.PRIVATE_MODULES = "optional"
}

// S9 — register a fixture PromptTable directly into the pipeline-prompt
// registry so every ee/pipelines/llms/**'s run*() wrapper's
// getPipelinePrompt() call resolves in tests, instead of throwing
// PipelinePromptUnavailableError. This bypasses loadPrivatePlugins()
// entirely (which, per the comment above, always resolves empty in test
// environments — PRIVATE_MODULES=optional, no real @nodaroai/cloud-plugins
// installed) and registers the fixture straight into the registry, once per
// test file (setupFiles re-runs per test file under Vitest's default
// per-file module isolation, so this never leaks across files).
//
// Dynamic import — this file lives in core (backend/src/test/, not ee/), so
// it cannot statically import ee/ (enforced by tools/check-ee-imports.mjs).
// Mirrors the same shim pattern lib/private-plugins/load.ts uses for
// applyStaticCreditCosts()/applyPipelinePrompts().
{
  const { registerPipelinePrompts, PIPELINE_PROMPT_KEYS } = await import(
    "../ee/pipelines/llms/prompt-registry.js"
  )
  const fixturePrompts: Record<string, string> = {}
  for (const key of Object.values(PIPELINE_PROMPT_KEYS)) {
    fixturePrompts[key] = `TEST_FIXTURE_PROMPT[${key}]`
  }
  // chat-refine-showrunner.ts's runChatRefineShowrunner() does
  // getPipelinePrompt(...).replace("{{current_plan_json}}", ...) — the
  // fixture must carry that literal placeholder or the .replace() is a
  // silent no-op and the current-plan JSON never gets embedded.
  fixturePrompts[PIPELINE_PROMPT_KEYS.chatRefineShowrunnerBase] +=
    " CURRENT PLAN: {{current_plan_json}}"
  registerPipelinePrompts(fixturePrompts)
}

// ---------------------------------------------------------------------------
// A test boundary must be a real barrier.
//
// `sendInternalError` files a best-effort `app_reports` row and deliberately
// does NOT await it — telemetry must not add latency to, or fail, the response
// it observes. So the write lands after the request is answered, which under a
// slow enough run is DURING A LATER TEST. Route tests share one module-level
// `supabase.from` mock and re-point it per test, so that straggler is recorded
// against whichever test happens to be running: a phantom `.insert()` nobody
// made. It surfaced as a rare "expected 4 calls, got 5" in
// generate-character.test.ts, only ever under full-suite load, and it can reach
// any route test that both triggers a 500 and counts DB calls.
//
// Draining here fixes the whole class once instead of per file. The throttle
// map is process-global too, so reset it as well — otherwise whether a report
// fires at all depends on which earlier test happened to use the same
// (kind, method, route, message) key within the 5-minute window, which is not
// something a test should silently inherit.
import { afterEach } from "vitest"

afterEach(async () => {
  const { __flushHttpErrorTelemetry, __resetHttpErrorTelemetry } = await import("../lib/http-errors.js")
  await __flushHttpErrorTelemetry()
  __resetHttpErrorTelemetry()
})

// Silence operational console output during tests. Heavy console.log emission
// from provider modules (image.ts emits ~3 lines per call) triggers a vitest
// worker RPC race during teardown: `EnvironmentTeardownError: Closing rpc while
// "onUserConsoleLog" was pending`. Tests that need to assert on console can
// override with vi.spyOn(console, ...) — that wins over these noops.
const noop = () => {}
console.log = noop
console.info = noop
console.warn = noop
console.error = noop
console.debug = noop
