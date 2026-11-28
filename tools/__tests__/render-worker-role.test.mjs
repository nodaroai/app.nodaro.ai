// @test-watches Dockerfile
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The video renders can run in a container of their own, started from the same
 * image (docs/deployment.md, "The render worker as its own service"): the app's
 * container is told not to start the render worker, and a second one is told
 * to start nothing else. On 2026-11-25 two renders used every thread their
 * container may have and the proxy beside them died of it; apart, a render can
 * exhaust only its own container.
 *
 * One variable decides it, in start.sh. This runs the WHOLE script as the
 * image does, with stand-ins for the programs it starts, once per value, and
 * holds what each container runs — and that a value the script does not know
 * starts nothing, because a mistyped `only` would be a second whole app.
 */

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8")
const startSh = dockerfile.slice(dockerfile.indexOf("COPY <<'EOF' /app/start.sh\n") + "COPY <<'EOF' /app/start.sh\n".length, dockerfile.indexOf("\nEOF\n") + 1)
const code = startSh.split("\n").filter((line) => !line.trimStart().startsWith("#"))

/** The programs the image leaves running, by what start.sh asks `node` or `caddy` to run. */
const PROGRAMS = {
  api: "node dist/server.js",
  worker: "node dist/worker.js",
  render: "node dist/render-worker.js",
  orchestrator: "node dist/orchestrator.js",
  pipeline: "node dist/pipeline-worker.js",
  proxy: "caddy run",
}

