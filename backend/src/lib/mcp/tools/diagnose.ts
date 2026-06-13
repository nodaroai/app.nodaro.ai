import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import type { McpSession } from "../session.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import { supabase } from "../../supabase.js"

const diagnoseGate: ToolGate = { required: ["jobs:read"] }

export interface RegisterDiagnoseOpts {
  server: McpServer
  session: McpSession
  /** Kept for registrar symmetry; handler queries Supabase directly. */
  fastify: FastifyInstance
}

export type FailureClass =
  | "content_policy"
  | "validation"
  | "rate_limited"
  | "timeout"
  | "post_processing"
  | "provider_error"
  | "unknown"

const REMEDIATION: Record<FailureClass, string> = {
  content_policy:
    "The provider rejected the prompt or input under its content policy. Rephrase the prompt or swap the input, then re-run.",
  validation:
    "An input failed validation. Check the node's required fields and value formats (provider, aspect ratio, duration…), then re-run.",
  rate_limited:
    "The provider was rate-limited or out of quota/credits. Wait and re-run, or lower workflow concurrency.",
  timeout:
    "A transient network/timeout error. Re-running the node usually succeeds.",
  post_processing:
    "Generation likely succeeded but a post-processing step (encode/upload/merge) failed. Re-run the node. Reserved credits for post-delivery failures are NOT auto-refunded — check creditsActual.",
  provider_error:
    "The provider returned an error. Read the message; if it's about inputs, adjust parameters, then retry.",
  unknown:
    "No error detail was recorded. Re-run the node; if it recurs, inspect the job with get_job.",
}

function mk(cls: FailureClass): { class: FailureClass; remediation: string } {
  return { class: cls, remediation: REMEDIATION[cls] }
}

/**
 * Best-effort, heuristic classification of a failure from its persisted error
 * string. The worker stores the raw `error.message` (not the error type), so a
 * post-delivery failure is recognized only by message keywords — treat the
 * class as a hint, not a guarantee. Post-processing keywords are checked
 * before validation on purpose: "ffmpeg failed: invalid codec" is a
 * post-processing failure even though it contains "invalid".
 */
export function classifyFailure(
  message: string | null | undefined,
): { class: FailureClass; remediation: string } {
  const m = (message ?? "").toLowerCase().trim()
  if (!m) return mk("unknown")
  if (/moderat|nsfw|safety|sensitive|content policy|flagged|prohibited/.test(m))
    return mk("content_policy")
  if (
    /rate.?limit|too many requests|\b429\b|quota|insufficient.*(balance|credit)|out of credit/.test(
      m,
    )
  )
    return mk("rate_limited")
  if (/timed out|timeout|etimedout|econnreset|econnrefused|socket hang|network/.test(m))
    return mk("timeout")
  if (/ffmpeg|transcode|watermark|\br2\b|\bmux\b|stitch|re-?encode|post-?process|upload|concat/.test(m))
    return mk("post_processing")
  if (/\b(invalid|required|missing|unsupported|must be|bad request|validation|not allowed)\b|\b400\b/.test(m))
    return mk("validation")
  return mk("provider_error")
}

const CREDITS_NOTE =
  "Reserved credits for failed nodes are automatically refunded EXCEPT post-delivery (post_processing) failures, where the provider was already billed. creditsActual is the committed charge (null = not committed / refunded)."

interface NodeState {
  status?: string
  nodeType?: string
  jobId?: string
  error?: string
}

interface JobRow {
  id?: string
  error_message?: string | null
  input_data?: Record<string, unknown> | null
  credits_actual?: number | null
}

function providerOf(input: Record<string, unknown> | null | undefined): string | null {
  if (!input || typeof input !== "object") return null
  const p = input["provider"] ?? input["model"]
  return typeof p === "string" ? p : null
}

interface Failure {
  nodeId: string
  nodeType: string | null
  jobId: string | null
  provider: string | null
  error: string | null
  class: FailureClass
  remediation: string
  creditsActual: number | null
}

