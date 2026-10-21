import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { hasCredits } from "../../config.js"
import { supabase } from "../../supabase.js"
import { listUsageTransactions, USAGE_TRANSACTIONS_PAGE_MAX as USAGE_PAGE_MAX } from "../../usage-transactions.js"
import { CreditsService } from "../../../ee/billing/credits.js"
import { deploymentPayerActive, deploymentPayerId } from "../../deployment-payer.js"
import { MODEL_CATALOG, MODEL_RECOMMENDATIONS, listModels, groupByKindAndFamily, modelMakerOf, type ModelCatalogEntry, type ModelKind, type ModelMakerId, type ModelMode } from "@nodaro/shared/model-catalog"
import { SPEECH_UNIT_CREDIT_SUFFIX } from "@nodaro/shared/credits"
import { isModelDenied } from "../../surface-deny.js"
import { loadChargedPrices, type ChargedPrices } from "../../pricing/charged-prices.js"
import { getPromptTips, getPromptDoctrine } from "@nodaro/prompts/doctrine"

const creditsReadGate: ToolGate = { required: ["credits:read"] }

export interface RegisterModelsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * The catalog's pricing rows at the credits a run is charged. The catalog
 * holds base prices; `prices` is what the Run button and the reservation read,
 * so a listed price is the price paid. A row nothing prices keeps its catalog
 * figure — except a speech `:per-100-chars` row, a RATE this server does not
 * charge while length pricing is off: it is omitted, so a client that sees the
 * row may apply it (lib/speech-credits.ts :: speechUnitRowServed). That row is
 * the price of ONE unit: a request's total is marked up once, so its units ×
 * the row is an upper bound (its note says so), and the exact price of N units
 * is the `<model>:per-100-chars:<N>u` id the price lookups serve.
 */
export function chargedPricing(rows: ModelCatalogEntry["pricing"], prices: ChargedPrices): ModelCatalogEntry["pricing"] {
  return rows.flatMap((row) => {
    const credits = prices.credits(row.identifier)
    if (credits === undefined && row.identifier.endsWith(SPEECH_UNIT_CREDIT_SUFFIX)) return []
    return [credits === undefined || credits === row.credits ? row : { ...row, credits }]
  })
}

const warnedNoMaker = new Set<string>()

/** Once per model id per process: a catalog entry whose maker is not in `MODEL_MAKERS`. */
function warnNoMaker(m: ModelCatalogEntry): void {
  if (warnedNoMaker.has(m.id)) return
  warnedNoMaker.add(m.id)
  console.warn(`[models] catalog entry ${m.id} names no known maker (${String(m.maker)}); listed without one`)
}

/** How a surface serves the makers' marks (the third argument of {@link projectModel}). */
export interface ModelProjectionOpts {
  /**
   * The deployment's published marks by maker id (`makerLogoUrls()`): every
   * model then carries `logoUrl`, null when its maker has none. `"omit"` leaves
   * the field off — the MCP tool's choice: its reader is a model, which has no
   * use for an image address, and the field would cost every call tokens.
   */
  logos: ReadonlyMap<ModelMakerId, string> | "omit"
}

/**
 * Strip undefined fields so the JSON output stays compact when a model
 * doesn't expose a particular lever (e.g., audio models have no aspectRatios).
 * `prices` comes from `loadChargedPrices()` — required, so no surface can list
 * the catalog's base prices by forgetting it; `opts.logos` is required for the
 * same reason, so a surface states whether it serves the makers' marks.
 */