/** A root with the script (its /app paths moved under it) and stand-ins for `node`, `caddy` and `curl`. */
function fakeImage() {
  const root = mkdtempSync(join(tmpdir(), "start-sh-role-"))
  const bin = join(root, "bin")
  mkdirSync(bin)
  mkdirSync(join(root, "app", "backend"), { recursive: true })
  mkdirSync(join(root, "app", "frontend", "dist"), { recursive: true })
  mkdirSync(join(root, "data"))
  writeFileSync(join(root, "start.sh"), startSh.replace(/\/app(?=[/\s"])/g, `${root}/app`))
  // A program that stays up records its start once it is ready for a TERM; anything else records and ends.
  const staysUp = `trap 'exit 0' TERM INT\necho "$0 $*" >> "$STARTED"\nwhile :; do /bin/sleep 0.05; done\n`
  writeFileSync(
    join(bin, "node"),
    [
      "#!/bin/sh",
      'case "$*" in',
      `  dist/server.js*|dist/worker.js*|dist/render-worker.js*|dist/orchestrator.js*|dist/pipeline-worker.js*|dist/plugin-daemons.js*)`,
      staysUp.replace(/\$0/g, "node").replace(/^/gm, "    "),
      "    ;;",
      // The secret the script generates for itself.
      '  -e*) echo "node -e" >> "$STARTED"; echo 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef ;;',
      '  *) echo "node $*" >> "$STARTED" ;;',
      "esac",
      "",
    ].join("\n"),
  )
  writeFileSync(join(bin, "caddy"), `#!/bin/sh\n${staysUp.replace(/\$0/g, "caddy")}`)
  writeFileSync(join(bin, "curl"), '#!/bin/sh\necho "curl $*" >> "$STARTED"\nexit 0\n')
  for (const name of ["node", "caddy", "curl"]) chmodSync(join(bin, name), 0o755)
  return { root, bin, started: join(root, "started") }
}

const startedLines = (image) => (existsSync(image.started) ? readFileSync(image.started, "utf8").split("\n").filter(Boolean) : [])
const running = (image) =>
  Object.entries(PROGRAMS)
    .filter(([, shown]) => startedLines(image).some((line) => line.startsWith(shown)))
    .map(([name]) => name)
    .sort()

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Runs start.sh with `env` until the programs in `expect` are up (or it ends by
 * itself), lets it settle, asks it to stop, and returns what it started, what
 * it printed and how it ended. With no program expected the script is one that
 * must end by itself: it is waited for, never asked to stop.
 */
async function runStartSh(env, expect) {
  const image = fakeImage()
  try {
    const child = spawn("sh", [join(image.root, "start.sh")], {
      // Nothing of the caller's environment: an EDITION or a RAILWAY_* of the developer's shell would change what starts.
      env: { PATH: `${image.bin}:/usr/bin:/bin`, HOME: image.root, STARTED: image.started, NODARO_DATA_DIR: join(image.root, "data"), ...env },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (chunk) => (output += chunk))
    child.stderr.on("data", (chunk) => (output += chunk))
    const ended = new Promise((resolve) => child.on("close", (status) => resolve(status)))
    let status
    void ended.then((s) => (status = s ?? -1))
    const endsByItself = expect.length === 0
    for (let i = 0; i < 400 && status === undefined && (endsByItself || !expect.every((name) => running(image).includes(name))); i++) await sleep(50)
    // Anything the script would still start has started by now: it does nothing between its starts but wait for the API (the stand-in answers at once).
    await sleep(400)
    const atRest = { running: running(image), lines: startedLines(image) }
    if (status === undefined) child.kill("SIGTERM")
    const timer = setTimeout(() => child.kill("SIGKILL"), 20_000)
    const exit = await ended
    clearTimeout(timer)
    return { ...atRest, output, exit, dataDir: join(image.root, "data"), files: { key: existsSync(join(image.root, "data", "encryption-key")) } }
  } finally {
    rmSync(image.root, { recursive: true, force: true })
  }
}

const ALL = ["api", "orchestrator", "pipeline", "proxy", "render", "worker"]
const ranLine = (result, words) => result.lines.some((line) => line.includes(words))

test("by default the container runs everything, the render worker included", async () => {
  const result = await runStartSh({}, ALL)
  assert.deepEqual(result.running, ALL, result.output)
  assert.equal(result.exit, 0, result.output)
  assert.match(result.output, /Starting with PORT=3000/)
  // An empty value is the default too (a compose file passes one for a variable nobody set).
  const empty = await runStartSh({ RENDER_WORKER_IN_CONTAINER: "" }, ALL)
  assert.deepEqual(empty.running, ALL, empty.output)
  const stated = await runStartSh({ RENDER_WORKER_IN_CONTAINER: "true" }, ALL)
  assert.deepEqual(stated.running, ALL, stated.output)
})

test("told a render service runs the renders, the container starts everything but the render worker", async () => {
  const rest = ALL.filter((name) => name !== "render")
  const result = await runStartSh({ RENDER_WORKER_IN_CONTAINER: "false" }, rest)
  assert.deepEqual(result.running, rest, result.output)
  assert.match(result.output, /RENDER_WORKER_IN_CONTAINER=false — the render worker is not started here/)
  assert.equal(result.exit, 0, result.output)
})

test("the render service runs the render worker and nothing else, and drains it on a shutdown", async () => {
  const result = await runStartSh({ RENDER_WORKER_IN_CONTAINER: "only" }, ["render"])
  assert.deepEqual(result.running, ["render"], result.output)
  assert.match(result.output, /Starting the render worker only/)
  // No proxy, no wait for an API that is not here, no /config.js, no check of the page settings.
  for (const never of ["caddy", "curl", "build-runtime-config", "moved-pages-check", "print-surface-profile"]) {
    assert.ok(!ranLine(result, never), `a render-only container ran ${never}: ${JSON.stringify(result.lines)}`)
  }
  // The keys it will use are still checked.
  assert.ok(ranLine(result, "selfhost-keys-check"), JSON.stringify(result.lines))
  // Supervised, and stopped the way the app's programs are.
  assert.match(result.output, /\[supervise\] render-worker stopped \(drained\)/)
  assert.equal(result.exit, 0, result.output)
})

test("the render service never applies the migrations or generates the instance key", async () => {
  const selfHost = { RUN_MIGRATIONS_ON_BOOT: "true", DATABASE_URL: "postgres://db/app" }
  // The app's container does both — which is also what shows this test can see them.
  const app = await runStartSh({ ...selfHost }, ALL)
  assert.ok(ranLine(app, "run-migrations.mjs"), JSON.stringify(app.lines))
  assert.match(app.output, /generated the instance encryption key/)

  const render = await runStartSh({ ...selfHost, RENDER_WORKER_IN_CONTAINER: "only" }, ["render"])
  assert.deepEqual(render.running, ["render"], render.output)
  assert.ok(!ranLine(render, "run-migrations.mjs"), JSON.stringify(render.lines))
  assert.doesNotMatch(render.output, /generated the instance encryption key/)
  assert.equal(render.files.key, false, "no key was written")
  assert.match(render.output, /a render-only container does not generate the instance key/)
})

test("the render service says so when its addresses name this machine", async () => {
  // The bundled stack's defaults: the app container's own proxy. In a second container that name is the second container.
  const bundled = { SUPABASE_URL: "http://localhost:3000/supabase", R2_PUBLIC_URL: "http://localhost:3000/storage/nodaro-assets" }
  const warned = await runStartSh({ ...bundled, RENDER_WORKER_IN_CONTAINER: "only" }, ["render"])
  assert.match(warned.output, /WARNING: SUPABASE_URL or R2_PUBLIC_URL names this machine \(localhost\)/)
  // A warning, not a refusal: a container that shares the app's network address reaches it there.
  assert.deepEqual(warned.running, ["render"], warned.output)
  for (const one of [{ SUPABASE_URL: "http://127.0.0.1:3000/supabase" }, { R2_PUBLIC_URL: "http://localhost" }]) {
    const result = await runStartSh({ ...one, RENDER_WORKER_IN_CONTAINER: "only" }, ["render"])
    assert.match(result.output, /names this machine \(localhost\)/, JSON.stringify(one))
  }
  // Addresses any container can reach, and a host that merely begins with the word: nothing is said.
  const reachable = { SUPABASE_URL: "https://project.example.com", R2_PUBLIC_URL: "https://localhost.example.com/assets" }
  const quiet = await runStartSh({ ...reachable, RENDER_WORKER_IN_CONTAINER: "only" }, ["render"])
  assert.doesNotMatch(quiet.output, /names this machine/)
  // The app's own container, where localhost IS the app, is never warned.
  const app = await runStartSh({ ...bundled }, ALL)
  assert.doesNotMatch(app.output, /names this machine/)
})

test("a value the script does not know starts nothing", async () => {
  for (const value of ["onyl", "yes", "0", "render"]) {
    const result = await runStartSh({ RENDER_WORKER_IN_CONTAINER: value }, [])
    assert.equal(result.exit, 1, `${value}: ${result.output}`)
    assert.deepEqual(result.lines, [], `${value} started something`)
    assert.match(result.output, new RegExp(`RENDER_WORKER_IN_CONTAINER must be true, false or only \\(it is "${value}"\\): nothing was started`))
  }
})

test("the value is read before the script runs anything", () => {
  const read = code.findIndex((line) => /^case "\$\{RENDER_WORKER_IN_CONTAINER:-true\}" in/.test(line))
  const firstRun = code.findIndex((line) => /\bnode\s/.test(line))
  assert.ok(read !== -1 && firstRun !== -1 && read < firstRun, "the case comes before the first program")
})

test("the render worker is started in one place, through supervise, for both containers that run it", () => {
  const starts = code.filter((line) => /\bnode\s+dist\/render-worker\.js\b/.test(line))
  assert.deepEqual(starts.map((line) => line.trim()), ["supervise render-worker node dist/render-worker.js &"])
  const at = code.findIndex((line) => /\bnode\s+dist\/render-worker\.js\b/.test(line))
  assert.equal(code[at - 1].trim(), "start_render_worker() {")
  assert.equal(code[at + 1].trim(), 'CHILD_PIDS="$CHILD_PIDS $!"')
  assert.equal(code.filter((line) => line.trim() === "start_render_worker").length, 2, "called by the render service's path and by the app's")
})

test("the render service's path is the render worker, the reaper and the exit — nothing more", () => {
  const start = code.findIndex((line, i) => line.trim() === 'if [ "$RENDER_WORKER_IN_CONTAINER" = "only" ]; then' && code[i + 1]?.trim().startsWith("cd "))
  assert.notEqual(start, -1, "start.sh has the render service's path")
  const end = code.findIndex((line, i) => i > start && line.trim() === "fi")
  assert.deepEqual(
    code.slice(start + 1, end).map((line) => line.trim()),
    ["cd /app/backend", "start_render_worker", "reap_children", 'exit "$EXIT_CODE"'],
  )
})
