// @test-watches frontend/src/components/editor/workflow-editor/*.ts frontend/src/nodes/*/exec.ts
import { describe, it, expect } from "vitest"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"

/**
 * A node's run the server refuses for a credits shortfall that names its
 * figures opens the editor's not-enough-credits dialog, never only a toast.
 * Every node executor reaches it through one check, `checkStorageError` or
 * its credits half `promptCreditsShortfall`. Its ANSWER decides whether the
 * catch's own error toast shows, so a refusal never shows both.
 *
 * This walks every catch in the node executors (`catch` blocks and inline
 * `.catch(() => …)` handlers) and fails:
 *  - an error toast that is not reachable ONLY when the check answered false
 *    (no dialog opened): the check never asked, its answer ignored, or read
 *    the wrong way (a toast shown when the dialog DID open);
 *  - a catch that marks the node failed and shows no toast, but never asks the
 *    check (it has no toast to decide, so there its answer may be discarded).
 *
 * How it reads the answer — these shapes only; anything else it cannot
 * classify, and a toast under it fails:
 *  - the answer is the check's call, or a `const` the catch binds to that
 *    call and declares nowhere else in it (a `let`, or a name an inner scope
 *    shadows, is not the answer);
 *  - a condition is the answer, `!`, `&&`, `||` or parentheses over it;
 *  - the toast sits in a branch the condition decides: `if` / `else`, either
 *    arm of `?:`, the right side of `&&` / `||`, or after an earlier
 *    `if (answer) return | throw` (no `else`) in the same block.
 * A catch that must stay a plain toast is listed in `PLAIN_TOAST` with the
 * reason, keyed by file, node type or function, and the toast's message key —
 * never a line number.
 *
 * What it does NOT see, so it is not total:
 *  - a rejection handler passed as `.then(onFulfilled, onRejected)`;
 *  - a NAMED handler (`.catch(handleFailure)`) or a function the catch calls
 *    that toasts inside it (a helper);
 *  - a toast shown through anything but `toast.error` / `guardedToast.error`;
 *  - files outside `components/editor/workflow-editor/*.ts` and
 *    `nodes/*\/exec.ts`.
 */
const EDITOR = path.resolve(__dirname, "..")
const NODES = path.resolve(__dirname, "../../../../nodes")
const SRC = path.resolve(__dirname, "../../../..")
const CHECKS = new Set(["checkStorageError", "promptCreditsShortfall"])
const TOASTS = new Set(["toast", "guardedToast"])

/** Why a status-read catch never sees a blocking refusal. */
const STATUS_READ = "a status read of a job that already started: a refusal for credits, storage or the subscription comes when the job is created, never from reading its status"
/** Why a whole run's start is not this check's. */
const WHOLE_RUN = "a whole run's start (Run, Run from here, Continue, Render final): the approved change leaves the run's own refusal as it is — the toolbar Run checks the balance before it starts"

/** Why an asset batch's summary toast shows whatever the check answers. */
const BATCH_SUMMARY =
  "the batch's summary of how many it generated, not the refusal's notice: it shows whatever the check answers, and the answer decides only its description (the refusal's sentence is left to the dialog when the dialog took it)"