export function projectModel(m: ModelCatalogEntry, prices: ChargedPrices, opts: ModelProjectionOpts): Record<string, unknown> {
  // The company that made the model — one id per company (`family` is the
  // grouping label, and a few families name a lab or a product line). An entry
  // built at run time without a known maker is listed without one, never fails
  // the listing.
  const maker = modelMakerOf(m)
  if (!maker) warnNoMaker(m)
  const out: Record<string, unknown> = {
    id: m.id,
    label: m.label,
    ...(maker ? { maker } : {}),
    ...(opts.logos === "omit" ? {} : { logoUrl: (maker && opts.logos.get(maker.id)) || null }),
    description: m.description,
    modes: m.modes,
    useCases: m.useCases,
    // Credit pricing is a Cloud concept — editions without a credit system
    // omit it entirely, same principle as /v1/nodes' creditCost (#714).
    ...(hasCredits() ? { pricing: chargedPricing(m.pricing, prices) } : {}),
  }
  if (m.featured) out.featured = true
  if (m.features?.length) out.features = m.features
  if (m.aspectRatios?.length) out.aspectRatios = m.aspectRatios
  if (m.resolutions?.length) out.resolutions = m.resolutions
  if (m.qualities?.length) out.qualities = m.qualities
  if (m.durations?.length) out.durations = m.durations
  // What an unset `duration` renders AND is charged at (the catalog funnel).
  if (m.defaultDuration !== undefined) out.defaultDuration = m.defaultDuration
  if (m.autoDuration) out.autoDuration = true
  const promptTips = getPromptTips(m.id)
  if (promptTips.length) out.promptTips = promptTips
  // Truth flag for optimizer badges ("vendor doctrine · real rewrite"):
  // true ONLY when a sourced per-family doctrine exists for this id — clients
  // must show a generic label otherwise, never overclaim (Cine build-brief §7).
  out.doctrineCovered = getPromptDoctrine(m.id) !== undefined
  return out
}

/** The most ids one `list_models` price lookup answers. */
export const LIST_MODELS_PRICE_IDS_MAX = 50

/** One id's answer in a `list_models` price lookup. */
export type PriceIdAnswer =
  | { readonly credits: number; readonly estimate?: true }
  | { readonly error: "llm_model_unpriced" | "not_priced" }

/**
 * The price lookup `list_models` answers for `priceIds` — the figures
 * `POST /v1/credits/model-costs` answers, from the same charged prices: a
 * metered LLM call's price key (`<feature>:<model id>[:direct]`, any model)
 * at its estimate, marked `estimate`; a model with no rate on its lane
 * `llm_model_unpriced` (a run on it is refused); any other id its charged
 * price, or `not_priced` (under the tier-pricing rollback a metered key lands
 * here: LLM calls are then not priced per model).
 */
export function answerPriceIds(ids: readonly string[], prices: ChargedPrices): Record<string, PriceIdAnswer> {
  const out: Record<string, PriceIdAnswer> = {}
  for (const id of ids) {
    const quote = prices.llmQuote?.(id) ?? null
    if (quote?.kind === "estimate") out[id] = { credits: quote.credits, estimate: true }
    else if (quote?.kind === "unpriced") out[id] = { error: "llm_model_unpriced" }
    else {
      const credits = prices.credits(id)
      out[id] = credits === undefined ? { error: "not_priced" } : { credits }
    }
  }
  return out
}

/**
 * `list_models` is unscoped — model availability is public. `check_balance`
 * + `credit_transactions` are credits:read AND cloud-only (gated by
 * `hasCredits()` so self-hosted editions don't expose a 404).
 */
