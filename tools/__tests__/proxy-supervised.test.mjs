// @test-watches Dockerfile
import { test } from "node:test"
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The image runs the API server, the queue consumers and the proxy as siblings
 * of one start script. On 2026-11-25 the proxy was the one program started
 * bare: two renders at once used every thread the container may have, the
 * proxy died of it 62 seconds after boot, nothing started it again, and every
 * page answered 502 for 27 minutes while the container stayed green.
 *
 * This reads start.sh out of the Dockerfile and holds what that incident
 * needed: the proxy is started through `supervise`, nothing long-running is
 * started bare, and the start script never stays half alive — by running the
 * script's own functions against processes that die.
 *
 * What a shell does when the kernel refuses it a new process is that shell's
 * own: it is proven in the image's shell, on the built image, by
 * `tools/supervise-no-process-probe.sh` (the Community E2E workflow runs it
 * in the image it has just built).
 */

const dockerfile = readFileSync(new URL("../../Dockerfile", import.meta.url), "utf8")
const startSh = dockerfile.slice(dockerfile.indexOf("COPY <<'EOF' /app/start.sh"), dockerfile.indexOf("\nEOF\n"))
const code = startSh.split("\n").filter((line) => !line.trimStart().startsWith("#"))

/** A `name() { … }` function of start.sh, as the script defines it. */
function shellFunction(name) {
  const from = startSh.indexOf(`\n${name}() {`)
  assert.notEqual(from, -1, `start.sh defines ${name}()`)
  const to = startSh.indexOf("\n}\n", from)
  assert.notEqual(to, -1, `${name}() closes at the start of a line`)
  return startSh.slice(from + 1, to + 2)
}

/** The signal block: the state, both handlers and their traps, from its first line to its last trap. */
function signalBlock() {
  const from = startSh.indexOf('\nTERMINATING=""')
  const lastTrap = startSh.indexOf("\ntrap '", startSh.indexOf("\ntrap supervisor_lost USR1"))
  assert.ok(from !== -1 && lastTrap !== -1, "start.sh has its signal block")
  return startSh.slice(from + 1, startSh.indexOf("\n", lastTrap + 1))
}

/** A stand-in program: records each start once it is ready for a TERM, then stays up until it is told to stop. */
function longRunning(dir, name, { ignoresTerm = false } = {}) {
  const file = join(dir, `${name}.sh`)
  const onTerm = ignoresTerm ? "trap '' TERM" : "trap 'exit 0' TERM"
  writeFileSync(
    file,
    `${onTerm}\necho $$ > "${join(dir, name)}.pid"\necho start >> "${join(dir, name)}.starts"\nwhile :; do /bin/sleep 0.05; done\n`,
  )
  return file
}

/** A stand-in program that exits, with `code`, once the stand-in called `other` is up. */
function exitsOnce(dir, name, other, code) {
  const file = join(dir, `${name}.sh`)
  writeFileSync(
    file,
    `echo start >> "${join(dir, name)}.starts"\nwhile [ ! -s "${join(dir, other)}.starts" ]; do /bin/sleep 0.05; done\nexit ${code}\n`,
  )
  return file
}

const startsOf = (dir, name) => `"$(wc -l < "${join(dir, name)}.starts" 2>/dev/null | tr -d ' ')"`
const waitForStarts = (dir, name, n) =>
  `i=0; while [ "$(wc -l < "${join(dir, name)}.starts" 2>/dev/null || echo 0)" -lt ${n} ] && [ $i -lt 200 ]; do /bin/sleep 0.05; i=$((i+1)); done`

function run(lines) {
  return spawnSync("sh", ["-c", lines.join("\n")], { encoding: "utf8", timeout: 60_000 })
}

/** The start script's own shutdown and reaping, around stand-in programs: its
 *  signal block, `supervise`, the given starts, then the script's last two lines. */
function miniStartScript(starts, { before = [] } = {}) {
  return [
    signalBlock(),
    ...before,
    shellFunction("supervise"),
    ...starts.flatMap((start) => [start, 'CHILD_PIDS="$CHILD_PIDS $!"']),
    shellFunction("reap_children"),
    "reap_children",
    'exit "$EXIT_CODE"',
  ]
}

test("the proxy is started through supervise, once, and never bare", () => {
  const starts = code.filter((line) => /\bcaddy\s+run\b/.test(line))
  assert.equal(starts.length, 1, `start.sh starts the proxy once: ${JSON.stringify(starts)}`)
  assert.match(starts[0], /^\s*SUPERVISE_DELAY=\d+\s+supervise\s+caddy\s+.*\bcaddy\s+run\s.*&\s*$/)
})

