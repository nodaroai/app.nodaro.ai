import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useT } from "@/lib/i18n"
import type { MessageKey } from "@/lib/i18n/en"
import { listReviewDecisions, type ReviewDecision } from "@/ee/lib/review-api"

/**
 * The decisions log — every gate verdict and every human resolution, in one
 * place. It is the surface a `flag` reaches (a flag writes nothing on the job
 * row, by design) and it is the mitigation §8.2 relies on: with no bulk verb
 * and a resolver on every row, a hold-everything / reject-everything pattern is
 * visible here rather than inferred from the credit ledger.
 *
 * The withheld payload is not in the wire shape and must never be rendered
 * here — a log is exactly where a URL would linger longest.
 */

const VERDICT_KEYS: Record<string, MessageKey> = {
  allow: "adminReview.verdictAllow",
  flag: "adminReview.verdictFlag",
  block: "adminReview.verdictBlock",
  hold: "adminReview.verdictHold",
  approve: "adminReview.verdictApprove",
  reject: "adminReview.verdictReject",
}

const HOOK_KEYS: Record<string, MessageKey> = {
  request: "adminReview.hookRequest",
  result: "adminReview.hookResult",
  review: "adminReview.hookReview",
}

export function DecisionsTab() {
  const t = useT()
  const [policyId, setPolicyId] = useState("")
  const [verdict, setVerdict] = useState("")
  const [hookPoint, setHookPoint] = useState("")

  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "review", "decisions", { policyId, verdict, hookPoint }],
    // `jobId` is a supported filter on the route and on `listReviewDecisions`;
    // there is no honest label for it in the dictionary yet (the nearest key
    // reads "Type"), so the input waits for its own key rather than shipping
    // mislabelled. The natural entry point is a per-card "decisions for this
    // job" link.
    queryFn: () =>
      listReviewDecisions({
        policyId: policyId.trim() || undefined,
        verdict: verdict || undefined,
        hookPoint: hookPoint || undefined,
      }),
  })

  const rows: ReviewDecision[] = data?.data ?? []

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Input
          className="w-48"
          value={policyId}
          onChange={(e) => setPolicyId(e.target.value)}
          placeholder={t("adminReview.filterPolicy")}
          aria-label={t("adminReview.filterPolicy")}
        />
        {/* Native selects on purpose: this is a two-option filter row, and the
            page carries enough Radix already. */}
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={verdict}
          onChange={(e) => setVerdict(e.target.value)}
          aria-label={t("adminReview.filterVerdict")}
        >
          <option value="">{t("adminReview.filterVerdict")}</option>
          {Object.entries(VERDICT_KEYS).map(([value, key]) => (
            <option key={value} value={value}>
              {t(key)}
            </option>
          ))}
        </select>
        <select
          className="h-9 rounded-md border bg-background px-2 text-sm"
          value={hookPoint}
          onChange={(e) => setHookPoint(e.target.value)}
          aria-label={t("adminReview.filterHookPoint")}
        >
          <option value="">{t("adminReview.filterHookPoint")}</option>
          {Object.entries(HOOK_KEYS).map(([value, key]) => (
            <option key={value} value={value}>
              {t(key)}
            </option>
          ))}
        </select>
      </div>

      {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
      {isError && <p className="text-sm text-destructive">{t("adminReview.loadError")}</p>}
      {!isLoading && !isError && rows.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("adminReview.emptyDecisions")}</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-start text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground">
                <th className="p-2 text-start">{t("adminReview.filterHookPoint")}</th>
                <th className="p-2 text-start">{t("adminReview.policyLabel")}</th>
                <th className="p-2 text-start">{t("adminReview.filterVerdict")}</th>
                <th className="p-2 text-start">{t("adminReview.reasonLabel")}</th>
                <th className="p-2 text-start">{t("adminReview.resolver")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t align-top">
                  <td className="p-2">{HOOK_KEYS[row.hookPoint] ? t(HOOK_KEYS[row.hookPoint]) : row.hookPoint}</td>
                  <td className="p-2 font-mono text-xs">{row.policyId}</td>
                  <td className="p-2">{VERDICT_KEYS[row.verdict] ? t(VERDICT_KEYS[row.verdict]) : row.verdict}</td>
                  <td className="p-2 whitespace-pre-wrap break-words font-mono text-xs">{row.reason ?? "—"}</td>
                  <td className="p-2 text-xs">{row.resolverEmail ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
