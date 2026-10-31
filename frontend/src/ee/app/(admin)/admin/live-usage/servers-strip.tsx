import { cn } from "@/lib/utils"
import { POOLS, type LiveServer, type ServerPool } from "./types"

const POOL_LABELS: Record<ServerPool, string> = {
  video: "Video",
  render: "Render",
  orchestrator: "Orchestrator",
  pipeline: "Pipeline",
  director: "Director",
}

function ServerCard({ s, measureOnly }: { s: LiveServer; measureOnly: boolean }) {
  const full = s.poolSize !== null && s.held >= s.poolSize
  return (
    <div className="rounded-md border px-2 py-1.5 text-xs">
      <div className={cn("font-medium tabular-nums", full && "text-amber-500")}>
        {s.held}{s.poolSize !== null ? ` / ${s.poolSize}` : ""} held
      </div>
      <div className="text-muted-foreground">
        {s.userCap !== null ? `${s.userCap} per user` : "no per-user cap"}
        {s.coordinatorCap !== null && ` · ${s.coordinators}/${s.coordinatorCap} coordinators`}
      </div>
      {s.overCapUsers > 0 && (
        <div className="font-medium text-rose-500">
          {s.overCapUsers} {s.overCapUsers === 1 ? "user" : "users"} over their share{measureOnly ? " (counted only)" : ""}
        </div>
      )}
    </div>
  )
}

/** Each background pool of this environment: what each process holds against its share caps. */
export function ServersStrip({ servers, complete, measureOnly }: { servers: Record<ServerPool, LiveServer[]>; complete: boolean; measureOnly: boolean }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Servers</h2>
      {!complete && (
        <p className="text-xs text-amber-600">Some servers may be missing: not every process's numbers could be read this time.</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {POOLS.map((pool) => (
          <div key={pool} className="space-y-1.5 rounded-lg border p-3">
            <div className="text-xs font-semibold">{POOL_LABELS[pool]}</div>
            {servers[pool]?.length ? (
              servers[pool].map((s) => <ServerCard key={s.processId} s={s} measureOnly={measureOnly} />)
            ) : (
              <p className="text-xs text-muted-foreground">No process reporting.</p>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
