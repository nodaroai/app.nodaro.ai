import { useCallback } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { listTelegramAccounts, type TelegramAccountSummary } from "@/lib/api"
import { isCloud } from "@/lib/edition"

const NONE: ReadonlyArray<TelegramAccountSummary> = []

/**
 * Codes that mean "this deployment does not offer Telegram accounts to this
 * caller" rather than "something broke": the route is absent or hidden
 * (not_found — including everyone outside the preview audience), the host is
 * too old (feature_unavailable), or the caller is not on a browser session.
 */
const NOT_OFFERED = new Set(["not_found", "feature_unavailable", "in_app_only", "unauthorized"])

function codeOf(err: unknown): string | undefined {
  return err instanceof Error ? ((err as { code?: unknown }).code as string | undefined) : undefined
}

/**
 * The caller's connected Telegram accounts — and whether the feature exists
 * for them at all. `available` is `true` once the server answered, `false`
 * when it said the feature is not offered here, `null` while unknown, so the
 * card renders nothing until it knows (no flash for callers who never get it).
 */
export function useTelegramAccounts() {
  const qc = useQueryClient()
  const cloud = isCloud()
  const query = useQuery({
    queryKey: queryKeys.telegramAccounts.list(),
    queryFn: async () => (await listTelegramAccounts()).accounts,
    enabled: cloud,
    staleTime: 30_000,
    retry: false,
  })
  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: queryKeys.telegramAccounts.all }), [qc])

  const notOffered = !cloud || NOT_OFFERED.has(codeOf(query.error) ?? "")
  return {
    available: notOffered ? false : query.isSuccess ? true : query.isError ? true : null,
    accounts: query.data ?? NONE,
    loading: query.isLoading,
    error: query.isError && !notOffered,
    refresh,
  }
}