test("the proxy's supervisor is one of the children a shutdown is forwarded to", () => {
  const at = code.findIndex((line) => /\bcaddy\s+run\b/.test(line))
  assert.equal(code[at + 1].trim(), 'CHILD_PIDS="$CHILD_PIDS $!"')
})

test("nothing long-running is started bare", () => {
  // Every program the script leaves running in the background goes through
  // `supervise`. The one exception exits by itself: the pipeline worker on an
  // edition that has no pipelines.
  const exitsByItself = new Set(["node dist/pipeline-worker.js &"])
  const background = code.filter((line) => /&\s*$/.test(line) && !/&&\s*$/.test(line)).map((line) => line.trim())
  const bare = background.filter((line) => !/^(SUPERVISE_DELAY=\d+\s+)?supervise\s/.test(line) && !exitsByItself.has(line))
  assert.deepEqual(bare, [], "a program left running without a supervisor stays dead when it dies")
  assert.ok(background.length >= 6, `the script's background starts were found: ${JSON.stringify(background)}`)
})

test("the script ends by reaping its children and leaving with the status a lost supervisor set", () => {
  const tail = code.filter((line) => line.trim() !== "").slice(-2).map((line) => line.trim())
  assert.deepEqual(tail, ["reap_children", 'exit "$EXIT_CODE"'])
})

