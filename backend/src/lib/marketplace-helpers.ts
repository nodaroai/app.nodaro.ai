import { supabase } from "./supabase.js"

export function sanitizeSlugBase(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
}

export function generateSlug(name: string): string {
  const base = sanitizeSlugBase(name)
  const suffix = Math.random().toString(36).slice(2, 8)
  return `${base}-${suffix}`
}

export async function getCreatorDisplayName(userId: string): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .single()
  if (!data) return null
  return data.full_name || data.email || null
}
