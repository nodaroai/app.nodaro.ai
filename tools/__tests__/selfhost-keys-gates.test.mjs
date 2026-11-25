// @test-watches Dockerfile docker-compose.community.yml
import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

/**
 * A self-hosted install in production must not start on the public default
 * Supabase keys (backend/src/lib/selfhost-keys-settings.ts). The API's own
 * config refuses them, but that alone closes nothing: start.sh restarts a
 * refusing API in a loop and still starts Caddy, which proxies /supabase/* to
 * the auth and database services. So the check runs in start.sh before
 * anything starts, and in the compose file before the auth and database
 * services start (they start on their own and read the same secret).
 */
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8")
const startSh = dockerfile.slice(dockerfile.indexOf("COPY <<'EOF' /app/start.sh"), dockerfile.indexOf("\nEOF\n"))
const compose = readFileSync(new URL("../../docker-compose.community.yml", import.meta.url), "utf8")

const CHECK = "/app/backend/dist/lib/selfhost-keys-check.js"

/** One service's block of the compose file (from its key to the next top-level service). */
function service(name) {
  const start = compose.search(new RegExp(`^  ${name}:\\n`, "m"))
  assert.ok(start >= 0, `the compose file has a ${name} service`)
  const rest = compose.slice(start + 1)
  const next = rest.search(/^ {2}[a-z][a-z0-9-]*:\n|^[a-z]/m)
  return next < 0 ? rest : rest.slice(0, next)
}

test("start.sh runs the key check before it starts anything, and stops when it fails", () => {
  const check = startSh.indexOf(`node ${CHECK}`)
  assert.ok(check > 0, "start.sh runs the check")
  for (const later of ["INTERNAL_ORCHESTRATOR_SECRET=$(node", "applying database migrations", "node dist/server.js", "supervise worker", "build-runtime-config.mjs", "caddy run"]) {
    const at = startSh.indexOf(later)
    assert.ok(at > check, `the check runs before ${later}`)
  }
  assert.match(startSh.slice(check - 40, check + 300), /if ! node \/app\/backend\/dist\/lib\/selfhost-keys-check\.js; then[\s\S]*?exit 1/)
})

test("the auth and database services start only after the one-shot key check passes", () => {
  const keysCheck = service("keys-check")
  assert.match(keysCheck, new RegExp(CHECK.replaceAll(".", "\\.")), "the one-shot runs the same check")
  assert.match(keysCheck, /restart: "no"/, "the one-shot runs once")
  for (const name of ["auth", "rest"]) {
    assert.match(service(name), /depends_on:[\s\S]*?keys-check:\s*\n\s*condition: service_completed_successfully/, `${name} waits for the key check`)
  }
})

test("an image from before the check (a pinned NODARO_IMAGE) still starts the stack, saying the check was skipped", () => {
  const keysCheck = service("keys-check")
  assert.match(keysCheck, /if \[ -f \/app\/backend\/dist\/lib\/selfhost-keys-check\.js \]/)
  assert.match(keysCheck, /skipped/)
})

test("the app and the one-shot judge the same values the auth and database services use", () => {
  const secretDefaults = [...compose.matchAll(/\$\{SUPABASE_JWT_SECRET:-([^}]+)\}/g)].map((m) => m[1])
  assert.ok(secretDefaults.length >= 2)
  assert.equal(new Set(secretDefaults).size, 1, "one default secret everywhere")
  assert.match(service("auth"), /GOTRUE_JWT_SECRET: \$\{SUPABASE_JWT_SECRET:-/)
  assert.match(service("rest"), /PGRST_JWT_SECRET: \$\{SUPABASE_JWT_SECRET:-/)
  for (const name of ["nodaro", "keys-check"]) {
    const block = service(name)
    for (const variable of ["SUPABASE_JWT_SECRET", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "PUBLIC_URL"]) {
      assert.match(block, new RegExp(`^ {6}${variable}: \\$\\{${variable}:-`, "m"), `${name} receives ${variable} with the stack's default`)
    }
  }
  // Every default of each value is the same one, wherever it is read.
  for (const variable of ["SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "PUBLIC_URL"]) {
    const defaults = [...compose.matchAll(new RegExp(`\\$\\{${variable}:-([^}]*)\\}`, "g"))].map((m) => m[1])
    assert.equal(new Set(defaults).size, 1, `one default for ${variable}`)
  }
})
