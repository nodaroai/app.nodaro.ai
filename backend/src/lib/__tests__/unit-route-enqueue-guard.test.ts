// @test-watches backend/src/nodes/*/route*.ts backend/src/nodes/*/worker.ts
/**
 * Every node unit's route queues its job through `enqueueUnitJob`
 * (lib/enqueue-route-job.ts), never with a queue's `.add` of its own.
 *
 * The helper is what fails a job the queue refused, refunds it and frees its
 * Idempotency-Key at once. A route that calls `videoQueue.add` itself leaves
 * such a job `pending`, holding its credits and its key, until the
 * never-started sweep 30 minutes later — and a client retrying with the same
 * key is answered with that dead job all along. So the rule is mechanical: a
 * unit route imports no queue module (statically or with `import()`), calls
 * no `<something>Queue.add(…)` (a queue reached some other way: a re-export,
 * a module outside lib/), and a worker unit's route queues through the
 * helper, with `if (reply.sent) return` as the very next statement.
 *
 * Read with the TypeScript parser, so comments and strings are never code and
 * "the next statement" is a statement, not the next matching line.
 */
import { describe, it, expect } from "vitest"
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { unitRouteFiles } from "../unit-source-files.js"

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")

/**
 * A queue module: bullmq itself, or a module under lib/ whose name is or
 * starts a word with "queue" (queue, render-queue, video-director-queue,
 * queue-connection, …) — never enqueue-route-job, the helper itself.
 */
const QUEUE_MODULE = /(?:^bullmq$|\/lib\/(?:[^/]*[-_.])?queue[^/]*$)/

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function visit(node: ts.Node, fn: (n: ts.Node) => void): void {
  fn(node)
  ts.forEachChild(node, (child) => visit(child, fn))
}

/** Every module the file imports: static imports, re-exports and `import("…")` calls (a computed one as `<computed import()>`). */
function importedModules(sf: ts.SourceFile): string[] {
  const out: string[] = []
  visit(sf, (n) => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteralLike(n.moduleSpecifier)) {
      out.push(n.moduleSpecifier.text)
    } else if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = n.arguments[0]
      out.push(arg && ts.isStringLiteralLike(arg) ? arg.text : "<computed import()>")
    }
  })
  return out
}

const isQueueModule = (m: string): boolean => m === "<computed import()>" || QUEUE_MODULE.test(m.replace(/\.js$/, ""))

/** The name a call's receiver goes by: `videoQueue` in `videoQueue.add(…)`, `queue` in `queues.queue.add(…)`. */
function receiverName(expr: ts.Expression): string | undefined {
  if (ts.isIdentifier(expr)) return expr.text
  if (ts.isPropertyAccessExpression(expr)) return expr.name.text
  return undefined
}

/** Each `<name ending in Queue/queue>.add(…)` call (its line): a queue's own add, whatever module it came from. */
function queueAddCalls(sf: ts.SourceFile): number[] {
  const out: number[] = []
  visit(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression) || n.expression.name.text !== "add") return
    const receiver = receiverName(n.expression.expression)
    if (receiver && /queue$/i.test(receiver)) out.push(sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1)
  })
  return out
}

/** `if (reply.sent) return`, as a statement (its return bare or in a one-statement block). */
function isStopWhenAnswered(st: ts.Statement | undefined): boolean {
  if (!st || !ts.isIfStatement(st) || st.elseStatement) return false
  const cond = st.expression
  if (!ts.isPropertyAccessExpression(cond) || cond.name.text !== "sent" || !ts.isIdentifier(cond.expression) || cond.expression.text !== "reply") return false
  const then = st.thenStatement
  return ts.isReturnStatement(then) || (ts.isBlock(then) && then.statements.length === 1 && ts.isReturnStatement(then.statements[0]!))
}

/** Each `enqueueUnitJob(…)` call, and whether it is `await enqueueUnitJob(…)` as a statement followed at once by `if (reply.sent) return`. */
function enqueueCalls(sf: ts.SourceFile): Array<{ line: number; stops: boolean }> {
  const out: Array<{ line: number; stops: boolean }> = []
  visit(sf, (n) => {
    if (!ts.isCallExpression(n) || !ts.isIdentifier(n.expression) || n.expression.text !== "enqueueUnitJob") return
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1
    const awaited = ts.isAwaitExpression(n.parent) ? n.parent : undefined
    const statement = awaited && ts.isExpressionStatement(awaited.parent) ? awaited.parent : undefined
    const block = statement?.parent
    if (!statement || !block || !(ts.isBlock(block) || ts.isSourceFile(block))) {
      out.push({ line, stops: false })
      return
    }
    const siblings = block.statements
    out.push({ line, stops: isStopWhenAnswered(siblings[siblings.indexOf(statement) + 1]) })
  })
  return out
}

const routes = unitRouteFiles(REPO_ROOT).map((file) => {
  const sf = parse(file)
  return {
    rel: relative(REPO_ROOT, file).split("\\").join("/"),
    worker: existsSync(join(dirname(file), "worker.ts")),
    imports: importedModules(sf),
    queueAdds: queueAddCalls(sf),
    calls: enqueueCalls(sf),
  }
})

