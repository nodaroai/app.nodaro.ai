// Publishing: the trend's status, the version users see against the one being
// edited, Publish / Unpublish, why a publish was refused (one line per
// reason), and what each environment's Cast Swap engine reports it supports —
// a trend is published only when every environment can run it.

import { Loader2, Upload, EyeOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AdminTrendRow, TrendEngineEnvironment, TrendPublishBlocker } from "@/lib/api"
import { useEngineEnvironments } from "@/ee/hooks/queries/use-admin-queries"
import { describeBlocker } from "../model"
import { StatusBadge } from "./StatusBadge"

interface Props {
  readonly trend: AdminTrendRow
  readonly dirty: boolean
  readonly blockers: TrendPublishBlocker[] | null
  readonly publishing: boolean
  readonly unpublishing: boolean
  readonly onPublish: () => void
  readonly onUnpublish: () => void
}

export function PublishBar({ trend, dirty, blockers, publishing, unpublishing, onPublish, onUnpublish }: Props) {
  const envs = useEngineEnvironments()
  const ahead = trend.publishedVersion !== null && trend.publishedVersion !== trend.draftVersion

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <StatusBadge status={trend.status} />
        <span>
          Editing v{trend.draftVersion}
          {trend.publishedVersion !== null ? ` · users see v${trend.publishedVersion}` : " · never published"}
        </span>
        {ahead && trend.status === "published" && <span className="text-xs text-amber-600 dark:text-amber-400">Draft changes are not live yet.</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" className="min-h-9" disabled={dirty || publishing} onClick={onPublish}>
          {publishing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Upload className="mr-1 h-4 w-4" />}
          Publish
        </Button>
        {trend.status === "published" && (
          <Button type="button" variant="outline" className="min-h-9" disabled={unpublishing} onClick={onUnpublish}>
            {unpublishing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <EyeOff className="mr-1 h-4 w-4" />}
            Unpublish
          </Button>
        )}
        {dirty && <span className="text-xs text-muted-foreground">Save first: publishing publishes the saved draft.</span>}
      </div>

      {blockers && blockers.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <p className="mb-1 font-medium text-destructive">Not published:</p>
          <ul aria-label="Why it can't be published" className="list-disc space-y-0.5 pl-5">
            {blockers.map((r, i) => (
              <li key={i}>{describeBlocker(r)}</li>
            ))}
          </ul>
        </div>
      )}

      <EngineTable envs={envs.data} loading={envs.isLoading} error={envs.error} />
    </div>
  )
}

const yes = (b: boolean | undefined) => (b ? "yes" : "no")

function EngineTable({
  envs,
  loading,
  error,
}: {
  readonly envs: TrendEngineEnvironment[] | undefined
  readonly loading: boolean
  readonly error: Error | null
}) {
  if (loading) return <p className="text-xs text-muted-foreground">Loading engine environments…</p>
  if (error) return <p className="text-xs text-destructive">{error.message}</p>
  if (!envs || envs.length === 0) return <p className="text-xs text-muted-foreground">No environment has reported its engine yet.</p>
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full min-w-[560px] text-xs">
        <caption className="px-3 py-2 text-left font-medium">Cast Swap engine by environment</caption>
        <thead>
          <tr className="border-y bg-muted/50 text-left">
            <th className="px-3 py-1.5 font-medium">Environment</th>
            <th className="px-3 py-1.5 font-medium">Plugin</th>
            <th className="px-3 py-1.5 font-medium">Slot kinds</th>
            <th className="px-3 py-1.5 font-medium">References</th>
            <th className="px-3 py-1.5 font-medium">Resolutions</th>
            <th className="px-3 py-1.5 font-medium">Full Quality</th>
            <th className="px-3 py-1.5 font-medium">Trend runs</th>
            <th className="px-3 py-1.5 font-medium">Reported</th>
          </tr>
        </thead>
        <tbody>
          {envs.map((e) => {
            const cs = e.supports.castSwap
            return (
              <tr key={e.env} className="border-b last:border-b-0">
                <td className="px-3 py-1.5 font-medium">{e.env}</td>
                <td className="px-3 py-1.5 font-mono">{e.pluginBuildId ?? "—"}</td>
                {cs ? (
                  <>
                    <td className="px-3 py-1.5">{(cs.roleKinds ?? []).join(", ") || "—"}</td>
                    <td className="px-3 py-1.5">{yes(cs.fixedReferences)}</td>
                    <td className="px-3 py-1.5">{(cs.resolutions ?? []).join(", ") || "—"}</td>
                    <td className="px-3 py-1.5">{yes(cs.fullQuality)}</td>
                    <td className="px-3 py-1.5">{yes(cs.trendRun)}</td>
                  </>
                ) : (
                  <td className="px-3 py-1.5 text-muted-foreground" colSpan={5}>
                    No Cast Swap engine
                  </td>
                )}
                <td className="px-3 py-1.5 text-muted-foreground">{new Date(e.updatedAt).toLocaleString()}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
