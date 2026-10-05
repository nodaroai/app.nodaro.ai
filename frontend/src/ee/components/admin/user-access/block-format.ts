import type { BlockDays } from "@/ee/hooks/queries/use-admin-access"

/**
 * Small display helpers shared by the access panel and the Blocks page.
 * Admin surfaces are English-only (exempt from the copy guard).
 */

/** The durations the server accepts for a network block (ee/lib/network-blocking.ts). */
export const BLOCK_DAYS: readonly BlockDays[] = [1, 7, 30, 90]

export const DEFAULT_BLOCK_DAYS: BlockDays = 30

export function blockDaysLabel(days: BlockDays): string {
  return days === 1 ? "1 day" : `${days} days`
}

/** "1 account", "2 accounts". */
export function countOf(n: number, one: string, many: string): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`
}

export function formatBlockDate(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleDateString() : "—"
}

export function formatBlockDateTime(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "—"
}