/** `file › node type or function › what it does` → why that catch's failure can never be a blocking refusal a node's run should answer with its dialog. */
const PLAIN_TOAST: Readonly<Record<string, string>> = {
  "components/editor/workflow-editor/asset-executors.ts › handleGenerateCharacterAsset › nodeRun.failedToGenerateCompleted":
    BATCH_SUMMARY,
  "components/editor/workflow-editor/asset-executors.ts › handleGenerateLocationAsset › nodeRun.failedToGenerateCompleted":
    BATCH_SUMMARY,
  "components/editor/workflow-editor/asset-executors.ts › handleGenerateObjectAsset › nodeRun.failedToGenerateCompleted":
    BATCH_SUMMARY,
  "components/editor/workflow-editor/asset-executors.ts › runCharacterGeneration › nodeRun.failedToCheckJobStatus":
    STATUS_READ,
  "components/editor/workflow-editor/asset-executors.ts › runCreatureGeneration › nodeRun.failedToCheckJobStatus":
    STATUS_READ,
  "components/editor/workflow-editor/asset-executors.ts › runFaceGeneration › nodeRun.failedToCheckJobStatus":
    STATUS_READ,
  "components/editor/workflow-editor/asset-executors.ts › runLocationGeneration › nodeRun.failedToCheckJobStatus":
    STATUS_READ,
  "components/editor/workflow-editor/asset-executors.ts › runObjectGeneration › nodeRun.failedToCheckJobStatus":
    STATUS_READ,
  "components/editor/workflow-editor/continue-failed-run.ts › handleContinueFailedRun › run.failedToStartExecution":
    WHOLE_RUN,
  "components/editor/workflow-editor/execute-node.ts › audio-sync › nodeRun.failedToCheckAudioSync":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › camera-switch › marks failed":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › composite › marks failed":
    "the composition is built in the browser: no server call can refuse it",
  "components/editor/workflow-editor/execute-node.ts › edit-plan › nodeRun.failedToCheckEditPlan":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › extract-field › marks failed":
    "parses JSON in the browser: no server call can refuse it",
  "components/editor/workflow-editor/execute-node.ts › forced-alignment › nodeRun.failedToCheckAlignmentStatus":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › generate-mask › nodeRun.failedToCheckGenerateMask":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › generate-video-pro › nodeRun.failedToCheckPlanningStatus":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › reference-sheet › nodeRunText(sheetData.label, msg)":
    "only the missing-main-image requirement, matched by its words; every other stage-A failure falls through to stage B, whose start the poll lane checks",
  "components/editor/workflow-editor/execute-node.ts › silence-detect › nodeRun.failedToCheckSilenceDetect":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › split-media › marks failed":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › suno-generate › nodeRun.noPromptFound":
    "assembling the request in the browser (no prompt set): no server call has been made",
  "components/editor/workflow-editor/execute-node.ts › suno-lyrics › nodeRun.failedToCheckLyricsStatus":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › transcribe › nodeRun.failedToCheckTranscriptionStatus":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › video-analysis › nodeRun.failedToCheckVideoAnalysis":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › video-audit › nodeRun.failedToCheckAIAudit":
    STATUS_READ,
  "components/editor/workflow-editor/execute-node.ts › video-sfx › nodeRun.videoSFXFailed":
    "its jobs already started: this catch follows their polls, and a refusal at their start went through the poll lane's check",
  "components/editor/workflow-editor/node-executors.ts › runLottiePlanGeneration › nodeRun.failedToCheckLottieGeneration":
    STATUS_READ,
  "components/editor/workflow-editor/node-executors.ts › runScriptGeneration › nodeRun.failedToCheckScriptGeneration":
    STATUS_READ,
  "components/editor/workflow-editor/poll-job.ts › pollImageRefineToNode › nodeRun.failedToCheckStatus":
    STATUS_READ,
  "components/editor/workflow-editor/poll-job.ts › pollImageRefineToNode › nodeRun.failedToStart":
    "a refine action inside a node (the reference board): it has no execution context and mounts no dialog — not a node's Run",
  "components/editor/workflow-editor/poll-job.ts › pollJobWithNodeUpdate › nodeRun.failedToCheckStatus":
    STATUS_READ,
  "components/editor/workflow-editor/render-final-handler.ts › handleRenderFinal › run.failedToStartExecution":
    WHOLE_RUN,
  "components/editor/workflow-editor/run-handlers.ts › confirmRunOrAbort › error.message":
    "only the sequence-execution refusal (SequenceExecutionRequiredError), checked in the browser before any start",
  "components/editor/workflow-editor/run-handlers.ts › handleRun › run.failedToStartWorkflow":
    WHOLE_RUN,
  "components/editor/workflow-editor/run-handlers.ts › handleRunSingleNode › run.connectNodaroToRun":
    "only the Connect-Nodaro refusal (NodaroConnectionRequiredError); a blocking refusal was already answered inside the node's executor",
  "components/editor/workflow-editor/run-handlers.ts › pollOnce › run.backendNoLongerExists":
    "a whole run's status read (getWorkflowExecution): no refusal comes from reading it",
  "components/editor/workflow-editor/run-handlers.ts › pollOnce › run.backendNoLongerExists #2":
    "a whole run's status read (getWorkflowExecution): no refusal comes from reading it",
  "components/editor/workflow-editor/run-handlers.ts › restorePollingForRunningJobs › marks failed":
    STATUS_READ,
  "components/editor/workflow-editor/run-handlers.ts › startSubsetRun › run.failedToStartExecution":
    WHOLE_RUN,
  "components/editor/workflow-editor/scene3d-execution.ts › runScene3DJob › nodeRun.failedToCheckStatus":
    STATUS_READ,
  "components/editor/workflow-editor/speaker-frames-executor.ts › executeSpeakerFrames › nodeRun.speakerFramesFailed":
    STATUS_READ,
  "components/editor/workflow-editor/sub-workflow-executor.ts › executeSubWorkflow › marks failed":
    "marks the parent failed after a child's run: each child is executed by executeNode, whose own catch already asked the check",
  "components/editor/workflow-editor/use-case-render-final.ts › runUseCaseRenderFinal › run.failedToStartExecution":
    WHOLE_RUN,
  "components/editor/workflow-editor/video-link-run-gate.ts › ensureVideoLinksBeforeRun › run.failedToStartExecution":
    "the linked-video fetch before a run: its failures come back as download codes, and this catch binds no error at all",
}

