import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { openApiRegistry } from "../lib/openapi-registry.js"
import { requireScope } from "../lib/scopes.js"
import { sendInternalError } from "../lib/http-errors.js"
import { isMonth, listMcpConversations } from "../lib/mcp/flows/conversation-list.js"

/**
 * `GET /v1/mcp-conversations` — the caller's MCP conversations of one month,
 * each a flow its assistant built (lib/mcp/flows/). Read-only: a conversation
 * is a workflow, so opening, renaming, copying, exporting and deleting one go
 * through the workflow routes.
 */

const query = z.object({
  month: z
    .string()
    .refine(isMonth, "month must be YYYY-MM")
    .optional()
    .describe("The month to list (YYYY-MM). Default: the latest month that has conversations."),
  sources: z
    .string()
    .max(500)
    .optional()
    .describe("Comma-separated sources to keep (claude, claude-code, chatgpt, or another client's name)."),
})

const Conversation = z
  .object({
    id: z.string().describe("The conversation's workflow id: open it with GET /v1/workflows/{id}."),
    projectId: z.string(),
    name: z.string(),
    client: z.string().describe("The source: claude, claude-code, chatgpt, or another client's name in lower case."),
    clientLabel: z.string(),
    clientName: z.string().describe("The connection's own name, as the connector was named."),
    startedAt: z.string(),
    lastActivityAt: z.string(),
    live: z.boolean().describe("Still receiving steps: its last step is less than 30 minutes old."),
    firstRequest: z.string().nullable().describe("The user's first request, when the assistant passed it."),
    nodeCount: z.number().int(),
    counts: z.object({ image: z.number().int(), video: z.number().int(), audio: z.number().int() }),
    credits: z.number().nullable().describe("Credits charged for its jobs; null where credits are not billed."),
    cover: z
      .object({ url: z.string(), kind: z.enum(["image", "video"]), setByUser: z.boolean() })
      .nullable(),
    updatedAt: z.string(),
  })
  .openapi("McpConversation")

openApiRegistry.registerPath({
  method: "get",
  path: "/v1/mcp-conversations",
  description:
    "Your MCP conversations of one month, newest first. Each is a flow the assistant built from its steps; `months` and `sources` count conversations for the month and source pickers.",
  security: [{ bearerAuth: [] }],
  request: { query },
  responses: {
    200: {
      description: "One month of conversations",
      content: {
        "application/json": {
          schema: z.object({
            month: z.string(),
            months: z.array(z.object({ month: z.string(), conversations: z.number().int() })),
            sources: z.array(
              z.object({
                client: z.string(),
                label: z.string(),
                conversations: z.number().int(),
                connections: z.array(z.object({ clientName: z.string(), conversations: z.number().int() })),
              }),
            ),
            data: z.array(Conversation),
          }),
        },
      },
    },
    400: { description: "Invalid query" },
    401: { description: "Unauthorized" },
  },
})

export async function mcpConversationRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/mcp-conversations", async (req, reply) => {
    if (!req.userId) {
      return reply.status(401).send({ error: { code: "unauthorized", message: "Authentication required" } })
    }
    if (req.appAuthorization) {
      const err = requireScope(req.appAuthorization.scopes, "workflows:read")
      if (err) return reply.status(err.statusCode).send(err.body)
    }
    const parsed = query.safeParse(req.query ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Invalid query" } })
    }
    const sources = parsed.data.sources
      ?.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
    try {
      return await listMcpConversations(req.userId, { month: parsed.data.month, sources })
    } catch (err) {
      return sendInternalError(reply, req, err, "Failed to list MCP conversations")
    }
  })
}
