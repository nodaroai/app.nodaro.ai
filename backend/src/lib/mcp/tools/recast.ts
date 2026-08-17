import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { errorResult, uiMeta } from "./_verb-helpers.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import { config } from "../../config.js"
import { supabase } from "../../supabase.js"

/**
 * RECAST AUTHORED-SCRIPT VERBS (spec 2026-08-06 §5 — P2).
 *
 * The MCP movie-making lane: an LLM authors a screenplay-shaped script JSON,
 * validates it for free, imports it as a REAL recast project (visible and
 * resumable in recast.nodaro.ai — the parked-run machinery and the app's
 * watcher own abandoned conversations), then renders it with prices surfaced
 * before every spend.
 *
 * Wire strategy: every mutation goes through the SAME platform routes the app
 * uses (`fastify.inject` + the internal-orchestrator secret; GETs carry the
 * user via `x-internal-user-id` — see middleware/auth.ts). Reads that need no
 * route logic go straight to supabase scoped by `session.userId`, the
 * `tools/jobs.ts` pattern.
 *
 * Cloud-only: registered behind `hasCredits()` in server.ts — the routes these
 * verbs call live in the cloud plugin and 404 off-cloud.
 */

const readGate: ToolGate = { required: ["workflows:read"] }
const writeGate: ToolGate = { required: ["workflows:write"] }
const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterRecastToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/** The recast APP's per-user project — the SAME name the app uses
 *  (`recast-project.ts` RECAST_PROJECT_NAME), which is exactly what makes
 *  MCP-created recasts appear on the recast.nodaro.ai dashboard. Oldest-first
 *  + id tiebreak mirrors `_mcp-project.ts` so concurrent creators converge. */
const RECAST_PROJECT_NAME = "Recast"

/** The recast client app's origin, derived from this deployment's own public
 *  URL (fleet convention: staging is `next.<domain>`). Prod fallback. */
function recastAppOrigin(): string {
  return config.PUBLIC_URL.includes("next.") ? "https://next.recast.nodaro.ai" : "https://recast.nodaro.ai"
}

function internalHeaders(userId: string): Record<string, string> {
  return {
    "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET,
    "x-internal-user-id": userId,
  }
}

function textResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  }
}

async function ensureRecastProject(userId: string): Promise<string> {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("name", RECAST_PROJECT_NAME)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle()
  if (data?.id) return data.id as string
  const { data: created, error } = await supabase
    .from("projects")
    .insert({ user_id: userId, name: RECAST_PROJECT_NAME, settings: { recast: {} } })
    .select("id")
    .single()
  if (error || !created) throw new Error(`Failed to create Recast project: ${error?.message ?? "unknown"}`)
  return created.id as string
}

/** The workflow's `settings.recast` document, read raw (the app's own persist
 *  discipline — never strip-parse a settings blob you don't own). */
async function readRecastSettings(
  workflowId: string,
  userId: string,
): Promise<{ settings: Record<string, unknown>; recast: Record<string, unknown> } | null> {
  const { data } = await supabase
    .from("workflows")
    .select("id, user_id, settings")
    .eq("id", workflowId)
    .eq("user_id", userId)
    .maybeSingle()
  if (!data) return null
  const settings = (data.settings ?? {}) as Record<string, unknown>
  const recast = (settings.recast ?? {}) as Record<string, unknown>
  return { settings, recast }
}

async function patchRecastSettings(
  fastify: FastifyInstance,
  userId: string,
  workflowId: string,
  settings: Record<string, unknown>,
): Promise<boolean> {
  const res = await fastify.inject({
    method: "PATCH",
    url: `/v1/workflows/${workflowId}`,
    headers: internalHeaders(userId),
    payload: { userId, settings },
  })
  return res.statusCode < 400
}

/** The interactive walk's server-owned `next` pointer (P3). */
interface InteractiveNext {
  kind: "candidates" | "plan" | "gate" | "dispatch" | "none"
  cycle?: number
  segment?: number
  section?: number
  expect?: { images: number }
  gate?: string
}