function executorSources(): Array<{ readonly name: string; readonly text: string }> {
  const editor = fs.readdirSync(EDITOR).filter((n) => n.endsWith(".ts")).map((n) => path.join(EDITOR, n))
  const units = fs.readdirSync(NODES)
    .map((d) => path.join(NODES, d, "exec.ts"))
    .filter((f) => fs.existsSync(f))
  return [...editor, ...units].map((f) => ({ name: path.relative(SRC, f), text: fs.readFileSync(f, "utf8") }))
}

const isToastError = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === "error" &&
  ts.isIdentifier(node.expression.expression) &&
  TOASTS.has(node.expression.expression.text)

const isCheck = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && CHECKS.has(node.expression.text)

/** Marks the node failed: `{ executionStatus: "failed", … }`. */
const isFailureMark = (node: ts.Node): boolean =>
  ts.isPropertyAssignment(node) &&
  node.name.getText() === "executionStatus" &&
  ts.isStringLiteral(node.initializer) &&
  node.initializer.text === "failed"

/** The first string literal in the toast's arguments: its message key. */
function messageKey(call: ts.CallExpression): string {
  let key: string | undefined
  const visit = (n: ts.Node) => {
    if (key !== undefined) return
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      key = n.text
      return
    }
    ts.forEachChild(n, visit)
  }
  call.arguments.forEach(visit)
  return key ?? call.arguments[0]?.getText() ?? "(no argument)"
}

/** The body of every catch: `catch (err) { … }` and `.catch((err) => …)`. */
function catchBodies(source: ts.SourceFile): ts.Node[] {
  const bodies: ts.Node[] = []
  const visit = (node: ts.Node) => {
    if (ts.isCatchClause(node)) bodies.push(node.block)
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "catch"
    ) {
      const handler = node.arguments[0]
      if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) bodies.push(handler.body)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return bodies
}

/** The node type (`if (node.type === "…")`) or the function a catch sits in — a key that survives line moves. */
function scopeOf(node: ts.Node): string {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    if (ts.isIfStatement(n)) {
      const m = /\.type === "([^"]+)"/.exec(n.expression.getText())
      if (m) return m[1]!
    }
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText()
    if (ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) return n.name.getText()
  }
  return "(module)"
}

