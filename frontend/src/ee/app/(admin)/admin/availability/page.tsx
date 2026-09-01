import { useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2, RotateCcw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { getAuthHeaders } from "@/lib/api"

/**
 * Admin node/model availability (B5). Shows the FULL gateable universe with
 * each item's factory state (the deployment surface profile's allow/deny) and
 * lets the operator store a runtime override — a complete enabled-set that
 * replaces the factory layer until "Reset to factory" deletes it. Enforcement
 * lives backend-side (lib/surface-deny.ts); this page only edits the override.
 */

interface AvailabilityItem {
  id: string
  label: string
  category: string
  factoryEnabled: boolean
  enabled: boolean
}

interface AvailabilityResponse {
  nodes: { items: AvailabilityItem[]; overridden: boolean }
  models: { items: AvailabilityItem[]; overridden: boolean }
}

type Kind = "nodes" | "models"

async function fetchAvailability(): Promise<AvailabilityResponse> {
  const res = await fetch("/v1/admin/availability", { headers: await getAuthHeaders() })
  if (!res.ok) throw new Error(`Failed to load availability (${res.status})`)
  return res.json()
}

async function putAvailability(kind: Kind, enabled: string[] | null): Promise<void> {
  const res = await fetch("/v1/admin/availability", {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify({ kind, enabled }),
  })
  if (!res.ok) throw new Error(`Failed to save (${res.status})`)
}

function KindSection({ kind, data }: { readonly kind: Kind; readonly data: AvailabilityResponse[Kind] }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState("")
  // Draft = the enabled set being edited; null = untouched (render server state).
  const [draft, setDraft] = useState<Set<string> | null>(null)

  const enabledSet = useMemo(
    () => draft ?? new Set(data.items.filter((i) => i.enabled).map((i) => i.id)),
    [draft, data.items],
  )

  const save = useMutation({
    mutationFn: (enabled: string[] | null) => putAvailability(kind, enabled),
    onSuccess: (_d, enabled) => {
      toast.success(enabled === null ? "Reset to factory settings" : "Availability saved")
      setDraft(null)
      void queryClient.invalidateQueries({ queryKey: ["admin", "availability"] })
    },
    onError: (e) => toast.error((e as Error).message),
  })

  const categories = useMemo(() => {
    const byCat = new Map<string, AvailabilityItem[]>()
    const q = search.trim().toLowerCase()
    for (const item of data.items) {
      if (q && !item.id.toLowerCase().includes(q) && !item.label.toLowerCase().includes(q)) continue
      const list = byCat.get(item.category) ?? []
      list.push(item)
      byCat.set(item.category, list)
    }
    return [...byCat.entries()]
  }, [data.items, search])

  const toggle = (id: string) => {
    const next = new Set(enabledSet)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setDraft(next)
  }

  const dirty = draft !== null
  const title = kind === "nodes" ? "Node types" : "Models"

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          {data.overridden && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-amber-500/15 text-amber-500 border border-amber-500/30">
              runtime override active
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-44"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={save.isPending || (!data.overridden && !dirty)}
            onClick={() => save.mutate(null)}
            title="Delete the runtime override and return to the surface profile's factory set"
          >
            <RotateCcw className="h-3.5 w-3.5 me-1" />
            Reset to factory
          </Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate([...enabledSet])}>
            {save.isPending ? <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" /> : null}
            Save
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {categories.map(([category, items]) => (
          <div key={category}>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{category}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-1">
              {items.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-2 py-1 px-2 rounded hover:bg-muted/50 cursor-pointer text-sm"
                >
                  <Checkbox checked={enabledSet.has(item.id)} onCheckedChange={() => toggle(item.id)} />
                  <span className="truncate">{item.label}</span>
                  <span className="ms-auto flex items-center gap-1.5">
                    {!item.factoryEnabled && (
                      <span
                        className="text-[10px] text-muted-foreground border border-border rounded px-1"
                        title="Disabled in the deployment's factory (surface profile) set"
                      >
                        factory off
                      </span>
                    )}
                    <code className="text-[10px] text-muted-foreground">{item.id}</code>
                  </span>
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

export default function AdminAvailabilityPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin", "availability"],
    queryFn: fetchAvailability,
  })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Availability</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Which node types and models this deployment offers. The surface profile is the factory set; changes here
          store a runtime override that replaces it until reset. Disabled items disappear from the picker and
          dropdowns, and are refused at write and run.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : isError || !data ? (
        <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
          Could not load availability.
        </div>
      ) : (
        <>
          <KindSection kind="nodes" data={data.nodes} />
          <KindSection kind="models" data={data.models} />
        </>
      )}
    </div>
  )
}