interface InteractiveState {
  phase?: string
  next?: InteractiveNext
  pendingGate?: unknown
  /** C7 sheet gate (2026-08-07 doctrine): opens after cast, before anchors. */
  pendingSheetGate?: unknown
  pendingAnchorGate?: unknown
  pendingMusicGate?: unknown
  cycle?: { n: number; state: string; error?: string }
}

/** The one open gate, in walk order (cast → sheet → anchors → music) — the
 *  plugin sends at most one pending* view at a time, so this is a lookup,
 *  not a tiebreak. */
function pendingGateOf(interactive: InteractiveState | undefined): unknown {
  return (
    interactive?.pendingGate ??
    interactive?.pendingSheetGate ??
    interactive?.pendingAnchorGate ??
    interactive?.pendingMusicGate
  )
}

/**
 * Advance an INTERACTIVE run one server-owned hop (spec §6): the snapshot's
 * `next` says whose turn it is — candidates/plan/dispatch hops are fired here
 * (all covered by the interactive quote consented at start_recast); a `gate`
 * stops the walk and is returned for the user to choose. One hop per call —
 * cycles run as async jobs anyway, and the widget/status polling carries the
 * conversation forward.
 */
async function advanceInteractive(
  fastify: FastifyInstance,
  userId: string,
  runId: string,
): Promise<{ status: string; interactive?: InteractiveState; fired?: string; error?: { statusCode: number; body: string } }> {
  const snap = await fastify.inject({ method: "GET", url: `/v1/recast/${runId}`, headers: internalHeaders(userId) })
  if (snap.statusCode >= 400) return { status: "unknown", error: { statusCode: snap.statusCode, body: snap.body } }
  const parsed = JSON.parse(snap.body) as { status: string; interactive?: InteractiveState }
  const next = parsed.interactive?.next
  if (!next || next.kind === "none" || next.kind === "gate") return { status: parsed.status, interactive: parsed.interactive }

  let fired: string | undefined
  if (next.kind === "candidates" && next.expect) {
    const res = await fastify.inject({
      method: "POST",
      url: `/v1/recast/${runId}/candidates`,
      headers: internalHeaders(userId),
      payload: {
        userId,
        cycle: next.cycle,
        ...(next.segment !== undefined ? { segment: next.segment } : {}),
        ...(next.section !== undefined ? { section: next.section } : {}),
        expect: next.expect,
      },
    })
    if (res.statusCode >= 400) return { status: parsed.status, interactive: parsed.interactive, error: { statusCode: res.statusCode, body: res.body } }
    fired = `candidates cycle ${next.cycle}`
  } else if (next.kind === "plan") {
    const res = await fastify.inject({ method: "POST", url: `/v1/recast/${runId}/plan`, headers: internalHeaders(userId), payload: { userId } })
    if (res.statusCode >= 400) return { status: parsed.status, interactive: parsed.interactive, error: { statusCode: res.statusCode, body: res.body } }
    fired = "plan"
  } else if (next.kind === "dispatch") {
    const res = await fastify.inject({ method: "POST", url: `/v1/recast/${runId}/dispatch`, headers: internalHeaders(userId), payload: { userId } })
    if (res.statusCode >= 400) return { status: parsed.status, interactive: parsed.interactive, error: { statusCode: res.statusCode, body: res.body } }
    fired = "dispatch"
  }
  return { status: parsed.status, interactive: parsed.interactive, fired }
}

