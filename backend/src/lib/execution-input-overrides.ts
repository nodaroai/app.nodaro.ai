/**
 * `workflow_executions.input_overrides` (migration 466, decided 2026-10-06):
 * the input overrides a run APPLIED, pinned on its execution when it starts.
 * A later continuation of that execution re-applies exactly these
 * (`loadContinuationSource`), so what a person edits afterwards — an app run's
 * `app_runs.input_values`, rewritten by every input edit — never leaks into
 * it. NULL means "no pin": an execution made before the migration. `{}` means
 * the run applied none.
 *
 * Staging runs dev against the SHARED database, and migrations apply only at
 * the dev→main promotion — so for that window the column does not exist, and
 * a read or write that names it fails the WHOLE statement. Every site that
 * names the column goes through here (a guard test enforces it): on a
 * missing-column error it is remembered as absent for the life of the process
 * (a deploy that applies the migration restarts it), a read retries without
 * it and a write is skipped. Absent means no pin — the pre-migration reading.
 */
import { supabase } from "./supabase.js"

/** 42703: undefined column (Postgres); PGRST204: unknown column in a write (PostgREST). */
const MISSING_COLUMN_CODES = new Set(["42703", "PGRST204"])

const COLUMN = "input_overrides"

let absent = false

/** True when `error` says a named column does not exist (and records it). */
export function noteInputOverridesColumnError(error: { readonly code?: string | null } | null | undefined): boolean {
  if (!error?.code || !MISSING_COLUMN_CODES.has(error.code)) return false
  absent = true
  return true
}

/** Is the column known to be missing in this process? */
export function inputOverridesColumnAbsent(): boolean {
  return absent
}

/** `columns` plus the pin, unless the column is known to be missing. */
export function withInputOverridesColumn(columns: string): string {
  return absent ? columns : `${columns}, ${COLUMN}`
}

/** The pin a selected execution row carries: `null` when it has none (or the column was not read). */
export function pinnedInputOverridesOf(row: Readonly<Record<string, unknown>> | null | undefined): unknown {
  return row?.[COLUMN] ?? null
}

/**
 * The pin cleared, for a write that erases it (the admin app expunge): `{
 * input_overrides: null }`, or nothing once the column is known missing. A
 * caller whose write then fails with `noteInputOverridesColumnError` retries
 * with a fresh patch, which no longer names the column.
 */
export function inputOverridesCleared(): { readonly [COLUMN]?: null } {
  return absent ? {} : { [COLUMN]: null }
}

/**
 * Pin the overrides a run applies on its execution. Called once per run, when
 * it starts, by the orchestrator — the one place every lane's overrides are
 * applied (`applyInputOverridesToNodes`), after a continuation merged its
 * earlier run's pin under its own. No overrides pin `{}`. Never throws: a
 * failed pin leaves NULL, which a continuation reads as an execution from
 * before the pin (the fallback, logged here).
 */
export async function pinExecutionInputOverrides(
  executionId: string,
  overrides: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null | undefined,
): Promise<void> {
  if (absent) return
  try {
    const { error } = await supabase
      .from("workflow_executions")
      .update({ [COLUMN]: overrides ?? {} })
      .eq("id", executionId)
    if (error && noteInputOverridesColumnError(error)) return
    if (error) console.warn(`[execution-input-overrides] pin failed for execution ${executionId}: ${error.message}`)
  } catch (err) {
    console.warn(
      `[execution-input-overrides] pin failed for execution ${executionId}:`,
      err instanceof Error ? err.message : err,
    )
  }
}

/** For tests. */
export function resetInputOverridesColumnForTests(): void {
  absent = false
}
