import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { toast } from "sonner"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Narrow an unknown value to a non-empty string, else undefined. For reading
 *  loosely-typed bag fields (job `input_data`, index-signature node data) as
 *  display strings. */
export function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined
}

/** Copy text to clipboard with toast feedback. */
export function copyToClipboard(text: string, toastMessage = "Copied") {
  navigator.clipboard.writeText(text).then(() => toast.success(toastMessage)).catch(() => {})
}

/** Format an ISO timestamp as a relative time string ("2h ago", "3d ago"). */
export function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return "just now"
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const d = Math.floor(hr / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

/** Download text content as a .txt file. */
export function downloadTextFile(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Pure computation for result deletion — returns update data for updateNodeData. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function computeDeleteResultUpdates(
  results: readonly any[],
  activeIndex: number,
  indexToDelete: number,
  syncKey?: string,
  syncField = "url",
): Record<string, unknown> {
  const newResults = results.filter((_: unknown, i: number) => i !== indexToDelete)
  let newActiveIndex = activeIndex
  if (indexToDelete === activeIndex) newActiveIndex = 0
  else if (indexToDelete < activeIndex) newActiveIndex = activeIndex - 1
  const updates: Record<string, unknown> = {
    generatedResults: newResults,
    activeResultIndex: newActiveIndex,
  }
  if (syncKey) {
    updates[syncKey] = newResults[newActiveIndex]?.[syncField]
  }
  return updates
}