const unwrap = (e: ts.Expression): ts.Expression =>
  ts.isParenthesizedExpression(e) || ts.isAwaitExpression(e) ? unwrap(e.expression) : e

/** Is `expr` the check's answer itself: the call, or a `const` the catch bound to the call? */
function isAnswer(expr: ts.Expression, answers: ReadonlySet<string>): boolean {
  const e = unwrap(expr)
  return isCheck(e) || (ts.isIdentifier(e) && answers.has(e.text))
}

/**
 * Knowing `cond` came out truthy (`truthy`) or falsy, is the check's answer
 * certainly false — no dialog opened? Classifies the answer itself, `!`, `&&`,
 * `||` and parentheses; any other expression proves nothing (false), so a
 * toast it guards fails.
 */
function provesNoDialog(cond: ts.Expression, truthy: boolean, answers: ReadonlySet<string>): boolean {
  const e = unwrap(cond)
  if (isAnswer(e, answers)) return !truthy
  if (ts.isPrefixUnaryExpression(e) && e.operator === ts.SyntaxKind.ExclamationToken) return provesNoDialog(e.operand, !truthy, answers)
  if (ts.isBinaryExpression(e)) {
    const a = (t: boolean) => provesNoDialog(e.left, t, answers)
    const b = (t: boolean) => provesNoDialog(e.right, t, answers)
    if (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      // Truthy: both were. Falsy: the left was, or the left was truthy and the right falsy.
      return truthy ? a(true) || b(true) : a(false) && (a(true) || b(false))
    }
    if (e.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
      // Falsy: both were. Truthy: the left was, or the left was falsy and the right truthy.
      return truthy ? a(true) && (a(false) || b(true)) : a(false) || b(false)
    }
  }
  return false
}

/** A statement that always leaves: `return`, `throw`, or a block that ends in one. */
function alwaysExits(stmt: ts.Statement): boolean {
  if (ts.isReturnStatement(stmt) || ts.isThrowStatement(stmt)) return true
  if (ts.isBlock(stmt)) {
    const last = stmt.statements[stmt.statements.length - 1]
    return last !== undefined && alwaysExits(last)
  }
  return false
}

/** Is the toast reachable only when the check answered false (no dialog opened)? */
function guardedByAnswer(toast: ts.Node, body: ts.Node, answers: ReadonlySet<string>): boolean {
  let child: ts.Node = toast
  for (let n = toast.parent; n; child = n, n = n.parent) {
    if (ts.isIfStatement(n)) {
      if (child === n.thenStatement && provesNoDialog(n.expression, true, answers)) return true
      if (child === n.elseStatement && provesNoDialog(n.expression, false, answers)) return true
    }
    if (ts.isConditionalExpression(n)) {
      if (child === n.whenTrue && provesNoDialog(n.condition, true, answers)) return true
      if (child === n.whenFalse && provesNoDialog(n.condition, false, answers)) return true
    }
    if (ts.isBinaryExpression(n) && child === n.right) {
      if (n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && provesNoDialog(n.left, true, answers)) return true
      if (n.operatorToken.kind === ts.SyntaxKind.BarBarToken && provesNoDialog(n.left, false, answers)) return true
    }
    // An earlier `if (answer) return | throw` (no else) in the same block: reaching the toast proves it answered false.
    if (ts.isBlock(n)) {
      const at = n.statements.indexOf(child as ts.Statement)
      for (const prior of n.statements.slice(0, Math.max(at, 0))) {
        if (ts.isIfStatement(prior) && !prior.elseStatement && alwaysExits(prior.thenStatement) && provesNoDialog(prior.expression, false, answers)) return true
      }
    }
    if (n === body) break
  }
  return false
}

