import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { hasCredits } from "../../config.js"
import { supabase } from "../../supabase.js"
import { CreditsService, STATIC_CREDIT_COSTS } from "../../../billing/credits.js"

const creditsReadGate: ToolGate = { required: ["credits:read"] }

export interface RegisterModelsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Classify a model identifier as image / video / audio / other.
 * Heuristic matches the verb-name conventions, not exact: "video" / "vid"
 * substrings or known-video provider prefixes route to `video`, etc.
 *
 * Composite identifiers like `nano-banana-pro:4K` keep the base classifier.
 */
function classifyModel(id: string): "image" | "video" | "audio" | "other" {
  const base = id.split(":")[0] ?? id
  const isImage =
    /^(nano-banana|flux|grok$|gpt-image|imagen|qwen|seedream|z-image|recraft|topaz-image|ideogram|flux-kontext|flux-pro)/.test(
      base,
    )
  if (isImage) return "image"
  const isVideo =
    /^(minimax|veo|kling|grok-i2v|seedance|wan|hailuo|bytedance|sora|kling-avatar|infinitalk|kling-master|runway|topaz-vid)/.test(
      base,
    ) ||
    /(^|-)i2v($|:)/.test(base) ||
    base === "lip-sync" ||
    base === "extend-video" ||
    base === "combine-videos" ||
    base === "add-captions" ||
    base === "extract-frame"
  if (isVideo) return "video"
  const isAudio =
    /^(elevenlabs|suno|generate-music|text-to-speech|text-to-audio|music)/.test(base) ||
    base === "extract-youtube-audio"
  if (isAudio) return "audio"
  return "other"
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
        "List the AI models available on this Nodaro instance with their credit costs and media kind. Output is a JSON array of `{ id, kind, credits }` rows.",
      inputSchema: {
        kind: z.enum(["image", "video", "audio"]).optional().describe("Filter by media kind"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const rows: Array<{ id: string; kind: string; credits: number }> = []
      for (const [id, credits] of Object.entries(STATIC_CREDIT_COSTS)) {
        const kind = classifyModel(id)
        if (args.kind && kind !== args.kind) continue
        rows.push({ id, kind, credits })
      }
      rows.sort((a, b) => a.id.localeCompare(b.id))
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ data: rows, total: rows.length }, null, 2),
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
