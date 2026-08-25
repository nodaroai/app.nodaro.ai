/**
 * Per-user copilot memory (M1) — storage access and the injected block.
 *
 * Every function here is TABLE-TOLERANT by design: staging and production
 * share one database and migrations apply only on the push to `main`, so
 * between dev-merge and promotion this code runs against a schema WITHOUT
 * `copilot_memories`. A missing table must read as "no memories" and write as
 * a friendly "not available yet" — never a 500 in the middle of a paid turn.
 *
 * Foreign-user memories are unreachable by query construction: every query
 * filters `user_id` (guard test drops the filter and dies).
 */
import { supabase } from "../../lib/supabase.js"
import { MEMORY_CAPS } from "./constants.js"

export interface CopilotMemory {
  id: string
  content: string
  created_at: string
}

/** Postgres "relation does not exist" — the migration has not landed yet. */
function isMissingTable(error: { code?: string | null } | null): boolean {
  return error?.code === "42P01"
}

export type RememberOutcome =
  | { kind: "saved"; memory: CopilotMemory }
  | { kind: "duplicate"; memory: CopilotMemory }
  | { kind: "full" }
  | { kind: "unavailable" }

/** Newest first. Best-effort: a missing table (or any read error) is an empty list. */
export async function listMemories(userId: string): Promise<CopilotMemory[]> {
  const { data, error } = await supabase
    .from("copilot_memories")
    .select("id, content, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(MEMORY_CAPS.maxPerUser)
  if (error || !data) return []
  return data as CopilotMemory[]
}

/**
 * Insert one memory. Content is assumed PRE-VALIDATED by the caller (the
 * remember tool owns the friendly wording for length/URL rejects); this
 * enforces the invariants that need the database: the duplicate no-op and the
 * per-user cap.
 */
export async function insertMemory(
  userId: string,
  content: string,
  sourceThreadId: string | null,
): Promise<RememberOutcome> {
  const existing = await supabase
    .from("copilot_memories")
    .select("id, content, created_at", { count: "exact" })
    .eq("user_id", userId)
  if (existing.error) {
    return isMissingTable(existing.error) ? { kind: "unavailable" } : { kind: "unavailable" }
  }
  const rows = (existing.data ?? []) as CopilotMemory[]
  const duplicate = rows.find((row) => row.content === content)
  if (duplicate) return { kind: "duplicate", memory: duplicate }
  if ((existing.count ?? rows.length) >= MEMORY_CAPS.maxPerUser) return { kind: "full" }

  const { data, error } = await supabase
    .from("copilot_memories")
    .insert({ user_id: userId, content, source_thread_id: sourceThreadId })
    .select("id, content, created_at")
    .single()
  if (error) {
    // The read-then-insert above races with a concurrent turn; the partial
    // unique index on (user_id, content) is the actual duplicate invariant.
    // 23505 therefore means "someone else just saved exactly this" — a
    // duplicate no-op, not a failure.
    if ((error as { code?: string }).code === "23505") {
      const { data: existing } = await supabase
        .from("copilot_memories")
        .select("id, content, created_at")
        .eq("user_id", userId)
        .eq("content", content)
        .maybeSingle()
      if (existing) return { kind: "duplicate", memory: existing as CopilotMemory }
    }
    return { kind: "unavailable" }
  }
  if (!data) return { kind: "unavailable" }
  return { kind: "saved", memory: data as CopilotMemory }
}

/** Owner-scoped delete. True when a row was actually removed. */
export async function deleteMemory(userId: string, memoryId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("copilot_memories")
    .delete()
    .eq("user_id", userId)
    .eq("id", memoryId)
    .select("id")
  if (error) return false
  return Array.isArray(data) && data.length > 0
}

/**
 * The preamble section. Newest-first so truncation at the budget drops the
 * OLDEST lines; empty string when there is nothing to say (no header for an
 * empty list — a standing "the user has no preferences" line would be a
 * per-turn cost buying nothing).
 */
export function renderMemoriesSection(memories: CopilotMemory[]): string {
  if (memories.length === 0) return ""
  const header =
    "Standing user preferences — the user saved these earlier and expects them honored in every thread (manage them via the panel, delete on request):"
  const lines: string[] = []
  let used = 0
  for (const memory of memories) {
    const line = `- ${memory.content}`
    if (used + line.length + 1 > MEMORY_CAPS.blockMaxChars) break
    lines.push(line)
    used += line.length + 1
  }
  if (lines.length === 0) return ""
  return `${header}\n${lines.join("\n")}`
}