describe("node unit routes queue through enqueueUnitJob", () => {
  it("finds the unit routes, worker units among them (the guard is wired to something)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(5)
    expect(routes.filter((r) => r.worker).length).toBeGreaterThanOrEqual(5)
    // The readers see what they are meant to: every worker route imports the helper's module.
    expect(routes.filter((r) => r.worker && !r.imports.some((m) => m.endsWith("/lib/enqueue-route-job.js"))).map((r) => r.rel)).toEqual([])
  })

  it("no unit route imports a queue module, statically or with import()", () => {
    const offenders = routes.flatMap((r) => r.imports.filter(isQueueModule).map((m) => `${r.rel}: ${m}`))
    expect(
      offenders,
      `These unit routes import a queue module:\n${offenders.map((o) => `  - ${o}`).join("\n")}\n\n` +
        "Queue the job with `await enqueueUnitJob(req, reply, descriptor, { jobId: job.id, ... })` " +
        "(lib/enqueue-route-job.js) followed by `if (reply.sent) return`: it fails, refunds and frees " +
        "the key of a job the queue refuses, instead of leaving it pending for the 30-minute sweep.",
    ).toEqual([])
  })

  it("no unit route calls a queue's own add", () => {
    const offenders = routes.flatMap((r) => r.queueAdds.map((line) => `${r.rel}:${line}`))
    expect(offenders, `These unit routes call a queue's add directly — use enqueueUnitJob:\n${offenders.join("\n")}`).toEqual([])
  })

  it("a worker unit's route queues through the helper, with `if (reply.sent) return` as the very next statement", () => {
    const missing = routes.filter((r) => r.worker && r.calls.length === 0).map((r) => r.rel)
    expect(missing, `These worker units' routes never call enqueueUnitJob:\n${missing.join("\n")}`).toEqual([])
    const unchecked = routes.flatMap((r) => r.calls.filter((c) => !c.stops).map((c) => `${r.rel}:${c.line}`))
    expect(
      unchecked,
      "Each `enqueueUnitJob` call must be its own `await enqueueUnitJob(…)` statement, followed at once by " +
        `\`if (reply.sent) return\` — otherwise a refused job is answered twice:\n${unchecked.join("\n")}`,
    ).toEqual([])
  })
})

describe("the guard's readers", () => {
  const sfOf = (src: string) => ts.createSourceFile("r.ts", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const handler = (body: string) => `app.post("/x", async (req, reply) => {\n${body}\n})`

  it("a statement between the call and the stop fails, though a later handler has the stop", () => {
    const src = handler(`await enqueueUnitJob(req, reply, d, { jobId: "j" })\nlog()\nif (reply.sent) return\nreturn { jobId: "j" }`) +
      "\n" + handler(`if (reply.sent) return`)
    expect(enqueueCalls(sfOf(src))).toEqual([{ line: 2, stops: false }])
  })

  it("the stop right after the call passes, bare or in a block, across a multi-line call", () => {
    expect(enqueueCalls(sfOf(handler(`await enqueueUnitJob(req, reply, d, {\n  jobId: "j",\n})\nif (reply.sent) return\nreturn 1`)))[0]!.stops).toBe(true)
    expect(enqueueCalls(sfOf(handler(`await enqueueUnitJob(req, reply, d, { jobId: "j" });\nif (reply.sent) { return }`)))[0]!.stops).toBe(true)
  })

  it("a call that is not its own awaited statement fails", () => {
    expect(enqueueCalls(sfOf(handler(`const p = enqueueUnitJob(req, reply, d, { jobId: "j" })\nif (reply.sent) return`)))[0]!.stops).toBe(false)
    expect(enqueueCalls(sfOf(handler(`enqueueUnitJob(req, reply, d, { jobId: "j" })\nif (reply.sent) return`)))[0]!.stops).toBe(false)
  })

  it("a queue's add is seen whatever its receiver's module: a bare name, a property, any case of Queue", () => {
    const src = `import { pipelineQueue } from "../../ee/pipelines/queue.js"\nimport * as q from "../../lib/some-reexport.js"\n` +
      `await pipelineQueue.add("x", {})\nawait q.renderQueue.add("y", {})\nawait queue.add("z", {})\n` +
      `// await videoQueue.add("c", {})\nlist.add(1)\nset.add(2)\nawait enqueueUnitJob(req, reply, d, { jobId: "j" })`
    expect(queueAddCalls(sfOf(src))).toEqual([3, 4, 5])
  })

  it("dynamic imports and every lib queue module are seen; comments, strings and the helper are not", () => {
    const mods = importedModules(sfOf(
      `import { videoQueue } from "../../lib/queue.js"\n// import { x } from "../../lib/render-queue.js"\nconst s = "../../lib/queue.js"\n` +
        `async function f(n: string) { await import("../../lib/video-director-queue.js"); await import(n) }`,
    ))
    expect(mods).toEqual(["../../lib/queue.js", "../../lib/video-director-queue.js", "<computed import()>"])
    expect(mods.every(isQueueModule)).toBe(true)
    for (const m of ["../../lib/queue.js", "../../lib/render-queue.js", "../../lib/orchestration-queue.js", "../../lib/social-queue.js", "../../lib/queue-connection.js", "bullmq"]) {
      expect(isQueueModule(m), m).toBe(true)
    }
    expect(isQueueModule("../../lib/enqueue-route-job.js")).toBe(false)
    expect(isQueueModule("../../lib/insert-job.js")).toBe(false)
  })
})