export function registerRecastTools({ server, session, fastify }: RegisterRecastToolsOpts): void {
  // ── the authoring skill (ungated — discoverability is the point) ─────────
  server.registerTool(
    "get_recast_authoring_skill",
    {
      title: "Recast Authoring Skill",
      description:
        "The authoring guide for writing a MOVIE AS JSON — the preferred lane for " +
        "end-to-end \"make me a video/movie/ad of X\" requests. Returns generated " +
        "markdown: the screenplay document contract (meta/slots/scenes), the " +
        "planner's own field doctrine, enum vocabularies, bounds, audio rules, and " +
        "a validated worked example. Read it, author the script, then loop " +
        "`validate_recast_script` until valid and call `import_recast_script`.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const res = await fastify.inject({
        method: "GET",
        url: "/v1/video-analysis/authoring-skill",
        headers: internalHeaders(session.userId),
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      const parsed = JSON.parse(res.body) as { markdown?: string }
      return { content: [{ type: "text" as const, text: parsed.markdown ?? "" }] }
    },
  )

  // ── the free iterate loop (ungated — validation costs nothing) ───────────
  server.registerTool(
    "validate_recast_script",
    {
      title: "Validate Recast Script",
      description:
        "FREE validation of an authored script JSON (see " +
        "`get_recast_authoring_skill` for the format). Returns `{ valid, errors, " +
        "warnings }` — each error has `path`, `message`, and usually a `hint`; fix " +
        "them and call again until `valid: true`. Never charges credits and " +
        "persists nothing.",
      inputSchema: {
        script: z.record(z.string(), z.unknown()).describe("The authored script document (lean shape or a full exported analysis)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args) => {
      const res = await fastify.inject({
        method: "POST",
        url: "/v1/video-analysis/import/validate",
        headers: internalHeaders(session.userId),
        payload: { userId: session.userId, script: args.script },
      })
      if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
      return textResult(JSON.parse(res.body))
    },
  )

  // ── import (workflows:write) ─────────────────────────────────────────────
  if (passesGate(session, writeGate)) {
    server.registerTool(
      "import_recast_script",
      {
        title: "Import Recast Script",
        description:
          "Turn a VALIDATED authored script into a real recast project — visible at " +
          "recast.nodaro.ai, free to import. Creates the project + workflow, stores " +
          "the script as a completed analysis, and returns `{ recastId, jobId, " +
          "warnings, appUrl }`. Then quote and render it with `start_recast`.\n\n" +
          "**`rights_attested` MUST reflect the USER'S OWN explicit confirmation in " +
          "this conversation that the script is their own work (or they hold the " +
          "rights).** Authored recasts render Faithful — exactly as written, brand " +
          "names included — so never set it on the user's behalf; ask them first.",
        inputSchema: {
          script: z.record(z.string(), z.unknown()).describe("The authored script document. Validate it first with validate_recast_script."),
          rights_attested: z
            .literal(true)
            .describe("Only after the user explicitly confirmed ownership in this conversation. Never inferred, never defaulted."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        // 1. Validate + persist the analysis (free; content-hash idempotent).
        //    The import route needs no workflow yet — attach after create so a
        //    failed import creates NOTHING (spec C3).
        const imp = await fastify.inject({
          method: "POST",
          url: "/v1/video-analysis/import",
          headers: internalHeaders(session.userId),
          payload: { userId: session.userId, script: args.script, rightsAttested: args.rights_attested },
        })
        if (imp.statusCode >= 400) return errorResult(imp.statusCode, imp.body)
        const imported = JSON.parse(imp.body) as {
          jobId: string
          created: boolean
          warnings: string[]
          json: { meta?: { title?: string } }
        }

        // 2. Project + workflow — the app's own "Recast" project, so the run
        //    shows up on the recast.nodaro.ai dashboard.
        const projectId = await ensureRecastProject(session.userId)
        const title = imported.json?.meta?.title?.trim() || "Authored recast"
        const wf = await fastify.inject({
          method: "POST",
          url: "/v1/workflows",
          headers: internalHeaders(session.userId),
          payload: { userId: session.userId, projectId, name: title },
        })
        if (wf.statusCode >= 400) return errorResult(wf.statusCode, wf.body)
        const workflow = JSON.parse(wf.body) as { data?: { id?: string }; id?: string }
        const workflowId = workflow.data?.id ?? workflow.id
        if (!workflowId) return errorResult(500, wf.body)

        // 3. Seed settings.recast — mirrors the app's seedAuthoredRecast:
        //    faithful + attested at seed, analysis born completed with the
        //    SERVER's derived document as the raw blueprint (spec C2).
        const ok = await patchRecastSettings(fastify, session.userId, workflowId, {
          recast: {
            version: 1,
            fidelity: "faithful",
            rightsAttestedAt: new Date().toISOString(),
            resolution: "720p",
            results: [],
            analysis: { jobId: imported.jobId, status: "completed", blueprint: imported.json },
          },
        })
        if (!ok) return errorResult(500, "Failed to seed the recast settings")

        return textResult({
          recastId: workflowId,
          jobId: imported.jobId,
          warnings: imported.warnings,
          appUrl: `${recastAppOrigin()}/recast/${workflowId}`,
          next: "Call start_recast with this recastId for a price quote; call again with confirm: true to render.",
        })
      },
    )
  }

  // ── start (workflows:execute): quote → create → advance ─────────────────
  if (passesGate(session, executeGate)) {
    server.registerTool(
      "start_recast",
      {
        title: "Start Recast Render",
        description:
          "Quote and render an imported recast — the render half of the MCP movie " +
          "lane. Without `confirm` it returns the PRICE QUOTE only (nothing is " +
          "charged). With `confirm: true` — only after the user accepted the quoted " +
          "credits — it buys the plan and the render. Call it again if a run is " +
          "already in flight: it advances a `planned` run to rendering (no new " +
          "charge) and reports progress otherwise. Poll `get_recast_status` while " +
          "rendering.",
        inputSchema: {
          recast_id: z.uuid().describe("The recastId returned by import_recast_script."),
          confirm: z
            .boolean()
            .optional()
            .describe("true ONLY after the user accepted the quoted credits in this conversation."),
          resolution: z.string().optional().describe('Output resolution (default "720p").'),
          segment_pack: z
            .enum(["scenes", "scenes-max"])
            .optional()
            .describe('Part packing: "scenes-max" (default — fewest seams, cheapest) or "scenes" (shorter parts).'),
          anchor_mode: z
            .enum(["progressive", "none"])
            .optional()
            .describe(
              'Keyframes anchor discipline: "progressive" (each part\'s start still chains off the previous render, no closing pin) or "none" (no frame conditioning — references carry the shot; the quote drops the anchor-still surcharge). Omit for the server default.',
            ),
          provider: z.string().optional().describe("Video model override; omit for the server default."),
          interactive: z
            .boolean()
            .optional()
            .describe(
              "Choose the cast before rendering: the run generates 3 candidates per element and pauses at a pick-1-of-3 gate (shown in the status widget; resolve with resolve_recast_gate). A PRICED surcharge — it rides the quote, so ask before confirming.",
            ),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const loaded = await readRecastSettings(args.recast_id, session.userId)
        if (!loaded) return errorResult(404, JSON.stringify({ error: "recast not found" }))
        const { settings, recast } = loaded
        const analysis = recast.analysis as { jobId?: string } | undefined
        if (!analysis?.jobId) {
          return errorResult(422, JSON.stringify({ error: "no analysis on this recast — import a script first" }))
        }
        const resolution = args.resolution ?? (recast.resolution as string | undefined) ?? "720p"
        const segmentSec = args.segment_pack ?? "scenes-max"
        const run = recast.run as { recastId?: string; status?: string } | undefined

        // A run already exists — advance or report, never re-charge.
        if (run?.recastId) {
          const snap = await fastify.inject({
            method: "GET",
            url: `/v1/recast/${run.recastId}`,
            headers: internalHeaders(session.userId),
          })
          if (snap.statusCode >= 400) return errorResult(snap.statusCode, snap.body)
          const status = JSON.parse(snap.body) as { status: string; gvpJobId?: string; interactive?: InteractiveState }
          // INTERACTIVE runs advance by the server-owned `next` pointer (P3):
          // fire the non-gate hop, or surface the gate for the user.
          if (status.interactive) {
            const adv = await advanceInteractive(fastify, session.userId, run.recastId)
            if (adv.error) return errorResult(adv.error.statusCode, adv.error.body)
            const gate = pendingGateOf(adv.interactive)
            return textResult({
              recastRunId: run.recastId,
              status: adv.status,
              interactive: adv.interactive,
              ...(adv.fired ? { advanced: adv.fired } : {}),
              note: gate
                ? "A choice is waiting — show the options and call resolve_recast_gate with the user's pick (or finish_auto to let the critic decide the rest)."
                : adv.fired
                  ? `Advanced (${adv.fired}) — poll get_recast_status; call start_recast again when it stalls.`
                  : "Working — poll get_recast_status.",
            })
          }
          if (status.status === "planned") {
            // The consented estimate covered plan + render; /start is the
            // second hop the app's watcher auto-fires. Idempotent server-side.
            const start = await fastify.inject({
              method: "POST",
              url: `/v1/recast/${run.recastId}/start`,
              headers: internalHeaders(session.userId),
              payload: { userId: session.userId, segmentSec, ...(args.provider ? { provider: args.provider } : {}) },
            })
            if (start.statusCode >= 400) return errorResult(start.statusCode, start.body)
            const started = JSON.parse(start.body) as { gvpJobId?: string }
            await patchRecastSettings(fastify, session.userId, args.recast_id, {
              ...settings,
              recast: {
                ...recast,
                run: { ...run, status: "generating", ...(started.gvpJobId ? { gvpJobId: started.gvpJobId } : {}) },
              },
            })
            return textResult({ recastRunId: run.recastId, status: "generating", note: "Rendering — poll get_recast_status." })
          }
          return textResult({
            recastRunId: run.recastId,
            status: status.status,
            note:
              status.status === "planning"
                ? "Still planning — call start_recast again shortly (it advances the run when the plan is ready)."
                : "Run already in flight or finished — see get_recast_status.",
          })
        }

        // No run yet: quote first, always.
        const est = await fastify.inject({
          method: "POST",
          url: "/v1/recast/estimate",
          headers: internalHeaders(session.userId),
          payload: {
            userId: session.userId,
            analysisJobId: analysis.jobId,
            fidelity: "faithful",
            resolution,
            segmentSec,
            renderMethod: "keyframes",
            // The quote must price the run that will render: under "none" the
            // engine skips anchor stills, so the estimate drops that surcharge.
            ...(args.anchor_mode ? { anchorMode: args.anchor_mode } : {}),
            ...(args.interactive ? { interactive: true } : {}),
            ...(args.provider ? { provider: args.provider } : {}),
          },
        })
        if (est.statusCode >= 400) return errorResult(est.statusCode, est.body)
        const quote = JSON.parse(est.body) as { totalCredits?: number; breakdown?: Record<string, number> }

        if (args.confirm !== true) {
          return textResult({
            quote,
            note:
              `Rendering this recast costs ${quote.totalCredits ?? "?"} credits (plan + render). ` +
              "Present the price to the user; call start_recast again with confirm: true once they accept.",
          })
        }

        // Consented: buy the plan (the render auto-follows via the planned →
        // /start hop above on the next start_recast call, or the app's watcher).
        const create = await fastify.inject({
          method: "POST",
          url: "/v1/recast",
          headers: internalHeaders(session.userId),
          payload: {
            userId: session.userId,
            analysisJobId: analysis.jobId,
            workflowId: args.recast_id,
            fidelity: "faithful",
            rightsAttested: true,
            resolution,
            segmentSec,
            renderMethod: "keyframes",
            // Capability opt-in (C7): the plugin only opens the sheet gate for
            // runs whose create declared support — and this MCP lane CAN
            // answer it (widget + resolve_recast_gate). Sent always: additive
            // field, a pre-sheet plugin Zod-strips it harmlessly.
            clientCapabilities: ["sheet-gate"],
            ...(args.anchor_mode ? { anchorMode: args.anchor_mode } : {}),
            ...(args.interactive ? { interactive: true } : {}),
            ...(args.provider ? { provider: args.provider } : {}),
          },
        })
        if (create.statusCode >= 400) return errorResult(create.statusCode, create.body)
        const createdRun = JSON.parse(create.body) as { recastId: string }
        await patchRecastSettings(fastify, session.userId, args.recast_id, {
          ...settings,
          recast: {
            ...recast,
            resolution,
            run: {
              recastId: createdRun.recastId,
              analysisJobId: analysis.jobId,
              status: "planning",
              startedAt: new Date().toISOString(),
            },
          },
        })
        return textResult({
          recastRunId: createdRun.recastId,
          status: "planning",
          quotedCredits: quote.totalCredits,
          note: "Plan purchased. Call start_recast again in ~1 minute to begin rendering (get_recast_status shows when it is planned).",
        })
      },
    )
  }

  // ── gate resolution (workflows:execute) — the pick is FREE, pure state ───
  if (passesGate(session, executeGate)) {
    server.registerTool(
      "resolve_recast_gate",
      {
        title: "Resolve Recast Gate",
        description:
          "Record the user's pick at an interactive gate (cast / identity sheet / " +
          "scene stills / music) and advance the run. The pick itself is free — " +
          "the interactive surcharge was consented at start_recast. Options are " +
          "0-based indexes into the candidates shown by get_recast_status. The " +
          "SHEET gate (`gate: \"sheet\"`, opens after the cast pick) chooses each " +
          "person's body & wardrobe: the face panel is identical across its 3 " +
          "sheets — locked by the cast pick — so the user is judging body and " +
          "clothes only. `finish_auto: true` resolves THIS gate and every " +
          "remaining one with the critic's top pick (unattended finish).",
        inputSchema: {
          recast_id: z.uuid().describe("The recastId returned by import_recast_script."),
          gate: z
            .enum(["cast", "sheet"])
            .optional()
            .describe(
              'Which pick-1-of-3 gate `picks` answers: "cast" (default) or "sheet" (identity sheet — body & wardrobe; the face is locked from the cast pick).',
            ),
          picks: z
            .record(z.string(), z.number().int().min(0).max(9))
            .optional()
            .describe("CAST or SHEET gate: slotId → chosen candidate index."),
          segment: z.number().int().min(0).max(47).optional().describe("ANCHOR gate: which scene (0-based)."),
          anchor_start: z.number().int().min(0).max(9).optional().describe("ANCHOR gate: opening-frame pick."),
          anchor_end: z.number().int().min(0).max(9).optional().describe("ANCHOR gate: closing-frame pick."),
          section: z.number().int().min(0).max(23).optional().describe("MUSIC gate: which stretch (0-based)."),
          music_pick: z.number().int().min(0).max(9).optional().describe("MUSIC gate: chosen take."),
          finish_auto: z
            .boolean()
            .optional()
            .describe("Resolve this and every remaining gate with the critic's top candidate, unattended."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const loaded = await readRecastSettings(args.recast_id, session.userId)
        if (!loaded) return errorResult(404, JSON.stringify({ error: "recast not found" }))
        const run = loaded.recast.run as { recastId?: string } | undefined
        if (!run?.recastId) return errorResult(422, JSON.stringify({ error: "no run in flight on this recast" }))

        const body: Record<string, unknown> = { userId: session.userId }
        if (args.picks) {
          // `picks` serves two pick-1-of-3 gates; `gate` says which (default
          // cast, the pre-sheet behavior). Anchors/music stay inferred from
          // their own args, untouched.
          body.gate = args.gate === "sheet" ? "sheet" : "cast"
          body.picks = args.picks
        } else if (args.anchor_start !== undefined || args.anchor_end !== undefined) {
          body.gate = "anchors"
          body.segment = args.segment
          body.anchorPicks = {
            ...(args.anchor_start !== undefined ? { start: args.anchor_start } : {}),
            ...(args.anchor_end !== undefined ? { end: args.anchor_end } : {}),
          }
        } else if (args.music_pick !== undefined) {
          body.gate = "music"
          body.section = args.section
          body.musicPick = args.music_pick
        }
        if (args.finish_auto) body.finishAuto = true

        const sel = await fastify.inject({
          method: "POST",
          url: `/v1/recast/${run.recastId}/select`,
          headers: internalHeaders(session.userId),
          payload: body,
        })
        if (sel.statusCode >= 400) return errorResult(sel.statusCode, sel.body)

        // The walk continues server-owned: fire the next non-gate hop so a
        // headless conversation never strands the run at "picked, now what".
        const adv = await advanceInteractive(fastify, session.userId, run.recastId)
        const gate = pendingGateOf(adv.interactive)
        return textResult({
          recastRunId: run.recastId,
          status: adv.status,
          interactive: adv.interactive,
          ...(adv.fired ? { advanced: adv.fired } : {}),
          note: gate
            ? "Next choice is waiting — show the options and call resolve_recast_gate again."
            : "Pick recorded — poll get_recast_status; call start_recast if it stalls.",
        })
      },
    )
  }

  // ── status (workflows:read) ──────────────────────────────────────────────
  if (passesGate(session, readGate)) {
    server.registerTool(
      "get_recast_status",
      {
        title: "Recast Status",
        description:
          "Progress of an imported recast: blueprint ready / planning / planned " +
          "(call start_recast to begin rendering) / generating (segments done vs " +
          "total, live preview) / completed (result URL) / failed. Also returns the " +
          "recast.nodaro.ai deep link — the full editor for casting, retakes, and " +
          "interactive choices.",
        inputSchema: {
          recast_id: z.uuid().describe("The recastId returned by import_recast_script."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
        _meta: uiMeta(WIDGET_URI.recast),
      },
      async (args) => {
        const loaded = await readRecastSettings(args.recast_id, session.userId)
        if (!loaded) return errorResult(404, JSON.stringify({ error: "recast not found" }))
        const { settings, recast } = loaded
        const appUrl = `${recastAppOrigin()}/recast/${args.recast_id}`
        const run = recast.run as
          | { recastId?: string; status?: string; gvpJobId?: string; analysisJobId?: string }
          | undefined
        const results = (recast.results as Array<Record<string, unknown>> | undefined) ?? []

        if (!run?.recastId) {
          return textResult({
            recastId: args.recast_id,
            stage: results.length > 0 ? "completed" : recast.analysis ? "blueprint" : "empty",
            takes: results.length,
            resultUrl: results[0]?.videoUrl,
            appUrl,
            note:
              results.length > 0
                ? "Latest take shown; start_recast is not needed unless you want a new project."
                : recast.analysis
                  ? "Blueprint ready — call start_recast for a price quote."
                  : "No script imported yet.",
          })
        }

        const snap = await fastify.inject({
          method: "GET",
          url: `/v1/recast/${run.recastId}`,
          headers: internalHeaders(session.userId),
        })
        if (snap.statusCode >= 400) return errorResult(snap.statusCode, snap.body)
        const status = JSON.parse(snap.body) as {
          status: string
          gvpJobId?: string
          resultUrl?: string
          failureReason?: string
          previewUrl?: string
          segmentsDone?: number
          segmentsTotal?: number
          stopped?: boolean
          interactive?: InteractiveState
        }

        // Reconcile terminals into settings so the app shows what MCP saw —
        // the client watcher's applyRunCompleted, mirrored for headless runs.
        if (status.status === "completed" && status.resultUrl) {
          const prevVersion = typeof results[0]?.version === "number" ? (results[0]!.version as number) : 0
          await patchRecastSettings(fastify, session.userId, args.recast_id, {
            ...settings,
            recast: {
              ...recast,
              run: undefined,
              results: [
                {
                  version: prevVersion + 1,
                  videoUrl: status.resultUrl,
                  createdAt: new Date().toISOString(),
                  recastId: run.recastId,
                  ...(status.gvpJobId ? { gvpJobId: status.gvpJobId } : {}),
                  fidelity: "faithful",
                  ...(status.stopped && status.segmentsDone !== undefined && status.segmentsTotal !== undefined
                    ? { partialDone: status.segmentsDone, partialTotal: status.segmentsTotal }
                    : {}),
                },
                ...results,
              ],
            },
          })
        } else if (status.status === "failed" && run.status !== "failed") {
          await patchRecastSettings(fastify, session.userId, args.recast_id, {
            ...settings,
            recast: { ...recast, run: { ...run, status: "failed", ...(status.failureReason ? { error: status.failureReason } : {}) } },
          })
        }

        const pendingGate = pendingGateOf(status.interactive)
        return textResult({
          recastId: args.recast_id,
          recastRunId: run.recastId,
          status: status.status,
          segmentsDone: status.segmentsDone,
          segmentsTotal: status.segmentsTotal,
          previewUrl: status.previewUrl,
          resultUrl: status.resultUrl,
          failureReason: status.failureReason,
          ...(status.interactive ? { interactive: status.interactive } : {}),
          appUrl,
          ...(pendingGate
            ? { next: "A choice is waiting — show the candidates and call resolve_recast_gate with the user's pick." }
            : status.interactive
              ? { next: "Interactive run working — call start_recast to advance if it stalls." }
              : status.status === "planned"
                ? { next: "Call start_recast to begin rendering (no new charge)." }
                : {}),
        })
      },
    )
  }
}
