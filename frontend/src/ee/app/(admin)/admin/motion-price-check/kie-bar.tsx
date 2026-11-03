/**
 * Admin → Motion price check: KIE's own figures for the range.
 *
 * The admin pastes a KIE dashboard session token, as Credit Audit takes it.
 * The token lives in this bar's state alone: never in storage, the address,
 * a query key or a log, and it is sent only with the KIE call (no form
 * either, so no browser offers to save it). Until a fetch, Paid $ is what
 * our steps recorded; a fetch reads "N of M tasks matched" (and, when more
 * matched than the map holds, how many were applied), and each KIE endpoint
 * that failed or stopped at the page cap gets its own line. The fetch under
 * way, its result and those lines are one live region.
 */
import { useId, useState } from "react"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { KieRealResult } from "@/ee/lib/motion-price-check-api"
import { formatClock, formatCount } from "./format"

const NOT_FETCHED = "Not fetched — paid shows recorded costs"

/** The status line: the fetch under way, nothing fetched yet, or what matched. */
function statusLine(kie: KieRealResult | null, pending: boolean): string {
  if (pending) return "Fetching KIE real costs…"
  if (kie === null) return NOT_FETCHED
  const matched = `${formatCount(kie.matched)} of ${formatCount(kie.motionTasks)} tasks matched (fetched ${formatClock(kie.fetchedAt)})`
  if (!kie.truncated) return matched
  // The map holds only the first tasks matched; the rest are paid at what their steps recorded.
  return `${matched}; only the first ${formatCount(Object.keys(kie.kieUsd).length)} are applied, the rest show recorded costs`
}

/** What the fetch could not read: each failed endpoint, then each one at the page cap. */
function partialLines(kie: KieRealResult): string[] {
  return [
    ...Object.entries(kie.errors).map(([endpoint, error]) => `KIE real partial: ${endpoint}: ${error}`),
    ...kie.capped.map((endpoint) => `KIE real partial: ${endpoint}: stopped at the page cap; later records were not read`),
  ]
}

export function KieBar({
  kie,
  pending,
  error,
  onFetch,
  disabled = false,
}: {
  kie: KieRealResult | null
  pending: boolean
  error: string | null
  onFetch(token: string): void
  /** No range the page can ask for: nothing to fetch for. */
  disabled?: boolean
}) {
  const tokenId = useId()
  const [token, setToken] = useState("")
  const ready = token.trim() !== "" && !pending && !disabled

  return (
    <section aria-label="KIE real costs" className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label htmlFor={tokenId} className="text-xs font-medium text-muted-foreground">
            KIE dashboard token
          </label>
          <Input
            id={tokenId}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="Paste the authorization header from KIE's logs"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="h-11 font-mono text-xs"
          />
        </div>
        <Button type="button" className="h-11 shrink-0" disabled={!ready} onClick={() => onFetch(token.trim())}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          Fetch KIE real costs
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Open KIE&apos;s dashboard logs → DevTools → Network → copy the <code>authorization</code> header value from any request
      </p>
      <div role="status" className="space-y-1">
        <p className="break-words text-sm">{statusLine(kie, pending)}</p>
        {!pending &&
          kie !== null &&
          partialLines(kie).map((line) => (
            <p key={line} className="break-words text-sm text-amber-700 dark:text-amber-400">
              {line}
            </p>
          ))}
      </div>
      {error !== null && (
        <p role="alert" className="break-words text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  )
}