/**
 * Every catch that fails a node's run without the check deciding, as
 * `file › node type or function › what it does`.
 */
function failuresWithoutCheck(sources: ReadonlyArray<{ readonly name: string; readonly text: string }>): string[] {
  const found: string[] = []
  for (const { name, text } of sources) {
    const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
    for (const body of catchBodies(source)) {
      let asked = false
      let marksFailed = false
      const answers = new Set<string>()
      const declared = new Map<string, number>()
      const toasts: ts.CallExpression[] = []
      const visit = (n: ts.Node) => {
        if (isCheck(n)) asked = true
        // `const taken = checkStorageError(err, ctx)` — later read as the answer (only a const bound to the call itself).
        if (
          ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer &&
          (n.parent.flags & ts.NodeFlags.Const) !== 0 && isAnswer(n.initializer, answers)
        ) answers.add(n.name.text)
        // Every name the catch declares, counted: one declared twice (a shadow) is no answer.
        if ((ts.isVariableDeclaration(n) || ts.isParameter(n)) && ts.isIdentifier(n.name)) declared.set(n.name.text, (declared.get(n.name.text) ?? 0) + 1)
        if (isToastError(n)) toasts.push(n)
        if (isFailureMark(n)) marksFailed = true
        ts.forEachChild(n, visit)
      }
      visit(body)
      for (const [name, count] of declared) if (count > 1) answers.delete(name)
      const scope = scopeOf(body)
      for (const t of toasts) {
        if (!guardedByAnswer(t, body, answers)) found.push(`${name} › ${scope} › ${messageKey(t)}`)
      }
      if (marksFailed && toasts.length === 0 && !asked) found.push(`${name} › ${scope} › marks failed`)
    }
  }
  // Two alike catches in one scope are told apart by their order there.
  const seen = new Map<string, number>()
  return found.map((k) => {
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return n === 1 ? k : `${k} #${n}`
  }).sort()
}

describe("a node executor's run-failure toast is decided by the blocking-dialog check's answer", () => {
  const found = failuresWithoutCheck(executorSources())

  it("no catch toasts a failure the check's answer does not decide, unless it is listed with its reason", () => {
    expect(found.filter((k) => !Object.hasOwn(PLAIN_TOAST, k))).toEqual([])
  })

  it("every listed plain toast still exists (the list only names live catches)", () => {
    expect(Object.keys(PLAIN_TOAST).filter((k) => !found.includes(k))).toEqual([])
  })
})