test("supervise starts the proxy again when it dies, after the proxy's own backoff", () => {
  const dir = mkdtempSync(join(tmpdir(), "proxy-supervise-"))
  try {
    const starts = join(dir, "starts")
    // Dies on its first start, as the proxy did; from the second it stays up.
    writeFileSync(
      join(dir, "proxy.sh"),
      `echo start >> "${starts}"\nif [ "$(wc -l < "${starts}")" -lt 2 ]; then exit 2; fi\ntrap 'exit 0' TERM\nwhile :; do /bin/sleep 0.05; done\n`,
    )
    const result = run([
      "trap 'echo REPORTED' USR1",
      // The backoff, without the wait.
      "sleep() { :; }",
      shellFunction("supervise"),
      `SUPERVISE_DELAY=2 supervise caddy sh "${join(dir, "proxy.sh")}" &`,
      "sup=$!",
      `i=0; while [ "$(wc -l < "${starts}" 2>/dev/null || echo 0)" -lt 2 ] && [ $i -lt 200 ]; do /bin/sleep 0.05; i=$((i+1)); done`,
      "/bin/sleep 0.2",
      'kill -TERM "$sup"',
      'wait "$sup"',
      'printf "supervisor=%s\\n" "$?"',
      "/bin/sleep 0.3",
      `printf 'starts=%s\\n' "$(wc -l < "${starts}" | tr -d ' ')"`,
    ])
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout
    assert.equal(out.match(/\[supervise\] caddy exited \(code 2\) — restarting in 2s/g)?.length, 1, out)
    assert.match(out, /\[supervise\] caddy stopped \(drained\)/)
    assert.match(out, /supervisor=0\n/)
    // Started again once, and not a third time after the shutdown.
    assert.match(out, /starts=2\n/)
    // A shutdown is not a lost supervisor.
    assert.doesNotMatch(out, /REPORTED|ended on its own/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a program that cannot be run is tried again, and its supervisor is not reported lost", () => {
  const dir = mkdtempSync(join(tmpdir(), "proxy-supervise-"))
  try {
    const tries = join(dir, "tries")
    const result = run([
      "trap 'echo REPORTED' USR1",
      `sleep() { echo try >> "${tries}"; /bin/sleep 0.05; }`,
      shellFunction("supervise"),
      `supervise missing "${join(dir, "no-such-program")}" 2>/dev/null &`,
      "sup=$!",
      `i=0; while [ "$(wc -l < "${tries}" 2>/dev/null || echo 0)" -lt 3 ] && [ $i -lt 200 ]; do /bin/sleep 0.05; i=$((i+1)); done`,
      'kill -TERM "$sup"',
      'wait "$sup"',
      "/bin/sleep 0.2",
    ])
    assert.equal(result.status, 0, result.stderr)
    assert.ok((result.stdout.match(/\[supervise\] missing exited \(code 127\) — restarting in 10s/g)?.length ?? 0) >= 3, result.stdout)
    assert.doesNotMatch(result.stdout, /REPORTED|ended on its own/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a shutdown drains every program and leaves with status 0, also when a second signal arrives", () => {
  const dir = mkdtempSync(join(tmpdir(), "start-sh-"))
  try {
    const script = miniStartScript([
      `supervise api-server sh "${longRunning(dir, "api")}" &`,
      `SUPERVISE_DELAY=2 supervise caddy sh "${longRunning(dir, "proxy")}" &`,
    ])
    writeFileSync(join(dir, "start.sh"), script.join("\n") + "\n")
    const result = run([
      `sh "${join(dir, "start.sh")}" &`,
      "main=$!",
      waitForStarts(dir, "api", 1),
      waitForStarts(dir, "proxy", 1),
      "/bin/sleep 0.2",
      // Two signals in a row: the second must not end the wait for the drain.
      'kill -TERM "$main"; kill -INT "$main"',
      'wait "$main"',
      'printf "main=%s\\n" "$?"',
      "/bin/sleep 0.3",
      `printf 'api=%s proxy=%s\\n' ${startsOf(dir, "api")} ${startsOf(dir, "proxy")}`,
    ])
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout
    assert.match(out, /main=0\n/)
    assert.match(out, /\[supervise\] api-server stopped \(drained\)/)
    assert.match(out, /\[supervise\] caddy stopped \(drained\)/)
    // Nothing was started again, and no supervisor was reported lost.
    assert.match(out, /api=1 proxy=1\n/)
    assert.doesNotMatch(out, /ended on its own/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("a supervisor that ends on its own stops every program and the script leaves with a failure status", () => {
  const dir = mkdtempSync(join(tmpdir(), "start-sh-"))
  try {
    const script = miniStartScript(
      [
        `supervise api-server sh "${longRunning(dir, "api")}" &`,
        // Exits once the other program is up; its supervisor then ends inside its own backoff (below).
        `supervise doomed sh "${exitsOnce(dir, "doomed", "api", 5)}" &`,
      ],
      {
        before: [
          // The timer that bounds a hung drain outlives this script by its grace; keep that short here.
          "SUPERVISOR_LOST_GRACE_S=2",
          // The supervisor named "doomed" ends where a shell ends for real: in
          // the middle of its loop, on an error it has no way to handle.
          'sleep() { if [ "$name" = doomed ]; then exit 3; fi; /bin/sleep "$@"; }',
        ],
      },
    )
    writeFileSync(join(dir, "start.sh"), script.join("\n") + "\n")
    const result = run([
      `sh "${join(dir, "start.sh")}"`,
      'printf "main=%s\\n" "$?"',
      "/bin/sleep 0.3",
      `printf 'api=%s doomed=%s\\n' ${startsOf(dir, "api")} ${startsOf(dir, "doomed")}`,
    ])
    assert.equal(result.status, 0, result.stderr)
    const out = result.stdout
    assert.match(out, /\[supervise\] doomed: its supervisor ended on its own — reporting to start\.sh/)
    assert.match(out, /\[start\.sh\] a supervisor ended on its own — stopping every process/)
    // The healthy program was drained like on a shutdown, not left running.
    assert.match(out, /\[supervise\] api-server stopped \(drained\)/)
    // A failure status: what makes the platform start a fresh container.
    assert.match(out, /main=1\n/)
    assert.match(out, /api=1 doomed=1\n/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("after a supervisor is lost, a drain that hangs does not hold the container", () => {
  const dir = mkdtempSync(join(tmpdir(), "start-sh-"))
  try {
    const script = miniStartScript(
      [
        // Never stops when asked: its supervisor waits on it for ever.
        `supervise stuck sh "${longRunning(dir, "stuck", { ignoresTerm: true })}" &`,
        `supervise doomed sh "${exitsOnce(dir, "doomed", "stuck", 5)}" &`,
      ],
      {
        before: [
          "SUPERVISOR_LOST_GRACE_S=1",
          'sleep() { if [ "$name" = doomed ]; then exit 3; fi; /bin/sleep "$@"; }',
        ],
      },
    )
    writeFileSync(join(dir, "start.sh"), script.join("\n") + "\n")
    const result = run([
      `sh "${join(dir, "start.sh")}" &`,
      "main=$!",
      'wait "$main"',
      'printf "main=%s\\n" "$?"',
      // The stand-in that ignores TERM is the test's to end (in a container the kernel ends it with PID 1).
      `read -r stuck < "${join(dir, "stuck")}.pid"; kill -KILL "$stuck"`,
      "/bin/sleep 0.3",
    ])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /\[start\.sh\] still draining 1s after a supervisor ended — leaving/)
    assert.match(result.stdout, /main=1\n/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
