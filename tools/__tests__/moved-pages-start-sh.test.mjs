import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

/**
 * start.sh starts Caddy and writes /config.js whatever the API does, so the
 * settings that move the app's pages are checked by the server's own rule
 * (backend/src/lib/moved-pages-check.ts) before anything starts: a value the
 * server refuses never reaches the proxy or the browser as a half-move.
 */
const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8")
const startSh = dockerfile.slice(dockerfile.indexOf("COPY <<'EOF' /app/start.sh"), dockerfile.indexOf("\nEOF\n"))

test("start.sh runs the server's own check of the move's settings before it starts anything, and stops when it fails", () => {
  const check = startSh.indexOf("node /app/backend/dist/lib/moved-pages-check.js")
  assert.ok(check > 0, "start.sh runs the check")
  for (const later of ["applying database migrations", "node dist/server.js", "supervise worker", "build-runtime-config.mjs", "caddy run"]) {
    const at = startSh.indexOf(later)
    assert.ok(at > check, `the check runs before ${later}`)
  }
  assert.match(startSh.slice(check - 40, check + 300), /if ! node \/app\/backend\/dist\/lib\/moved-pages-check\.js; then[\s\S]*?exit 1/)
})
