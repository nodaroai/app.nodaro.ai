import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import { DUBBING_CAPTION_FORMATS } from "@nodaro/shared/media"
import type { DubbingStructure } from "@nodaro/shared/media"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { mcpInject } from "../internal-request.js"
import { asksForSource } from "../../dubbing-language.js"
import { DUBBING_PROBLEMS, dubbingProblemBody, type DubbingProblem } from "../../dubbing-problems.js"
import { dispatchJob, errorResult } from "./_verb-helpers.js"
import { isUuid } from "./_id-guard.js"
import {
  DUBBING_PAGE_DEFAULT,
  DUBBING_PAGE_MAX,
  dubbingLanguageOf,
  dubbingLanguagePage,
  dubbingOverview,
  dubbingSourcePage,
} from "./_dubbing-view.js"

/**
 * A dub after it is made (the `dubbing` tool makes one): its structure and its
 * captions, and a language added to it. Each tool calls its REST route
 * (routes/dubbing-read.ts, routes/dubbing-languages.ts), so the route's
 * ownership check, rate limit, price and refusals are the tool's too, and each
 * asks for the scope its route asks an app for: `assets:read` for the reads,
 * `assets:write` for adding a language.
 */

const readGate: ToolGate = { required: ["assets:read"] }
const writeGate: ToolGate = { required: ["assets:write"] }

export interface RegisterDubbingToolsOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/** A refusal the tool itself makes, told in the words and the code the route uses for it. */
const refused = (problem: DubbingProblem) => errorResult(problem.status, JSON.stringify(dubbingProblemBody(problem)))

const answered = (text: string) => ({ content: [{ type: "text" as const, text }] })

export function registerDubbingTools({ server, session, fastify }: RegisterDubbingToolsOpts): void {
  if (passesGate(session, readGate)) {
    server.registerTool(
      "get_dubbing",
      {
        title: "Get Dubbing",
        description:
          "Read a dub made with the dubbing tool: its languages (code, status, job id, segment count), its " +
          "speakers, the original speech, what can be done to it now (capabilities) and what adding a language " +
          "would be charged for (addLanguage). job_id is the dub's job, or the job of a language added to it. " +
          'Pass language (a code the dub lists, or "source" for the original speech) to read that language\'s ' +
          "segments instead (id, speaker, start and end in seconds, text; a translated segment also carries " +
          "sourceText), a page at a time: offset and limit, with nextOffset null on the last page. " +
          "Free to read; returns JSON.",
        inputSchema: {
          job_id: z.string().min(1).describe("The dub's job id, or the job id of a language added to it."),
          language: z
            .string()
            .trim()
            .min(2)
            .max(10)
            .optional()
            .describe('Read the segments of this language: a code the dub lists, or "source" for the original speech.'),
          offset: z.number().int().min(0).optional().describe("The first segment of the page, counted from 0. Default 0."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(DUBBING_PAGE_MAX)
            .optional()
            .describe(`How many segments the page holds. Default ${DUBBING_PAGE_DEFAULT}.`),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        // An id that cannot be a job is no dub of the caller's, and it never becomes part of a path.
        if (!isUuid(args.job_id)) return refused(DUBBING_PROBLEMS.notFound)
        const res = await mcpInject(fastify, session, { method: "GET", url: `/v1/dubbing/${encodeURIComponent(args.job_id)}` })
        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        const structure = JSON.parse(res.body) as DubbingStructure
        if (args.language === undefined) return answered(JSON.stringify(dubbingOverview(structure), null, 2))

        const page = { offset: args.offset, limit: args.limit }
        // A page is written without indentation: it holds many segments, and the spaces would add up.
        if (asksForSource(args.language)) return answered(JSON.stringify(dubbingSourcePage(structure, page)))
        const language = dubbingLanguageOf(structure, args.language)
        if (!language) return refused(DUBBING_PROBLEMS.languageNotFound)
        return answered(JSON.stringify(dubbingLanguagePage(structure, language, page)))
      },
    )

    server.registerTool(
      "get_dubbing_captions",
      {
        title: "Get Dubbing Captions",
        description:
          "The captions of a dub as the text of an SRT or WebVTT file, for one language the dub lists or for " +
          'the original speech (language "source"). job_id as in get_dubbing. Free to read. To read a long ' +
          "dub's segments in pages instead, use get_dubbing with language.",
        inputSchema: {
          job_id: z.string().min(1).describe("The dub's job id, or the job id of a language added to it."),
          language: z
            .string()
            .trim()
            .min(2)
            .max(10)
            .describe('A language code the dub lists, or "source" for the original speech.'),
          format: z.enum(DUBBING_CAPTION_FORMATS).optional().describe("The file format. Default srt."),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        if (!isUuid(args.job_id)) return refused(DUBBING_PROBLEMS.notFound)
        const res = await mcpInject(fastify, session, {
          method: "GET",
          url: `/v1/dubbing/${encodeURIComponent(args.job_id)}/captions`,
          // No format of the tool's own: the route's default is the one default.
          query: { language: args.language, ...(args.format ? { format: args.format } : {}) },
        })
        if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
        return answered(res.body)
      },
    )
  }

  if (passesGate(session, writeGate)) {
    server.registerTool(
      "add_dubbing_language",
      {
        title: "Add Dubbing Language",
        description:
          "Add a language to a dub made with the dubbing tool, and start the job that delivers it: follow it with " +
          "get_job or wait_for_job, then get_dubbing lists the language. job_id as in get_dubbing. Offer it only " +
          "where get_dubbing's capabilities.addLanguage is true. Costs credits: charged per started minute of the " +
          "dub, at the price get_dubbing's addLanguage names. A language the dub already has is refused.",
        inputSchema: {
          job_id: z.string().min(1).describe("The dub's job id, or the job id of a language added to it."),
          target_language: z.string().trim().min(2).max(10).describe("The language to add (es, pt-BR, ...)."),
          confirmation_id: z
            .string()
            .uuid()
            .optional()
            .describe("The content rights confirmation, for a dub made from a link someone else holds."),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      },
      async (args) => {
        if (!isUuid(args.job_id)) return refused(DUBBING_PROBLEMS.notFound)
        return dispatchJob(fastify, session, {
          url: `/v1/dubbing/${encodeURIComponent(args.job_id)}/languages`,
          payload: {
            targetLanguage: args.target_language,
            ...(args.confirmation_id ? { confirmationId: args.confirmation_id } : {}),
            mcp_client: session.clientName,
          },
          label: "Adding a language to the dub",
        })
      },
    )
  }
}
