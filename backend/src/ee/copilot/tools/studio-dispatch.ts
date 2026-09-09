/**
 * The studio branch of the dispatcher: what happens instead of doing it.
 *
 * On the canvas a tool call is a tool call. In the studio editor the person is
 * looking at their film while the copilot works on it, so nothing here writes
 * to the production, publishes it, copies it, imports into it, exports it or
 * spends a credit: every one of those ends the turn as a PROPOSAL, and a
 * person presses Apply in the editor. That is the whole of this file.
 *
 * Three properties hold by construction, and each is a test:
 *
 *  - **One proposal per assistant message.** The loop keeps the last proposal
 *    of a message, so a second one would replace the card the person is about
 *    to read. The second call is refused, and nothing is called for it.
 *  - **A change is previewed, never written.** A document write goes out to
 *    `POST /v1/studio/productions/:id/ops` as a preview through
 *    `edit_studio_production`, and what comes back — the receipts, whether
 *    each delete named the bin entry it made, whether the batch touches
 *    anything beyond the document — is what the card shows. Every failure of
 *    that call reaches the model as TEXT and nothing is retried; a preview
 *    that turns out to be unavailable latches, so a second write in the same
 *    turn is refused without a call.
 *  - **A price is asked for, never assumed.** A spending tool whose schema
 *    says it can be quoted is called for its quote; one that cannot be quoted
 *    is proposed from its arguments alone and is NEVER called with the preview
 *    flag — the tools that pin that flag to false reject it.
 *
 * Classification is not by name. A tool's confirmation mark and its
 * quotability are read at list time from what the server served, and the
 * operations inside a batch are classed by the preview's own receipts. A
 * nineteenth tool therefore cannot slip through as free, and a vocabulary that
 * grows does not need an edit here.
 */
import { randomUUID } from "node:crypto"
import type { McpToolCallResult } from "../../../lib/mcp/invoke.js"
import type { StudioConfirmClass } from "../../../lib/mcp/tools/_studio-helpers.js"
import {
  computedArgsFor,
  isQuotable,
  toDefinition,
  STUDIO_EDIT_TOOL,
  STUDIO_NATIVE_TOOLS,
  STUDIO_PROPOSE_WITHOUT_MARK,
  type CopilotSurfaceProfile,
} from "../surfaces.js"
import type { DispatchDeps } from "./registry.js"
import type {
  ActionProposal,
  ActionProposalKind,
  EditPreview,
  ExportPreview,
  ImportPreview,
  RunPreview,
  StudioOpsDryRunReceipt,
  StudioTurnState,
} from "./types.js"

export type { StudioTurnState }

/**
 * What one studio tool call comes back as.
 *
 * The same shape the shared dispatcher returns, with this surface's own kind
 * of proposal on it: an action a person confirms in the editor rather than a
 * run they approve on the canvas. The two meet where the loop's proposal type
 * widens to carry both — the step that wires this branch into the shared
 * dispatcher.
 */
export interface StudioToolOutcome {
  /** Text handed back to the model (wrapped as untrusted by the caller). */
  text: string
  isError: boolean
  /** Set when the turn must stop: the person decides in the editor. */
  proposal?: ActionProposal
  /** Short human label detail for the activity row. */
  summary?: string
}

/**
 * How many changes a batch may carry and still be small enough for the editor
 * to confirm on the person's standing behalf. Past it the card waits for a
 * press however harmless each operation is: twenty edits are a review, not a
 * glance.
 */
export const STUDIO_SAFE_BATCH_MAX_OPS = 20

/** The refusal that says a preview could not be taken — nothing was sent. */
const PREVIEW_UNAVAILABLE_CODE = "studio_preview_unavailable"

const ONE_PER_MESSAGE =
  "One change per message; the first is the one the person will see. Say what else you would do and wait for their answer."

const PREVIEW_UNAVAILABLE_TEXT =
  "This production cannot be changed from here right now: the change could not be previewed, so nothing was sent. " +
  "Tell the person the studio service needs an update before you can change their production, and propose nothing else this turn."

// ── the entry point ─────────────────────────────────────────────────────────

