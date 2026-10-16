import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { getJobStatus, type LibraryAsset } from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { useT } from "@/lib/i18n"
import {
  DEEP_LINK_MAX_PAGES,
  assetMatcher,
  hasDeepLinkParams,
  isJobMissingError,
  isLookupableId,
  jobLinkState,
  jobOutputUrls,
  readDeepLinkTarget,
  withoutDeepLinkParams,
  type DeepLinkTarget,
} from "./library-deep-link"

interface UseLibraryDeepLinkOptions {
  /** Every loaded file, newest first (the page's flat list). */
  readonly assets: readonly LibraryAsset[]
  /** How many pages of the list are loaded. */
  readonly pageCount: number
  /** The list query's status: nothing is concluded before its first page. */
  readonly listStatus: "pending" | "error" | "success"
  readonly hasNextPage: boolean
  readonly isFetchingNextPage: boolean
  readonly fetchNextPage: () => unknown
  /** Called once with the linked file when it is loaded. */
  readonly onFound: (index: number, asset: LibraryAsset) => void
}

export interface LibraryDeepLink {
  /** True from reading the link until it is found, missed or cancelled. */
  readonly looking: boolean
  /** Stop following the link (the person changed the view): no toast, nothing opens. */
  readonly cancel: () => void
}

/**
 * Follows a `?job=` / `?asset=` link to one file of My Files.
 *
 * The parameter is removed from the address (`replace`) the moment it is
 * read, before anything opens, so a refresh or Back never runs it again and
 * the preview's own history entry lands after the cleaned address. The file
 * is then looked for in the list the page already reads, page by page up to
 * `DEEP_LINK_MAX_PAGES`. Every miss is a toast; the page renders as usual.
 */
export function useLibraryDeepLink({
  assets,
  pageCount,
  listStatus,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
  onFound,
}: UseLibraryDeepLinkOptions): LibraryDeepLink {
  const t = useT()
  const [searchParams, setSearchParams] = useSearchParams()
  const [target, setTarget] = useState<DeepLinkTarget | null>(null)
  const onFoundRef = useRef(onFound)
  onFoundRef.current = onFound

  // The address last consumed: StrictMode runs this effect twice on one
  // snapshot, and the second run must not toast a bad link again.
  const consumedRef = useRef<string | null>(null)

  // Read the link once and take it off the address.
  useEffect(() => {
    if (!hasDeepLinkParams(searchParams)) {
      consumedRef.current = null
      return
    }
    const raw = searchParams.toString()
    if (consumedRef.current === raw) return
    consumedRef.current = raw
    const next = readDeepLinkTarget(searchParams)
    setSearchParams((prev) => withoutDeepLinkParams(prev), { replace: true })
    if (next && isLookupableId(next)) {
      setTarget(next)
    } else {
      setTarget(null)
      toast.error(t("lib.deepLinkNotFound"))
    }
  }, [searchParams, setSearchParams, t])

  const jobId = target?.kind === "job" ? target.id : undefined
  const job = useQuery({
    queryKey: queryKeys.jobs.detail(jobId ?? ""),
    queryFn: () => getJobStatus(jobId as string),
    enabled: !!jobId,
    retry: false,
    staleTime: 0,
  })
  const jobSettled = !!jobId && !job.isFetching && (job.isSuccess || job.isError)

  // A job that has no file to show ends the link here.
  useEffect(() => {
    if (!jobId || !jobSettled) return
    if (job.isError || !job.data) {
      // "No such job for you" is not found; a server error or no answer is
      // only a failure to look, and must not tell the person the file is gone.
      toast.error(t(isJobMissingError(job.error) ? "lib.deepLinkNotFound" : "lib.deepLinkFailed"))
      setTarget(null)
      return
    }
    const state = jobLinkState(job.data.status)
    if (state === "processing") {
      toast.info(t("lib.deepLinkProcessing"))
      setTarget(null)
    } else if (state === "no-result" || jobOutputUrls(job.data).length === 0) {
      toast.error(t("lib.deepLinkNoResult"))
      setTarget(null)
    }
  }, [jobId, jobSettled, job.isError, job.error, job.data, t])

  const matches = useMemo(() => {
    if (!target) return null
    if (target.kind === "asset") return assetMatcher(target, [])
    if (!jobSettled || !job.data || jobLinkState(job.data.status) !== "ready") return null
    const urls = jobOutputUrls(job.data)
    return urls.length > 0 ? assetMatcher(target, urls) : null
  }, [target, jobSettled, job.data])

  // Look for the file in the loaded pages, loading more while there are some.
  useEffect(() => {
    if (!target || !matches) return
    if (listStatus === "pending") return
    if (listStatus === "error") {
      toast.error(t("lib.deepLinkFailed"))
      setTarget(null)
      return
    }
    const index = assets.findIndex(matches)
    if (index >= 0) {
      setTarget(null)
      onFoundRef.current(index, assets[index])
      return
    }
    if (isFetchingNextPage) return
    if (hasNextPage && pageCount < DEEP_LINK_MAX_PAGES) {
      fetchNextPage()
      return
    }
    toast.error(t("lib.deepLinkNotFound"))
    setTarget(null)
  }, [target, matches, listStatus, assets, pageCount, hasNextPage, isFetchingNextPage, fetchNextPage, t])

  const cancel = useCallback(() => setTarget(null), [])
  return { looking: target !== null, cancel }
}
