import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useT } from "@/lib/i18n"
import { listHeldJobs } from "@/ee/lib/review-api"
import { HeldJobCard, REVIEW_QUERY_KEY } from "./held-job-card"
import { DecisionsTab } from "./decisions-tab"

/**
 * Admin → Content Review (spec §8.3).
 *
 * The queue is a FIFO of generations a registered job policy parked for a
 * human: the credits stay reserved and nothing is published until someone
 * decides. Two tabs, because the log answers a different question from the
 * queue ("was this checked, and by whom") and is the only surface a `flag`
 * ever reaches.
 *
 * On a deployment with no policy registered this page is a permanently empty
 * queue — the same "nothing to do here" state as `/admin/stuck-pipelines`, not
 * an error.
 *
 * DIRECTION: logical Tailwind properties only (`ms-`/`me-`/`ps-`/`pe-`/
 * `text-start`). `rtl:` / `ltr:` variants are banned repo-wide and
 * `lib/__tests__/rtl-direction-guards.test.ts` walks all of `frontend/src`.
 * This is the first `useT()` admin page; the surrounding chrome
 * (`admin-layout.tsx`) still uses physical classes, so a Hebrew operator gets
 * a correct page inside a not-yet-mirrored shell — better than today, and
 * converting the layout is its own change (Q13).
 */
export default function AdminReviewPage() {
  const t = useT()
  const queryClient = useQueryClient()
  const [policyId, setPolicyId] = useState("")
  const [userId, setUserId] = useState("")

  const { data, isLoading, isError } = useQuery({
    queryKey: [...REVIEW_QUERY_KEY, "jobs", { policyId, userId }],
    queryFn: () =>
      listHeldJobs({
        policyId: policyId.trim() || undefined,
        userId: userId.trim() || undefined,
      }),
  })

  const jobs = data?.data ?? []

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("adminReview.title")}</h1>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("adminReview.subtitle")}</p>
      </header>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">
            {t("adminReview.tabQueue")}
            {(data?.total ?? 0) > 0 && (
              <span className="ms-2 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {data?.total}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="decisions">{t("adminReview.tabDecisions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="queue" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              className="w-48"
              value={policyId}
              onChange={(e) => setPolicyId(e.target.value)}
              placeholder={t("adminReview.filterPolicy")}
              aria-label={t("adminReview.filterPolicy")}
            />
            <Input
              className="w-72"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder={t("adminReview.filterUser")}
              aria-label={t("adminReview.filterUser")}
            />
            <Button
              variant="outline"
              size="sm"
              aria-label={t("exec.refresh")}
              onClick={() => void queryClient.invalidateQueries({ queryKey: REVIEW_QUERY_KEY })}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>

          {isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
          {isError && <p className="text-sm text-destructive">{t("adminReview.loadError")}</p>}
          {/* An empty queue is the GOOD state, so it reads as a sentence and
              not as a spinner that never resolves. */}
          {!isLoading && !isError && jobs.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("adminReview.emptyQueue")}</p>
          )}
          {jobs.map((job) => (
            <HeldJobCard key={job.jobId} job={job} />
          ))}
        </TabsContent>

        <TabsContent value="decisions">
          <DecisionsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
