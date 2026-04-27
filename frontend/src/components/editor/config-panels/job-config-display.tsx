"use client"

import { useEffect, useState } from "react"
import { Loader2, AlertCircle } from "lucide-react"
import { getJobStatus } from "@/lib/api"

interface JobConfigDisplayProps {
  readonly jobId: string
}

const PROMPT_KEYS = new Set(["prompt", "userPrompt", "systemPrompt", "lyrics", "text"])
const HIDDEN_KEYS = new Set(["type", "workflowId"])

function formatKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—"
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (typeof value === "number") return String(value)
  if (Array.isArray(value)) {
    if (value.length === 0) return "(none)"
    return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ")
  }
  return JSON.stringify(value)
}

export function JobConfigDisplay({ jobId }: JobConfigDisplayProps) {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setData(null)

    getJobStatus(jobId)
      .then((job) => {
        if (cancelled) return
        const inputData = (job.input_data ?? {}) as Record<string, unknown>
        setData(inputData)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : "Failed to load config")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [jobId])

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 dark:text-[#94A3B8]">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading config…
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-red-600 dark:text-red-400">
        <AlertCircle className="w-3 h-3" />
        {error}
      </div>
    )
  }

  if (!data) return null

  const entries = Object.entries(data).filter(
    ([k, v]) => !HIDDEN_KEYS.has(k) && v !== undefined && v !== null && v !== "",
  )

  if (entries.length === 0) {
    return (
      <div className="px-3 py-2 text-xs text-gray-500 dark:text-[#94A3B8] italic">
        No config recorded.
      </div>
    )
  }

  // Promote prompt-like fields to top; render them as multi-line blocks.
  const promoted = entries.filter(([k]) => PROMPT_KEYS.has(k))
  const rest = entries.filter(([k]) => !PROMPT_KEYS.has(k))

  return (
    <dl className="text-xs space-y-2 px-3 py-2">
      {promoted.map(([k, v]) => (
        <div key={k}>
          <dt className="text-[10px] font-semibold uppercase tracking-widest text-gray-500 dark:text-[#64748B] mb-0.5">
            {formatKey(k)}
          </dt>
          <dd className="text-gray-900 dark:text-[#E2E8F0] whitespace-pre-wrap break-words">
            {formatValue(v)}
          </dd>
        </div>
      ))}
      {rest.length > 0 && (
        <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 pt-1">
          {rest.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-gray-500 dark:text-[#94A3B8]">{formatKey(k)}</dt>
              <dd className="text-gray-900 dark:text-[#E2E8F0] truncate" title={formatValue(v)}>
                {formatValue(v)}
              </dd>
            </div>
          ))}
        </div>
      )}
    </dl>
  )
}
