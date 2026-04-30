// Set required env vars before config.ts Zod validation fires
process.env.SUPABASE_URL = "https://test.supabase.co"
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key"
process.env.EDITION = "cloud"
process.env.NODE_ENV = "test"
process.env.INTERNAL_ORCHESTRATOR_SECRET = "0".repeat(64)

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