function buildFailure(
  nodeId: string,
  nodeType: string | null,
  jobId: string | null,
  error: string | null,
  provider: string | null,
  creditsActual: number | null,
): Failure {
  const { class: cls, remediation } = classifyFailure(error)
  return { nodeId, nodeType, jobId, provider, error, class: cls, remediation, creditsActual }
}

export function registerDiagnose({ server, session }: RegisterDiagnoseOpts): void {
  if (!passesGate(session, diagnoseGate)) return

  server.registerTool(
    "diagnose_run",
    {
      title: "Diagnose Run",
      description:
        "Diagnose why a workflow run or single job failed. Pass a workflow execution id OR a job id; " +
        "returns each failed node with its error, a best-effort failure class " +
        "(content_policy / validation / rate_limited / timeout / post_processing / provider_error / unknown), " +
        "a remediation hint, and the credits actually charged.",
      inputSchema: {
        id: z.string().min(1).describe("A workflow execution id or a job id"),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      // 1) Try as a workflow execution.
      const { data: execution, error: execErr } = await supabase
        .from("workflow_executions")
        .select(
          "id, status, node_states, error_message, total_credits_used, started_at, completed_at, user_id",
        )
        .eq("id", args.id)
        .eq("user_id", session.userId)
        .maybeSingle()
      if (execErr) {
        return {
          content: [{ type: "text", text: `Error: ${execErr.message}` }],
          isError: true,
        }
      }

      if (execution) {
        const nodeStates = (execution.node_states ?? {}) as Record<string, NodeState>
        const failedEntries = Object.entries(nodeStates).filter(
          ([, s]) => s.status === "failed",
        )
        const jobIds = failedEntries
          .map(([, s]) => s.jobId)
          .filter((j): j is string => typeof j === "string" && j.length > 0)

        const jobMap = new Map<string, JobRow>()
        if (jobIds.length > 0) {
          const { data: jobs } = await supabase
            .from("jobs")
            .select("id, error_message, input_data, credits_actual")
            .in("id", jobIds)
          for (const j of (jobs ?? []) as JobRow[]) {
            if (j.id) jobMap.set(j.id, j)
          }
        }

        const failures: Failure[] = failedEntries.map(([nodeId, s]) => {
          const job = s.jobId ? jobMap.get(s.jobId) : undefined
          const error = job?.error_message ?? s.error ?? null
          return buildFailure(
            nodeId,
            s.nodeType ?? null,
            s.jobId ?? null,
            error,
            providerOf(job?.input_data),
            job?.credits_actual ?? null,
          )
        })

        const total = Object.keys(nodeStates).length
        const summary = failures.length
          ? `${failures.length} of ${total} node(s) failed`
          : "No node failures recorded"
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  id: execution.id,
                  kind: "execution",
                  status: execution.status,
                  summary,
                  executionError: execution.error_message ?? null,
                  failures,
                  creditsNote: CREDITS_NOTE,
                },
                null,
                2,
              ),
            },
          ],
        }
      }

      // 2) Fall back to a single job.
      const { data: job, error: jobErr } = await supabase
        .from("jobs")
        .select(
          "id, status, error_message, input_data, credits_actual, job_type, user_id",
        )
        .eq("id", args.id)
        .eq("user_id", session.userId)
        .maybeSingle()
      if (jobErr) {
        return {
          content: [{ type: "text", text: `Error: ${jobErr.message}` }],
          isError: true,
        }
      }
      if (!job) {
        return {
          content: [
            {
              type: "text",
              text: `No workflow execution or job found for id ${args.id} (or it isn't yours).`,
            },
          ],
          isError: true,
        }
      }

      const j = job as JobRow & { status?: string; job_type?: string }
      const failures: Failure[] =
        j.status === "failed"
          ? [
              buildFailure(
                j.id ?? args.id,
                (j.job_type as string) ?? null,
                j.id ?? args.id,
                j.error_message ?? null,
                providerOf(j.input_data),
                j.credits_actual ?? null,
              ),
            ]
          : []
      const summary =
        j.status === "failed" ? "Job failed" : `Job status: ${j.status}`
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: j.id ?? args.id,
                kind: "job",
                status: j.status,
                summary,
                failures,
                creditsNote: CREDITS_NOTE,
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )
}
