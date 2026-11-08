import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { mcpInject } from "../internal-request.js"
import { errorResult } from "./_verb-helpers.js"
import { VOICE_FAVORITE_TYPES } from "@nodaro/shared/pipeline"

/**
 * The user's favorite voices — a premade voice, a Voice Library voice or one of
 * their clones — starred from any client (an app, the SDK, the CLI, the tool
 * below) and read back by all of them. Reads and writes mirror the REST routes
 * (`/v1/voices/favorites`, routes/voice-favorites.ts) and their scopes: the
 * list needs `assets:read` like the gallery's favorites, the star `assets:write`
 * like `favorite_asset` and `favorite_node_preset`.
 */

const readGate: ToolGate = { required: ["assets:read"] }
const writeGate: ToolGate = { required: ["assets:write"] }

export interface RegisterVoiceFavoritesOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

export function registerVoiceFavorites({ server, session, fastify }: RegisterVoiceFavoritesOpts): void {
  if (passesGate(session, readGate)) {
    server.registerTool(
      "list_voice_favorites",
      {
        title: "List Favorite Voices",
        description:
          "List the user's favorite voices, newest first — a premade voice, a Voice Library voice or " +
          "one of their clones — each with the voiceId and voiceType to pass to generate_speech as " +
          "voice_id / voice_type, and the name / previewUrl it was starred with. Read-only; returns JSON.",
        inputSchema: {},
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async () => {
        const res = await mcpInject(fastify, session, { method: "GET", url: "/v1/voices/favorites" })
        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        const parsed = JSON.parse(res.body) as { favorites?: unknown }
        return { content: [{ type: "text" as const, text: JSON.stringify(parsed.favorites ?? [], null, 2) }] }
      },
    )
  }

  if (passesGate(session, writeGate)) {
    server.registerTool(
      "favorite_voice",
      {
        title: "Favorite Voice",
        description:
          "Star a voice for the user — a premade voice, a Voice Library voice or one of their clones — " +
          "with the name (and preview URL) the favorites list shows it by, or unstar it with favorite: false. " +
          "Favorites lead the voice pickers that read them. Both are idempotent.",
        inputSchema: {
          voice_id: z.string().min(1).max(200).describe("The voice's id: a premade or library voice_id, or a clone's ElevenLabs voice id."),
          voice_type: z
            .enum(VOICE_FAVORITE_TYPES)
            .optional()
            .describe("What the voice is — the same voice_type generate_speech takes for it. Required to star (a library voice is never starred as premade); not needed to unstar."),
          name: z.string().min(1).max(200).optional().describe("The voice's name, as the favorites list shows it. Required to star."),
          preview_url: z
            .string()
            .max(2048)
            .refine((value) => value === "" || (value.startsWith("https://") && URL.canParse(value)), {
              message: 'preview_url must be an https URL, or "" to clear the stored preview',
            })
            .optional()
            .describe("The voice's preview audio URL (https), when known; \"\" clears a stored preview."),
          favorite: z.boolean().optional().describe("false removes the star (default true)."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      },
      async (args) => {
        const url = `/v1/voices/favorites/${encodeURIComponent(args.voice_id)}`
        if (args.favorite === false) {
          const res = await mcpInject(fastify, session, { method: "DELETE", url })
          if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
          return { content: [{ type: "text" as const, text: `Unstarred ${args.voice_id}.` }] }
        }
        if (!args.name || !args.voice_type) {
          return errorResult(400, JSON.stringify({ error: { code: "validation_error", message: "name and voice_type are required to star a voice" } }))
        }
        // `""` rides through: the route stores it as "no preview", clearing a stored one.
        const res = await mcpInject(fastify, session, {
          method: "PUT",
          url,
          payload: { voiceType: args.voice_type, name: args.name, ...(args.preview_url !== undefined ? { previewUrl: args.preview_url } : {}) },
        })
        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        return { content: [{ type: "text" as const, text: `Starred ${args.name} (${args.voice_id}).` }] }
      },
    )
  }
}
