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
