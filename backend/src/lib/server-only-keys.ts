/**
 * A body key whose name starts with two underscores is the server's own. A
 * route's pre-handler keeps there what the server measured for the handler and
 * the price: the length a dub or an avatar run is priced by, a clip's frame
 * count. A caller never sets one, so it is dropped from every body a caller
 * sends (`middleware/server-only-body-keys.ts`, and the MCP funnel for the
 * arguments it forwards). A route that keeps something of its own on the body
 * names it this way, and is covered from the start.
 */
export const SERVER_ONLY_KEY_PREFIX = "__"

const isPlainBody = (body: unknown): body is Readonly<Record<string, unknown>> =>
  typeof body === "object" && body !== null && !Array.isArray(body) && !Buffer.isBuffer(body)

/**
 * `body` without its own top-level server-only keys: a new object when it had
 * any, else `body` itself. Nested values are left as they are, and anything
 * but a plain object (an array, a buffer, a string) is returned as is.
 */
export function withoutServerOnlyKeys<T>(body: T): T {
  if (!isPlainBody(body)) return body
  const entries = Object.entries(body)
  if (!entries.some(([key]) => key.startsWith(SERVER_ONLY_KEY_PREFIX))) return body
  return Object.fromEntries(entries.filter(([key]) => !key.startsWith(SERVER_ONLY_KEY_PREFIX))) as T
}
