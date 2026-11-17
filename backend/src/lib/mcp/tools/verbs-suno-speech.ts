/**
 * `suno_speech` — Suno's expressive speech: the MCP face of
 * POST /v1/suno-speech (the Suno Speech node, decided 2026-11-17). Registered
 * beside the other `suno_*` verbs by `registerAudioVerbs`. The node's type is
 * read from the unit that declares this tool (`mcp.widgetModelFor`), so the
 * verb names no type id; its limits are the route's own (`@nodaro/render-rules`
 * suno-speech).
 */
import { z } from "zod"
import { SUNO_SPEECH_LIMITS, SUNO_SPEECH_VOCAL_GENDERS, sunoSpeechProblem, sunoSpeechRun } from "@nodaro/render-rules"
import { widgetModelOf } from "../widget-models.js"
import { WIDGET_URI } from "../widgets/registrar.js"
import type { RegisterOpts } from "./verbs-image.js"
import { dispatchJob, JOB_OUTPUT_SCHEMA, uiMeta } from "./_verb-helpers.js"
import { creditHint } from "./_credit-hint.js"

export const SUNO_SPEECH_TOOL = "suno_speech"

export function sunoSpeechDescription(nodeType: string): string {
  const l = SUNO_SPEECH_LIMITS
  return (
    "Spoken audio with Suno Speech — expressive delivery (tone, rhythm, emotion) with optional background music; not a fixed-voice text-to-speech. Two modes:\n" +
    `- Brief (\`mode: "brief"\`, default): \`prompt\`, a one-line scene description (1–${l.promptMax} characters); Suno writes the script and performs it.\n` +
    `- Script (\`mode: "script"\`): \`script\`, the words to speak (1–${l.scriptMax} characters, multiline), plus optional \`tone\` (tone, rhythm, emotion, setting, accent; up to ${l.toneMax}), ` +
    `\`variety\` (${l.varietyMin} exact style … ${l.varietyMax} unreasonably varied), \`vocal_gender\` (female / male; unset, the model picks) and \`background_music\` (true / false).\n` +
    "A field of the other mode is ignored. Returns a job_id; each run makes two takes (`outputData.audioUrls`, the first is `audioUrl`, each with its duration in `sunoTracks`). " +
    `Price: ${creditHint(nodeType)} per run.`
  )
}

export function registerSunoSpeechVerb({ server, session, fastify }: RegisterOpts): void {
  const nodeType = widgetModelOf(SUNO_SPEECH_TOOL)
  const l = SUNO_SPEECH_LIMITS
  server.registerTool(
    SUNO_SPEECH_TOOL,
    {
      title: "Suno Speech",
      description: sunoSpeechDescription(nodeType),
      inputSchema: {
        mode: z.enum(["brief", "script"]).optional().describe('"brief" (default): Suno writes the script from `prompt`. "script": it speaks `script`.'),
        // The route's own caps: twice each limit raw, so padding is trimmed, not refused; the limits themselves are checked below, after trimming.
        prompt: z.string().max(l.promptMax * 2).optional().describe("Brief mode: a one-line scene description."),
        script: z.string().max(l.scriptMax * 2).optional().describe("Script mode: the words to speak (multiline)."),
        tone: z.string().max(l.toneMax * 2).optional().describe("Script mode: tone, rhythm, emotion and setting (accent, accompaniment)."),
        variety: z.number().int().min(l.varietyMin).max(l.varietyMax).optional().describe("Script mode: how far the two takes differ, 0-4."),
        vocal_gender: z.enum(SUNO_SPEECH_VOCAL_GENDERS).optional().describe("Script mode: the voice gender. Unset: the model picks."),
        background_music: z.boolean().optional().describe("Script mode: add background music."),
      },
      outputSchema: JOB_OUTPUT_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      _meta: uiMeta(WIDGET_URI.jobAudio),
    },
    async (args) => {
      const run = sunoSpeechRun({
        mode: args.mode,
        prompt: args.prompt,
        script: args.script,
        tone: args.tone,
        variety: args.variety,
        vocalGender: args.vocal_gender,
        backgroundMusic: args.background_music,
      })
      const problem = sunoSpeechProblem(run)
      if (problem) return { content: [{ type: "text" as const, text: problem }], isError: true as const }
      return dispatchJob(fastify, session, {
        // The route's literal path, so the surface checker reads the route this tool calls.
        url: "/v1/suno-speech",
        payload: { ...run, mcp_client: session.clientName, userId: session.userId },
        label: "Suno speech",
        widgetKind: "audio",
        widgetData: { prompt: run.mode === "brief" ? (run.prompt ?? "") : (run.script ?? ""), model: nodeType },
      })
    },
  )
}
