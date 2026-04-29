/**
 * Sanitize an arbitrary user-supplied string into a valid MCP tool-name suffix.
 *
 * Tool names must match `[a-zA-Z0-9_-]+` per the MCP spec, and we also want
 * tool names to be human-readable in the LLM's tools/list. We keep only
 * lowercase alphanumeric + underscore (no dashes, simpler for snake_case
 * tool prefixes like `component_`/`app_`), collapse repeated underscores,
 * trim leading/trailing underscores, and cap at 32 chars so the full prefixed
 * tool name never exceeds reasonable length budgets.
 */
const MAX_LEN = 32

export function sanitizeSlug(raw: string): string {
  let s = raw.toLowerCase().replace(/[^a-z0-9_]+/g, "_")
  s = s.replace(/_+/g, "_").replace(/^_+|_+$/g, "")
  if (s.length === 0) return "unnamed"
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN).replace(/_+$/g, "")
  return s
}

/**
 * Append `_2`, `_3`, etc. to collisions while preserving order of first
 * appearance. The factory uses this when two of the user's components/apps
 * happen to share a sanitized slug — without dedupe we'd silently drop the
 * second `registerTool` call (the SDK overwrites by name).
 */
export function dedupeSlugs(slugs: string[]): string[] {
  const seen = new Map<string, number>()
  return slugs.map((s) => {
    const count = seen.get(s) ?? 0
    seen.set(s, count + 1)
    return count === 0 ? s : `${s}_${count + 1}`
  })
}