/** The guard's own cases: planted catches it must judge right. */
describe("the guard itself", () => {
  const judge = (text: string) => failuresWithoutCheck([{ name: "planted.ts", text }])

  it("an error toast with no check at all fails", () => {
    expect(judge(`function run(ctx) { start().catch((err) => { toast.error("plant.noCheck"); throw err }) }`)).toEqual([
      "planted.ts › run › plant.noCheck",
    ])
  })

  it("the check asked and its answer ignored fails", () => {
    expect(judge(`function run(ctx) { start().catch((err) => { checkStorageError(err, ctx); guardedToast.error("plant.ignored"); throw err }) }`)).toEqual([
      "planted.ts › run › plant.ignored",
    ])
    expect(judge(`async function run(ctx) { try { await start() } catch (err) { const taken = promptCreditsShortfall(err, ctx); toast.error("plant.boundIgnored") } }`)).toEqual([
      "planted.ts › run › plant.boundIgnored",
    ])
  })

  it("the check's answer deciding the toast passes, however it is read", () => {
    expect(judge(`function run(ctx) { start().catch((err) => { if (!checkStorageError(err, ctx)) guardedToast.error("plant.if"); throw err }) }`)).toEqual([])
    expect(judge(`async function run(ctx) { try { await start() } catch (err) { const taken = promptCreditsShortfall(err, ctx); if (!taken) { toast.error("plant.bound") } } }`)).toEqual([])
    expect(judge(`function run(ctx) { start().catch((err) => { promptCreditsShortfall(err, ctx) || toast.error("plant.or") }) }`)).toEqual([])
  })

  /** A catch body with the check's call standing for `X`, judged on its own. */
  const shape = (body: string) => judge(`async function run(ctx) { try { await start() } catch (err) { ${body.replaceAll("X", "checkStorageError(err, ctx)")} } }`)

  it("a toast shown only when the dialog DID open fails (the answer read the wrong way)", () => {
    expect(shape(`if (X) toast.error("plant.ifTrue")`)).toEqual(["planted.ts › run › plant.ifTrue"])
    expect(shape(`X && toast.error("plant.andTrue")`)).toEqual(["planted.ts › run › plant.andTrue"])
    expect(shape(`if (!X) { update() } else { toast.error("plant.elseOfNot") }`)).toEqual(["planted.ts › run › plant.elseOfNot"])
    expect(shape(`if (X || true) toast.error("plant.orTrue")`)).toEqual(["planted.ts › run › plant.orTrue"])
    expect(shape(`if (!X) return; toast.error("plant.exitOnNot")`)).toEqual(["planted.ts › run › plant.exitOnNot"])
    expect(shape(`const taken = X; if (taken) toast.error("plant.boundTrue")`)).toEqual(["planted.ts › run › plant.boundTrue"])
  })

  it("toasts in both arms of a ternary: the arm the dialog opened on fails, the other passes", () => {
    expect(shape(`X ? toast.error("plant.armTrue") : toast.error("plant.armFalse")`)).toEqual(["planted.ts › run › plant.armTrue"])
  })

  it("the early exit when the dialog opened passes, with return or throw", () => {
    expect(shape(`if (X) return; toast.error("plant.exitReturn")`)).toEqual([])
    expect(shape(`if (X) throw err; toast.error("plant.exitThrow")`)).toEqual([])
    expect(shape(`if (X) { update(); return } guardedToast.error("plant.exitBlock")`)).toEqual([])
    expect(shape(`const taken = X; if (taken) return; toast.error("plant.exitBound")`)).toEqual([])
  })

  it("the other ways of showing it only when the answer is false pass", () => {
    expect(shape(`X ? update() : toast.error("plant.armElse")`)).toEqual([])
    expect(shape(`!X ? toast.error("plant.notArm") : update()`)).toEqual([])
    expect(shape(`!X && toast.error("plant.notAnd")`)).toEqual([])
    expect(shape(`if (X) { update() } else { toast.error("plant.elseOfX") }`)).toEqual([])
    expect(shape(`if (!X) { if (policy) { toast.warning("w") } else { toast.error("plant.nested") } }`)).toEqual([])
  })

  it("the answer is bound only through a const in the catch: a reassigned let or a shadowing name fails", () => {
    expect(shape(`let taken = X; taken = false; if (!taken) toast.error("plant.let")`)).toEqual(["planted.ts › run › plant.let"])
    expect(shape(`const taken = X; if (other) { const taken = false; if (!taken) toast.error("plant.shadow") }`)).toEqual(["planted.ts › run › plant.shadow"])
    expect(shape(`const taken = X; items.forEach((taken) => { if (!taken) toast.error("plant.param") })`)).toEqual(["planted.ts › run › plant.param"])
  })

  it("a condition it cannot classify fails rather than passes", () => {
    expect(shape(`if (X === false) toast.error("plant.compared")`)).toEqual(["planted.ts › run › plant.compared"])
  })

  it("a catch that only marks the node failed must ask the check, and may discard its answer", () => {
    expect(judge(`function run(ctx) { start().catch((err) => { update({ executionStatus: "failed" }); throw err }) }`)).toEqual([
      "planted.ts › run › marks failed",
    ])
    expect(judge(`function run(ctx) { start().catch((err) => { update({ executionStatus: "failed" }); promptCreditsShortfall(err, ctx); throw err }) }`)).toEqual([])
  })
})
