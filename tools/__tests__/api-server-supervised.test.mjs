// @test-watches Dockerfile
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The image runs the API server, the queue consumers and the proxy as
 * siblings of one start script. The consumers have long been restarted when
 * they die; the API server was not. On 2026-11-15 it ran out of heap and
 * stayed dead: the proxy answered 502 on every API call for nine minutes while
 * the container itself stayed green, until someone noticed.
 *
 * The API server is started through the same `supervise` as the consumers.
 * This reads start.sh out of the Dockerfile and holds both halves: how the
 * server is started, and that `supervise` does what the start relies on, by
 * running the function itself against a process that dies.
 */

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8")
const startSh = dockerfile.slice(dockerfile.indexOf("COPY <<'EOF' /app/start.sh"), dockerfile.indexOf("\nEOF\n"))
const code = startSh.split("\n").filter((line) => !line.trimStart().startsWith("#"))

/** The `supervise() { … }` function, as start.sh defines it. */
function superviseFunction() {
  const from = startSh.indexOf("supervise() {")
  assert.notEqual(from, -1, "start.sh defines supervise()")
  const to = startSh.indexOf("\n}\n", from)
  assert.notEqual(to, -1, "supervise() closes at the start of a line")
  return startSh.slice(from, to + 2)
}

test("the API server is started through supervise, once, and never bare", () => {
  const starts = code.filter((line) => /\bnode\s+dist\/server\.js\b/.test(line))
  assert.equal(starts.length, 1, `start.sh starts the API server once: ${JSON.stringify(starts)}`)
  assert.match(starts[0], /^\s*supervise\s+\S+\s+env\s+PORT="?\$BACKEND_PORT"?\s+node\s+dist\/server\.js\s+&\s*$/)
})

test("the API server's supervisor is one of the children a shutdown is forwarded to", () => {
  const at = code.findIndex((line) => /\bnode\s+dist\/server\.js\b/.test(line))
  assert.equal(code[at + 1].trim(), 'CHILD_PIDS="$CHILD_PIDS $!"')
})

test("supervise is defined before the API server is started", () => {
  const defined = code.findIndex((line) => line.startsWith("supervise() {"))
  const used = code.findIndex((line) => /^\s*supervise\s/.test(line))
  assert.ok(defined !== -1 && used !== -1 && defined < used, "the function comes before its first use")
  const server = code.findIndex((line) => /\bnode\s+dist\/server\.js\b/.test(line))
  assert.ok(defined < server, "and before the API server's start")
})

test("supervise starts a process that dies again, and stops for good on a shutdown", () => {
  const dir = mkdtempSync(join(tmpdir(), "supervise-"))
  try {
    const starts = join(dir, "starts")
    // Dies on its first two starts; from the third it stays up, as a healthy server does.
    writeFileSync(
      join(dir, "child.sh"),
      `echo start >> "${starts}"\nif [ "$(wc -l < "${starts}")" -lt 3 ]; then exit 7; fi\ntrap 'exit 0' TERM\nwhile :; do /bin/sleep 0.05; done\n`,
    )
    const script = [
      // The 10-second backoff, without the wait.
      "sleep() { :; }",
      superviseFunction(),
      `supervise api-server sh "${join(dir, "child.sh")}" &`,
      "sup=$!",
      // Until the third start is up.
      `i=0; while [ "$(wc -l < "${starts}" 2>/dev/null || echo 0)" -lt 3 ] && [ $i -lt 200 ]; do /bin/sleep 0.05; i=$((i+1)); done`,
      "/bin/sleep 0.2",
      'kill -TERM "$sup"',
      'wait "$sup"',
      "/bin/sleep 0.3",
      `printf 'starts=%s\\n' "$(wc -l < "${starts}" | tr -d ' ')"`,
    ].join("\n")
    const result = spawnSync("sh", ["-c", script], { encoding: "utf8", timeout: 30_000 })
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout
    // Twice it died and was started again…
    assert.equal(out.match(/\[supervise\] api-server exited \(code 7\) — restarting in 10s/g)?.length, 2, out)
    // …and on the shutdown it was stopped and NOT started a fourth time.
    assert.match(out, /\[supervise\] api-server stopped \(drained\)/)
    assert.match(out, /starts=3\n/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
