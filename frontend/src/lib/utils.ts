import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { toast } from "sonner"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Copy text to clipboard with toast feedback. */
export function copyToClipboard(text: string, toastMessage = "Copied") {
  navigator.clipboard.writeText(text).then(() => toast.success(toastMessage)).catch(() => {})
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
