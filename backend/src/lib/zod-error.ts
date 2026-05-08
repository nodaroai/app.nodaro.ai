import type { ZodError } from "zod"

/**
 * Format a ZodError into a human-readable message + a structured issues array
 * for API responses. The message includes the field path so callers (CLI,
 * SDK consumers, the frontend) actually see which field was wrong.
 *
 * Before: \`Required\` (which field?!)
 * After:  \`prompt: Required\`
 *
 * The shape is backwards-compatible: callers that only read `message` get a
 * better message; callers that read `issues` get the full breakdown.
 */
export function formatZodError(error: ZodError): {
  message: string
  issues: Array<{ path: string; message: string }>
} {
  const issues = error.issues.map((i) => ({
    path: i.path.length === 0 ? "(root)" : i.path.map(String).join("."),
    message: i.message,
  }))
  if (issues.length === 0) return { message: "Invalid request", issues }
  const first = issues[0]
  const head = first.path === "(root)" ? first.message : `${first.path}: ${first.message}`
  const message = issues.length === 1 ? head : `${head} (+${issues.length - 1} more)`
  return { message, issues }
}