/**
 * Handle one tool call on the studio surface.
 *
 * Returns `null` for everything this branch does not own — a free read, a
 * shared native, a name that is not on this surface at all, and every call on
 * the canvas — so the ordinary dispatch path handles or refuses it exactly as
 * it does today.
 */
export async function dispatchStudioTool(
  deps: DispatchDeps,
  name: string,
  rawArgs: unknown,
): Promise<StudioToolOutcome | null> {
  const profile = deps.surface
  if (!profile || profile.surface !== "studio") return null

  const isExport = name === STUDIO_NATIVE_TOOLS.exportProduction
  // A native this surface declares and does not propose (the memory tool) is
  // the ordinary path's: it writes a preference, never the document.
  if (!isExport && profile.nativeTools.has(name)) return null
  if (!isExport && !profile.mcpAllowlist.has(name)) return null
  if (profile.freeTools.has(name)) return null

  // Past here every name changes the person's work or spends their credits.
  const state = deps.studio
  if (!state) {
    return refuse(`"${name}" changes the person's work, so it has to be proposed — and this conversation cannot propose.`)
  }
  if (state.proposed) return refuse(ONE_PER_MESSAGE)

  const confirm = state.tools.confirmClasses.get(name) ?? null
  const args = modelArgs(profile, rawArgs, name, confirm)

  if (name === STUDIO_EDIT_TOOL) return await proposeEdit(deps, profile, state, name, args)
  if (isExport) return await proposeExport(deps, profile, state, name, args)
  if (confirm === "$") return await proposeSpend(deps, profile, state, name, args)
  if (confirm === "P") return proposeVisibility(state, name, args)
  if (STUDIO_PROPOSE_WITHOUT_MARK.has(name)) {
    if (name === "import_studio_production") return await proposeImport(deps, profile, state, name, args)
    return propose(state, { kind: "clone", tool: name, args, preview: null })
  }

  // Nothing reaches this line today: a tool is free, marked, previewed, or on
  // the propose-anyway list, and a partition test refuses a surface where that
  // is not true. If one ever does, it is a tool nobody classified — which is
  // the one case that must not be treated as free.
  return refuse(
    `"${name}" has no confirmation class in this conversation, so it cannot be called or proposed. Tell the person what you wanted to do.`,
  )
}

// ── the document write ──────────────────────────────────────────────────────

async function proposeEdit(
  deps: DispatchDeps,
  profile: CopilotSurfaceProfile,
  state: StudioTurnState,
  name: string,
  args: Record<string, unknown>,
): Promise<StudioToolOutcome> {
  if (state.previewUnavailable) return refuse(PREVIEW_UNAVAILABLE_TEXT)

  // Fail closed BEFORE the call. A tool that does not offer the preview flag
  // would have the flag dropped and the batch applied — the one thing this
  // surface may never do — so a surface that cannot preview cannot write.
  if (!(await offersPreview(deps, state, name))) {
    state.previewUnavailable = true
    return refuse(PREVIEW_UNAVAILABLE_TEXT)
  }

  const result = await callTool(deps, profile, name, { ...args, dry_run: true })
  if (result.isError) {
    if (errorCodeOf(result) === PREVIEW_UNAVAILABLE_CODE) state.previewUnavailable = true
    return { text: textOf(result), isError: true }
  }

  const envelope = structuredOf(result)
  if (envelope?.dryRun !== true) {
    // The answer is not a preview. Whatever it is, it is not something to
    // offer as one — and the rest of the turn stops writing.
    state.previewUnavailable = true
    return refuse(PREVIEW_UNAVAILABLE_TEXT)
  }

  const receipts = Array.isArray(envelope.receipts) ? (envelope.receipts as StudioOpsDryRunReceipt[]) : []
  const preview: EditPreview = {
    version: typeof envelope.version === "number" ? envelope.version : 0,
    receipts,
    warnings: stringList(envelope.warnings),
  }
  return propose(state, {
    kind: "edit",
    tool: name,
    args,
    preview,
    // A delete is takeable-back only when it named the bin entry it made. One
    // that did not is why the whole batch is marked irreversible: the card
    // must not offer an undo it cannot perform.
    restorable: receipts.every((r) => r.class !== "D" || r.restorable === true),
    safe: receipts.every((r) => r.class === "S") && receipts.length <= STUDIO_SAFE_BATCH_MAX_OPS,
  })
}