export function registerModels({ server, session }: RegisterModelsOpts): void {
  // ── list_models (always available) ──
  server.registerTool(
    "list_models",
    {
      title: "List Models",
      description:
        "Browse the AI models available on this Nodaro instance. Returns " +
        "nested JSON: per-kind groups, families, and per-model capability sheets " +
        "(aspect ratios, resolutions, qualities, durations, features, and — on " +
        "editions with a credit system — per-variant credit pricing). Includes a " +
        "`recommendations` array — short 'best for X' " +
        "picks Claude can echo back when the user is undecided. Use this BEFORE " +
        "calling generate_image / generate_video / etc. to pick the right model + " +
        "settings for the user's intent.",
      inputSchema: {
        kind: z
          .enum(["image", "video", "audio"])
          .optional()
          .describe("Filter to a single media kind."),
        mode: z
          .enum([
            "t2i", "i2i", "edit", "upscale", "remove-bg",
            "i2v", "t2v", "v2v", "extend", "motion-transfer", "lip-sync", "video-upscale",
            "tts", "music", "sfx", "stt", "voice-design",
            "voice-changer", "voice-changer-pro", "isolation", "dubbing", "forced-alignment",
            "video-analysis", "video-audit",
          ])
          .optional()
          .describe("Filter to a specific operation (e.g. 't2i' = text-to-image, 'i2v' = image-to-video)."),
        family: z.string().optional().describe("Filter by vendor / lab name (e.g. 'Google', 'OpenAI', 'Bytedance')."),
        featuredOnly: z.boolean().optional().describe("Return only editor-picked best-in-tier models."),
        priceIds: z
          .array(z.string().min(1).max(200))
          .min(1)
          .max(LIST_MODELS_PRICE_IDS_MAX)
          .optional()
          .describe(
            "Quote prices instead of listing: credit ids, or an LLM call's key `<feature>:<model id>` (any model; `:direct` = vendor API), e.g. `llm-chat:claude-sonnet-5.5`. " +
              "Answers `{ prices: { <id>: { credits, estimate? } | { error } } }`; `estimate`: charged actual usage, show `~N`.",
          ),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      if (args.priceIds) {
        // Credit pricing is a Cloud concept: an edition without a credit system prices nothing.
        if (!hasCredits()) {
          return { content: [{ type: "text", text: "Error: no_credit_system — this instance charges no credits, so nothing has a price." }], isError: true }
        }
        const prices = answerPriceIds([...new Set(args.priceIds)], await loadChargedPrices())
        return { content: [{ type: "text", text: JSON.stringify({ prices }, null, 2) }] }
      }
      const filtered = listModels({
        kind: args.kind as ModelKind | undefined,
        mode: args.mode as ModelMode | undefined,
        family: args.family,
      })
        // Drop legacy versions from MCP output — keeps Claude focused on the
        // current generation. Frontend pickers ignore mcpHidden.
        .filter((m) => !m.mcpHidden)
        .filter((m) => (args.featuredOnly ? m.featured === true : true))
        // Deployment surface deny (B1): a denied model is invisible to agents too.
        .filter((m) => !isModelDenied(m.id))

      // Image / Video / Audio sectioning so the agent can scan one media kind
      // at a time — each model under ITS OWN kind, then by family (the same
      // shared envelope GET /v1/models renders; a mixed vendor appears once
      // per kind it ships, #1332).
      const prices = await loadChargedPrices()
      const sections = groupByKindAndFamily(filtered).map(({ kind, families }) => ({
        kind,
        families: families.map(({ family, models }) => ({
          family,
          // `maker` but no `logoUrl`: GET /v1/models serves the marks to apps that draw them.
          models: models.map((m) => projectModel(m, prices, { logos: "omit" })),
        })),
      }))

      // Trim recommendations to those whose target intent matches the kind
      // filter (otherwise audio recs leak into a "kind=image" call).
      const allRecs = [...MODEL_RECOMMENDATIONS]
      const recs = args.kind
        ? allRecs.filter((r) =>
            r.modelIds.some((id) => MODEL_CATALOG[id]?.kind === args.kind),
          )
        : allRecs

      const totalModels = filtered.length
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { sections, recommendations: recs, totalModels },
              null,
              2,
            ),
          },
        ],
      }
    },
  )

  // ── credits:read tools (cloud-only) ──
  if (!hasCredits()) return
  if (!passesGate(session, creditsReadGate)) return

  /**
   * The deployment payer's own pool balance is not readable through MCP.
   *
   * On a deployment that funds its users from one account, that account's
   * balance is the operator's remaining money — not the caller's — so no
   * programmatic credential may read it.
   * `refusePayerBalanceToProgrammaticCaller` (ee/lib/payer-balance-guard.ts)
   * holds the REST doors by refusing every `authKind !== "jwt"` caller. MCP
   * was the door left open, and here the rule is IDENTITY ALONE. Without it
   * the self-host Connect token — minted with `credits:read`, and consented by
   * the billing account itself, so it carries that account's identity — reads
   * the exact figure the REST guard exists to withhold.
   *
   * IT IS NOT TRUE THAT EVERY MCP SESSION IS A TOKEN SESSION; two callers
   * build one, and they land on opposite sides of this rule:
   *   - `/mcp` (`routes/mcp.ts`) takes its scopes from `req.appAuthorization`,
   *     so a browser JWT arrives with `[]` and the `credits:read` gate above
   *     never registers these tools at all — that door is shut before this
   *     one. It sets no `firstParty`, deliberately: its `clientName` is
   *     `developer_apps.name` and its bearer is a token, so nothing there is
   *     first-party however the account behind it consented.
   *   - The Workflow Copilot builds an IN-PROCESS server for the BROWSER user
   *     (`ee/copilot/turn-runner.ts`) with `COPILOT_SCOPES`, which include
   *     `credits:read`, and `check_balance` is on its `MCP_TOOL_ALLOWLIST`
   *     (`credit_transactions` is not).
   *
   * THE COPILOT CARVE-OUT, keyed on `session.firstParty`: a first-party
   * session of the payer sees the balance exactly as that account's own
   * billing page does — same identity, same browser credential, a number it
   * already reads there. The flag is SERVER-SET and set only by the copilot
   * entry route from `req.authKind === "jwt"`, so it follows the CREDENTIAL
   * and not the caller's say-so; it is never `clientName`, which at `/mcp` is
   * chosen by the third-party developer being guarded against. Every
   * programmatic session of the payer — the self-host Connect token included —
   * still gets the refusal below, which is the whole point of the axis.
   *
   * INERT on mainline: with no `billing.payerAccount` configured
   * `deploymentPayerActive()` is false and this short-circuits, so a
   * deployment with no payer behaves byte-identically to today.
   *
   * Returns the result to hand back, or null to continue. CALL IT BEFORE ANY
   * READ — the refusal must not depend on what a query found, and the payer's
   * id is neither echoed nor logged.
   */
  const payerBalanceRefusal = () => {
    if (!deploymentPayerActive() || session.userId !== deploymentPayerId()) return null
    if (session.firstParty) return null
    return {
      content: [
        {
          type: "text" as const,
          text:
            "Error: payer_balance_jwt_only — the deployment balance is available to the billing account's own session only.",
        },
      ],
      isError: true,
    }
  }

  server.registerTool(
    "check_balance",
    {
      title: "Check Credit Balance",
      description:
        "Return the user's current credit balance, daily-spend cap, monthly allocation, tier, effectiveTier (\"payg\" = pay-as-you-go: no subscription but purchased credits — full model access, no watermark), and period end. Cloud edition only.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const refused = payerBalanceRefusal()
      if (refused) return refused
      try {
        const balance = await CreditsService.getBalance(session.userId)
        return {
          content: [{ type: "text", text: JSON.stringify({ data: balance }, null, 2) }],
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : "unknown"}`,
            },
          ],
          isError: true,
        }
      }
    },
  )

  server.registerTool(
    "credit_transactions",
    {
      title: "Credit Transactions",
      description:
        "List the user's recent credit transactions: purchases (subscriptions, top-ups, refunds) in `data`; usage in `usage`, one row per run: `credits_charged` (null while held, 0 if refunded) and `credits_reserved` (the hold). Cloud edition only.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
        usage_cursor: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const refused = payerBalanceRefusal()
      if (refused) return refused
      const limit = args.limit ?? 50
      // Org pack claims ride the owner's user_id (351) — not personal history.
      // 42703 = pre-351 schema (column lands on the next promotion): no org
      // rows can exist there, so the unfiltered query is the same answer.
      const buildQuery = (withOrgFilter: boolean) => {
        let q = supabase
          .from("transactions")
          .select(
            "id, stripe_transaction_id, type, amount_usd, credits_granted, tier, created_at, receipt_url",
          )
          .eq("user_id", session.userId)
        if (withOrgFilter) q = q.is("org_id", null)
        return q.order("created_at", { ascending: false }).limit(limit)
      }
      let query = buildQuery(true)
      if (args.cursor) query = query.lt("created_at", args.cursor)
      let { data, error } = await query
      if (error?.code === "42703") {
        let retry = buildQuery(false)
        if (args.cursor) retry = retry.lt("created_at", args.cursor)
        ;({ data, error } = await retry)
      }
      if (error) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        }
      }
      const rows = data ?? []
      const last = rows[rows.length - 1]
      const nextCursor =
        rows.length === limit && last?.created_at ? (last.created_at as string) : null
      // Usage: the rows GET /v1/credits/transactions lists — the same reader,
      // so the charge, the hold and the metadata allowlist agree row for row.
      // Its own page (the route's 50-row maximum) and cursor.
      const usage = await listUsageTransactions(session.userId, {
        limit: Math.min(limit, USAGE_PAGE_MAX),
        cursor: args.usage_cursor,
      })
      if ("error" in usage) {
        const message = usage.error instanceof Error ? usage.error.message : (usage.error as { message?: string })?.message ?? "unknown"
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true,
        }
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { data: rows, next_cursor: nextCursor, usage: { data: usage.items, next_cursor: usage.nextCursor } },
              null,
              2,
            ),
          },
        ],
      }
    },
  )
}
