import { isUseCaseNodeType, usecaseResultIsText } from "@nodaro/render-rules"

/**
 * Whether the wire from pip `sourceHandle` of a node of `type` carries a
 * use-case node's episode (video or audio) — not its `json`, its `text`, or an
 * unnamed pip of a type whose result is text. The server resolver's rule. The
 * canvas's resolver (use-case-io.ts re-exports it) and its connection
 * validator (a data pip never feeds a media-only input) both read it.
 */
export function usecaseHandsOnEpisode(type: string | null | undefined, sourceHandle: string | null | undefined): boolean {
  if (!isUseCaseNodeType(type) || sourceHandle === "json" || sourceHandle === "text") return false
  return !(sourceHandle == null && usecaseResultIsText(type))
}