/**
 * Does the served tool actually take a preview flag?
 *
 * The same derivation the price check uses, over the schema the server
 * renders: a plain boolean flag can be set to true, a pinned or missing one
 * cannot. Read once per turn.
 */
async function offersPreview(deps: DispatchDeps, state: StudioTurnState, name: string): Promise<boolean> {
  if (state.previewOffered !== undefined) return state.previewOffered
  const served = (await deps.invoker.listTools()).find((tool) => tool.name === name)
  const offered = served ? isQuotable(toDefinition(served)) : false
  state.previewOffered = offered
  return offered
}

// ── what spends ─────────────────────────────────────────────────────────────

async function proposeSpend(
  deps: DispatchDeps,
  profile: CopilotSurfaceProfile,
  state: StudioTurnState,
  name: string,
  args: Record<string, unknown>,
): Promise<StudioToolOutcome> {
  // Not quotable: propose from the arguments alone, and never send the flag —
  // these tools reject it, and asking again would only cost a refusal.
  if (!state.tools.quotable.has(name)) {
    return propose(state, { kind: "run", tool: name, args, preview: null })
  }

  const result = await callTool(deps, profile, name, { ...args, dry_run: true })
  if (result.isError) return { text: textOf(result), isError: true }

  const quote = structuredOf(result)
  if (quote?.dryRun !== true) {
    return refuse(
      "That did not come back as a price. Say what you were about to run, and let the person start it from the editor.",
    )
  }
  const preview: RunPreview = {
    provider: typeof quote.provider === "string" ? quote.provider : "",
    count: typeof quote.count === "number" ? quote.count : 1,
    credits: typeof quote.credits === "number" ? quote.credits : null,
    ...(typeof quote.lane === "string" ? { lane: quote.lane } : {}),
    ...(isRecord(quote.linkedQuote) ? { linkedQuote: quote.linkedQuote } : {}),
  }
  return propose(state, { kind: "run", tool: name, args, preview })
}

// ── who can reach the work ──────────────────────────────────────────────────

function proposeVisibility(state: StudioTurnState, name: string, args: Record<string, unknown>): StudioToolOutcome {
  if (typeof args.shared !== "boolean") {
    return refuse("Say which way this should go — shared or private — and call it again.")
  }
  return propose(state, { kind: "publish", tool: name, args, preview: null })
}

// ── importing ───────────────────────────────────────────────────────────────

async function proposeImport(
  deps: DispatchDeps,
  profile: CopilotSurfaceProfile,
  state: StudioTurnState,
  name: string,
  args: Record<string, unknown>,
): Promise<StudioToolOutcome> {
  if (isRecord(args.plan)) {
    // Free, and it belongs here rather than on the card: a plan that does not
    // validate is the model's to fix, not the person's to decide about.
    const result = await callTool(deps, profile, "validate_studio_plan", { plan: args.plan })
    if (result.isError) return { text: textOf(result), isError: true }

    const answer = structuredOf(result)
    if (answer?.valid !== true) {
      const errors = stringList(answer?.errors)
      return refuse(
        `That plan is not valid, so nothing was offered to the person. Fix it and call again: ${errors.join("; ") || "no detail was given"}`,
      )
    }
    const preview: ImportPreview = {
      valid: true,
      summary: answer.summary ?? null,
      warnings: stringList(answer.warnings),
    }
    return propose(state, { kind: "import", tool: name, args, preview })
  }

  if (typeof args.plan_job_id === "string" && args.plan_job_id.length > 0) {
    // The plan is still a job's output; the editor reads it at Apply.
    return propose(state, { kind: "import", tool: name, args, preview: null })
  }

  return refuse("Say what to import: either the plan itself, or the id of the job that wrote it.")
}

// ── exporting ───────────────────────────────────────────────────────────────

