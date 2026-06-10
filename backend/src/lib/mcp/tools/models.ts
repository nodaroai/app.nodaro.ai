import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { hasCredits } from "../../config.js"
import { supabase } from "../../supabase.js"
import { CreditsService } from "../../../ee/billing/credits.js"
import {
  MODEL_CATALOG,
  MODEL_RECOMMENDATIONS,
  getPromptTips,
  listModels,
  groupByFamily,
  type ModelCatalogEntry,
  type ModelKind,
  type ModelMode,
} from "@nodaro/shared"

const creditsReadGate: ToolGate = { required: ["credits:read"] }

export interface RegisterModelsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Strip undefined fields so the JSON output stays compact when a model
 * doesn't expose a particular lever (e.g., audio models have no aspectRatios).
 */
function projectModel(m: ModelCatalogEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: m.id,
    label: m.label,
    description: m.description,
    modes: m.modes,
    useCases: m.useCases,
    pricing: m.pricing,
  }
  if (m.featured) out.featured = true
  if (m.features?.length) out.features = m.features
  if (m.aspectRatios?.length) out.aspectRatios = m.aspectRatios
  if (m.resolutions?.length) out.resolutions = m.resolutions
  if (m.qualities?.length) out.qualities = m.qualities
  if (m.durations?.length) out.durations = m.durations
  const promptTips = getPromptTips(m.id)
  if (promptTips.length) out.promptTips = promptTips
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
        "(aspect ratios, resolutions, qualities, durations, features, per-variant " +
        "credit pricing). Includes a `recommendations` array — short 'best for X' " +
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
            "tts", "music", "sfx", "stt", "voice-clone", "voice-design",
            "voice-changer", "isolation", "dubbing", "forced-alignment",
          ])
          .optional()
          .describe("Filter to a specific operation (e.g. 't2i' = text-to-image, 'i2v' = image-to-video)."),
        family: z.string().optional().describe("Filter by vendor / lab name (e.g. 'Google', 'OpenAI', 'Bytedance')."),
        featuredOnly: z.boolean().optional().describe("Return only editor-picked best-in-tier models."),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const filtered = listModels({
        kind: args.kind as ModelKind | undefined,
        mode: args.mode as ModelMode | undefined,
        family: args.family,
      })
        // Drop legacy versions from MCP output — keeps Claude focused on the
        // current generation. Frontend pickers ignore mcpHidden.
        .filter((m) => !m.mcpHidden)
        .filter((m) => (args.featuredOnly ? m.featured === true : true))

      const grouped = groupByFamily(filtered)
      // Group again by kind for the outer envelope — Image / Video / Audio
      // sectioning so the agent can scan one media kind at a time.
      const byKind: Record<ModelKind, Array<{ family: string; models: Record<string, unknown>[] }>> = {
        image: [],
        video: [],
        audio: [],
      }
      for (const { family, models } of grouped) {
        const kind = models[0]!.kind
        byKind[kind].push({ family, models: models.map(projectModel) })
      }

      const sections = (["image", "video", "audio"] as const)
        .filter((k) => byKind[k].length > 0)
        .map((k) => ({ kind: k, families: byKind[k] }))

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

  server.registerTool(
    "check_balance",
    {
      title: "Check Credit Balance",
      description:
        "Return the user's current credit balance, daily-spend cap, monthly allocation, tier, and period end. Cloud edition only.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
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
        "List the user's recent credit transactions (subscriptions, top-ups, refunds). Cloud edition only.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const limit = args.limit ?? 50
      let query = supabase
        .from("transactions")
        .select(
          "id, stripe_transaction_id, type, amount_usd, credits_granted, tier, created_at",
        )
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false })
        .limit(limit)
      if (args.cursor) query = query.lt("created_at", args.cursor)
      const { data, error } = await query
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
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: rows, next_cursor: nextCursor }, null, 2),
          },
        ],
      }
    },
  )
}
