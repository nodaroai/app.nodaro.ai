import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

/**
 * Every script here that reads a health address gives up after a few seconds.
 * A stalled API server accepts the connection and never answers, and a curl
 * with no limit then waits forever: the start script would never start the
 * proxy, a deploy gate would never pass or fail. The bundled compose file's
 * check is bounded by Docker's own `timeout`, so it is held to that instead.
 * Workflows under .github/ are not covered: a CI job ends at its own time limit.
 */

const root = new URL("../../", import.meta.url)
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8", maxBuffer: 64 << 20 })
  .split("\n")
  .filter((file) => file && !file.startsWith(".github/") && !/\.test\.[cm]?[jt]sx?$/.test(file) && !/\.(png|jpe?g|webp|gif|ico|mp4|mp3|wav|woff2?|ttf|otf|wasm|zip|gz)$/i.test(file))
const isCompose = (file) => /(^|\/)docker-compose[^/]*\.ya?ml$/.test(file)

/** Every line, outside compose files, that runs curl against a /health address. */
function healthCurls() {
  const found = []
  for (const file of tracked) {
    if (isCompose(file)) continue
    let text
    try {
      text = readFileSync(new URL(file, root), "utf8")
    } catch {
      continue
    }
    text.split("\n").forEach((line, index) => {
      if (/\bcurl\b.*\/health\b/.test(line)) found.push({ where: `${file}:${index + 1}`, line: line.trim() })
    })
  }
  return found
}

test("every curl of a health address outside the compose files carries a time limit", () => {
  const curls = healthCurls()
  // The parse still finds them: the start script's boot wait and the example deploy gate at least.
  assert.ok(curls.some((c) => c.where.startsWith("Dockerfile:")), JSON.stringify(curls))
  assert.ok(curls.some((c) => c.where.startsWith("examples/deploy-host.yml:")), JSON.stringify(curls))
  const unbounded = curls.filter((c) => !/(--max-time|\s-m)\s+\d+/.test(c.line))
  assert.deepEqual(unbounded, [], "add `--max-time 5` to each")
})

test("the bundled compose health check is bounded by Docker's own timeout", () => {
  const compose = readFileSync(new URL("docker-compose.community.yml", root), "utf8")
  const check = compose.slice(compose.indexOf("healthcheck:", compose.indexOf("localhost:3000/health") - 200))
  assert.match(check, /localhost:3000\/health/)
  assert.match(check.slice(0, 400), /^\s*timeout:\s*5s\s*$/m)
})