async function proposeExport(
  deps: DispatchDeps,
  profile: CopilotSurfaceProfile,
  state: StudioTurnState,
  name: string,
  args: Record<string, unknown>,
): Promise<StudioToolOutcome> {
  // The steps and their prices are free to ask for, and the card is the whole
  // chain: the person presses Export once and the finished cut is recorded.
  const result = await callTool(deps, profile, "plan_studio_export", args)
  if (result.isError) return { text: textOf(result), isError: true }

  const plan = structuredOf(result)
  if (plan?.canExport !== true) {
    return refuse(
      "There is nothing to export yet — this production needs at least two takes to stitch. Tell the person what is missing.",
    )
  }
  const steps = Array.isArray(plan.steps) ? plan.steps : []
  const preview: ExportPreview = {
    canExport: true,
    resultStepId: typeof plan.resultStepId === "string" ? plan.resultStepId : null,
    estimate: typeof plan.estimate === "number" ? plan.estimate : null,
    unpriced: stringList(plan.unpriced),
    steps: steps.filter(isRecord).map((step) => ({
      id: String(step.id ?? ""),
      node: String(step.node ?? ""),
      label: String(step.label ?? ""),
      credits: typeof step.credits === "number" ? step.credits : null,
    })),
  }
  return propose(state, { kind: "export", tool: name, args, preview })
}

// ── the shared parts ────────────────────────────────────────────────────────

interface ProposalDraft {
  kind: ActionProposalKind
  tool: string
  args: Record<string, unknown>
  preview: ActionProposal["preview"]
  restorable?: boolean
  safe?: boolean
}

/**
 * Mint the proposal and end the turn with it.
 *
 * The text is what the TRANSCRIPT keeps: the model does not read it in the
 * message that proposed — the turn ends here and the person's decision is
 * their next message — but the next turn is written against it.
 */
function propose(state: StudioTurnState, draft: ProposalDraft): StudioToolOutcome {
  const proposal: ActionProposal = {
    id: randomUUID(),
    kind: draft.kind,
    tool: draft.tool,
    args: draft.args,
    preview: draft.preview,
    restorable: draft.restorable ?? false,
    safe: draft.safe ?? false,
    note: null,
  }
  state.proposed = true
  return {
    text: `Offered to the person; they decide in the editor and the outcome arrives in their next message.\n${JSON.stringify(
      { kind: proposal.kind, tool: proposal.tool, preview: proposal.preview ?? proposal.args },
      null,
      2,
    )}`,
    isError: false,
    proposal,
    summary: `proposed ${proposal.kind}`,
  }
}

function refuse(text: string): StudioToolOutcome {
  return { text, isError: true }
}

/**
 * The model's own arguments, less everything this surface decides for itself
 * and the id it pins. What is left is what the card offers, so an argument the
 * person never sees cannot ride along with it.
 */
function modelArgs(
  profile: CopilotSurfaceProfile,
  rawArgs: unknown,
  name: string,
  confirm: StudioConfirmClass | null,
): Record<string, unknown> {
  const args = { ...((rawArgs ?? {}) as Record<string, unknown>) }
  for (const key of computedArgsFor(profile, name, confirm)) delete args[key]
  for (const key of Object.keys(profile.forcedIdArg(""))) delete args[key]
  return args
}

/** Order is the enforcement: the model's args, then what the tool pins, then the id. */
function callTool(
  deps: DispatchDeps,
  profile: CopilotSurfaceProfile,
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolCallResult> {
  return deps.invoker.callTool(name, {
    ...args,
    ...(profile.forcedArgs[name] ?? {}),
    ...profile.forcedIdArg(deps.ctx.workflowId),
  })
}

function textOf(result: McpToolCallResult): string {
  const text = result.content
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
  return text || "(no output)"
}

function structuredOf(result: McpToolCallResult): Record<string, unknown> | null {
  return isRecord(result.structuredContent) ? result.structuredContent : null
}

/**
 * The code a refusal carries.
 *
 * A refusal is rendered for the model as prose that names its status and code;
 * the structured half is not sent with it. Both are read here so the answer to
 * "which refusal was that" does not depend on which one a tool happened to
 * send.
 */
const RENDERED_CODE = /\((\d{3})\s+([a-z][a-z0-9_]*)\)/

function errorCodeOf(result: McpToolCallResult): string | null {
  const structured = structuredOf(result)
  const code = isRecord(structured?.error) ? structured.error.code : undefined
  if (typeof code === "string") return code
  return RENDERED_CODE.exec(textOf(result))?.[2] ?? null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
