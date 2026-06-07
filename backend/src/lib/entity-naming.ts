import { supabase } from "./supabase.js"

/**
 * Find an unused name for (table, userId), case-insensitively, skipping
 * soft-deleted rows. Returns baseName or "baseName N". Generalized from the
 * character-private original so locations/objects can reuse it.
 */
export async function deriveAvailableName(
  table: "characters" | "locations" | "objects",
  userId: string,
  baseName: string,
): Promise<string> {
  const { data } = await supabase
    .from(table)
    .select("name")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .ilike("name", `${baseName}%`)
  const existing = new Set<string>((data ?? []).map((r) => (r.name as string).toLowerCase()))
  if (!existing.has(baseName.toLowerCase())) return baseName
  for (let n = 2; n < 1000; n++) {
    const candidate = `${baseName} ${n}`
    if (!existing.has(candidate.toLowerCase())) return candidate
  }
  throw new Error(`No available name based on '${baseName}'`)
}
