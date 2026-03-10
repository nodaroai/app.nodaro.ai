/**
 * Credit Cost Audit Logger
 *
 * Logs audit entries to the credit_cost_audit table for monitoring
 * pricing discrepancies between expected and actual KIE.ai costs.
 *
 * Usage in provider modules:
 *   import { logCreditAudit } from "../../lib/credit-audit.js"
 *   await logCreditAudit({ modelKey: "kling-3.0", ... })
 */

import { supabase } from "./supabase.js"

export interface CreditAuditEntry {
  jobId?: string
  modelKey: string
  modelConfig?: Record<string, unknown>
  expectedKieCredits?: number
  actualKieCredits?: number
  expectedNodaroCredits?: number
  nodaroCreditIdentifier?: string
  rawResponseSample?: unknown
  notes?: string
}

/**
 * Log a credit cost audit entry. Never throws — errors are logged silently.
 * This is fire-and-forget to avoid affecting the main request flow.
 */
export async function logCreditAudit(entry: CreditAuditEntry): Promise<void> {
  try {
    // Truncate raw response to ~2KB to avoid bloating the table
    let rawSample = entry.rawResponseSample
    if (rawSample) {
      const json = JSON.stringify(rawSample)
      if (json.length > 2048) {
        rawSample = JSON.parse(json.substring(0, 2048) + '..."')
      }
    }

    // Determine mismatch
    const mismatch = entry.expectedKieCredits != null &&
      entry.actualKieCredits != null &&
      entry.expectedKieCredits !== entry.actualKieCredits

    const { error } = await supabase
      .from("credit_cost_audit")
      .insert({
        job_id: entry.jobId || null,
        model_key: entry.modelKey,
        model_config: entry.modelConfig || null,
        expected_kie_credits: entry.expectedKieCredits ?? null,
        actual_kie_credits: entry.actualKieCredits ?? null,
        expected_nodaro_credits: entry.expectedNodaroCredits ?? null,
        nodaro_credit_identifier: entry.nodaroCreditIdentifier || null,
        raw_response_sample: rawSample || null,
        mismatch,
        notes: entry.notes || null,
      })

    if (error) {
      // Silent fail — don't disrupt the main flow
      console.warn("[credit-audit] Failed to log audit entry:", error.message)
    }
  } catch (err) {
    console.warn("[credit-audit] Failed to log audit entry:", (err as Error).message)
  }
}

/** Known credit-related field names that might appear in KIE API responses */
const CREDIT_FIELD_NAMES = [
  "creditsCost", "credits_cost", "credit_cost", "creditsUsed", "credits_used",
  "credit", "credits", "cost", "balance", "balanceAfter", "balance_after",
  "consumed", "deducted", "charge", "price", "fee",
]

/**
 * Extract any credit-related fields from a raw API response.
 * KIE API responses don't have documented credit fields, but this
 * searches for any hidden fields that might contain cost data.
 */
export function extractCreditFields(rawResponse: unknown): Record<string, unknown> | null {
  if (!rawResponse || typeof rawResponse !== "object") return null

  const found: Record<string, unknown> = {}
  const obj = rawResponse as Record<string, unknown>

  function searchObject(o: Record<string, unknown>, prefix: string) {
    for (const [key, value] of Object.entries(o)) {
      const fullKey = prefix ? `${prefix}.${key}` : key
      const lowerKey = key.toLowerCase()

      if (CREDIT_FIELD_NAMES.some(f => lowerKey.includes(f.toLowerCase()))) {
        found[fullKey] = value
      }

      if (value && typeof value === "object" && !Array.isArray(value)) {
        searchObject(value as Record<string, unknown>, fullKey)
      }
    }
  }

  searchObject(obj, "")
  return Object.keys(found).length > 0 ? found : null
}
