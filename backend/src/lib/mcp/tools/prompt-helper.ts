import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import { LLM_MODEL_IDS } from "@nodaro/shared"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { errorResult, parseFailure } from "./_verb-helpers.js"
import { config } from "../../config.js"

const executeGate: ToolGate = { required: ["workflows:execute"] }

export interface RegisterPromptHelperOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

/**
 * Delegate to `POST /v1/prompt-helper/wizard` via fastify.inject (so the credit
 * guard, Zod validation, and job lifecycle all live in the route). Same pattern
 * as `reduce`. Returns the final MCP tool result (success or typed error).
 */
async function runWizard(fastify: FastifyInstance, payload: Record<string, unknown>) {
  const res = await fastify.inject({
    method: "POST",
    url: "/v1/prompt-helper/wizard",
    headers: { "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET },
    payload,
  })
  if (res.statusCode >= 400) return errorResult(res.statusCode, res.body)
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(res.body) as Record<string, unknown>
  } catch {
    return parseFailure(res.body)
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }],
    structuredContent: parsed,
  }
}

export function registerPromptHelper({ server, session, fastify }: RegisterPromptHelperOpts): void {
  if (!passesGate(session, executeGate)) return

  const annotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false }

  server.registerTool(
    "analyze_prompt",
    {
      title: "Analyze prompt (wizard questions)",
      description:
        "Given a rough prompt idea and a target node type (e.g. generate-image, image-to-video), return guided questions with options to refine it. Pair with generate_prompt. Returns { jobId, questions }.",
      inputSchema: {
        nodeType: z.string().describe("Target node type, e.g. generate-image, image-to-video, generate-music."),
        prompt: z.string().max(5000).optional().describe("The user's rough idea. Omit to build from scratch."),
        provider: z.string().optional(),
        style: z.string().optional(),
        aspectRatio: z.string().optional(),
        duration: z.number().optional(),
        llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
      },
      annotations,
    },
    async (args) =>
      runWizard(fastify, {
        userId: session.userId,
        action: "analyze",
        nodeType: args.nodeType,
        prompt: args.prompt,
        provider: args.provider,
        style: args.style,
        aspectRatio: args.aspectRatio,
        duration: args.duration,
        llmModel: args.llmModel,
      }),
  )

  server.registerTool(
    "generate_prompt",
    {
      title: "Generate prompt from selections",
      description:
        "Given selections from analyze_prompt, build a single optimized prompt. Returns { jobId, prompt, recommendedModel? }.",
      inputSchema: {
        nodeType: z.string(),
        selections: z
          .array(z.object({ category: z.string(), value: z.string(), isCustom: z.boolean() }))
          .min(1)
          .describe("The chosen answers — one { category, value, isCustom } per question."),
        originalPrompt: z.string().max(5000).optional(),
        provider: z.string().optional(),
        style: z.string().optional(),
        aspectRatio: z.string().optional(),
        duration: z.number().optional(),
        llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
      },
      annotations,
    },
    async (args) =>
      runWizard(fastify, {
        userId: session.userId,
        action: "generate",
        nodeType: args.nodeType,
        selections: args.selections,
        originalPrompt: args.originalPrompt,
        provider: args.provider,
        style: args.style,
        aspectRatio: args.aspectRatio,
        duration: args.duration,
        llmModel: args.llmModel,
      }),
  )

  server.registerTool(
    "enhance_prompt",
    {
      title: "Enhance prompt (one-shot)",
      description:
        "Rewrite a rough idea into one optimized prompt for the target node type — no questions round-trip. Returns { jobId, prompt, recommendedModel? }.",
      inputSchema: {
        nodeType: z.string(),
        prompt: z.string().max(5000).optional().describe("The rough idea to improve. Omit to build from scratch."),
        provider: z.string().optional(),
        style: z.string().optional(),
        aspectRatio: z.string().optional(),
        duration: z.number().optional(),
        llmModel: z.enum(LLM_MODEL_IDS as [string, ...string[]]).optional(),
      },
      annotations,
    },
    async (args) =>
      runWizard(fastify, {
        userId: session.userId,
        action: "enhance",
        nodeType: args.nodeType,
        prompt: args.prompt,
        provider: args.provider,
        style: args.style,
        aspectRatio: args.aspectRatio,
        duration: args.duration,
        llmModel: args.llmModel,
      }),
  )
}
