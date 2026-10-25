// Admin → Trends: every trend, filtered by status and tag (archived trends
// only under their own filter — "All" is every trend not put away), with
// the catalog fields that live on the trend row (sort order, badges) written
// in place through PATCH. "New trend" creates a draft and opens its editor
// (`./detail/page.tsx`); "Tag labels" edits what users see for each tag.
//
// Dragging to set the sort order is a later nicety: the order is a
// number, as on the other admin lists.

import { useMemo, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { Loader2, Plus, Tags, TrendingUp, Film } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { hasAdmin } from "@/lib/edition"
import { cn } from "@/lib/utils"
import type { AdminTrendListItem, TrendBadge, TrendStatus } from "@/lib/api"
import { useAdminTrends, useCreateTrend, usePatchTrend } from "@/ee/hooks/queries/use-admin-queries"
import { StatusBadge } from "./components/StatusBadge"
import { TagLabelsDialog } from "./components/TagLabelsDialog"
import { isTrendSlug } from "./model"

const STATUS_FILTERS: ReadonlyArray<{ value: TrendStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "draft", label: "Drafts" },
  { value: "unpublished", label: "Unpublished" },
  { value: "archived", label: "Archived" },
]

const BADGES: ReadonlyArray<{ value: TrendBadge; label: string }> = [
  { value: "trending", label: "Trending" },
  { value: "new", label: "New" },
]

export default function AdminTrendsPage() {
  const { data, isLoading, error } = useAdminTrends()
  const [status, setStatus] = useState<TrendStatus | "all">("all")
  const [tag, setTag] = useState("")
  const [creating, setCreating] = useState(false)
  const [labelling, setLabelling] = useState(false)

  const trends = useMemo(() => {
    const t = tag.trim().toLowerCase()
    return (data ?? [])
      .filter((x) => (status === "all" ? x.status !== "archived" : x.status === status))
      .filter((x) => !t || x.tags.some((g) => g.toLowerCase().includes(t)))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }, [data, status, tag])

  if (!hasAdmin()) return null

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">Trends</h1>
          <p className="text-sm text-muted-foreground">
            Ready-made Cast Swap recipes. Users only see a trend's published version.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="min-h-9" onClick={() => setLabelling(true)}>
            <Tags className="mr-1 h-4 w-4" /> Tag labels
          </Button>
          <Button size="sm" className="min-h-9" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> New trend
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
          {STATUS_FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={status === f.value ? "default" : "outline"}
              aria-pressed={status === f.value}
              onClick={() => setStatus(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>
        <Input
          className="h-9 w-full sm:w-56"
          placeholder="Filter by tag"
          aria-label="Filter by tag"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : error ? (
        <p className="py-6 text-sm text-destructive">{error instanceof Error ? error.message : "Failed to load trends"}</p>
      ) : trends.length === 0 ? (
        <div className="rounded-lg border py-16 text-center text-muted-foreground">
          <TrendingUp className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm">{(data ?? []).length === 0 ? "No trends yet." : "No trend matches."}</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {trends.map((t) => (
            <TrendRow key={t.id} trend={t} />
          ))}
        </ul>
      )}

      <CreateTrendDialog open={creating} onOpenChange={setCreating} />
      <TagLabelsDialog open={labelling} onOpenChange={setLabelling} />
    </div>
  )
}

function TrendRow({ trend }: { readonly trend: AdminTrendListItem }) {
  const patch = usePatchTrend(trend.id)
  const onError = (err: Error) => toast.error(err.message)

  const toggleBadge = (badge: TrendBadge, on: boolean) => {
    const badges = on ? [...trend.badges, badge] : trend.badges.filter((b) => b !== badge)
    patch.mutate({ badges }, { onError })
  }

  return (
    <li data-trend-row className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
      <Link to={`/admin/trends/${trend.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <div className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
          {trend.coverUrl ? (
            /\.(mp4|webm|mov)(\?|$)/i.test(trend.coverUrl) ? (
              <video src={trend.coverUrl} muted preload="metadata" className="h-full w-full object-cover" />
            ) : (
              <img src={trend.coverUrl} alt="" className="h-full w-full object-cover" />
            )
          ) : (
            <Film className="h-5 w-5 opacity-40" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium">{trend.name}</span>
            <StatusBadge status={trend.status} />
          </div>
          <div className="truncate text-xs text-muted-foreground">/{trend.slug}</div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>
              draft v{trend.draftVersion}
              {trend.publishedVersion !== null ? ` · published v${trend.publishedVersion}` : ""}
            </span>
            <span>
              {trend.slotCount} slot{trend.slotCount === 1 ? "" : "s"}
            </span>
            <span>Updated {new Date(trend.updatedAt).toLocaleString()}</span>
          </div>
          {trend.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {trend.tags.map((g) => (
                <Badge key={g} variant="secondary" className="text-[11px]">
                  {g}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </Link>

      <div className="flex flex-wrap items-center gap-4">
        {BADGES.map((b) => (
          <label key={b.value} className="flex min-h-9 items-center gap-2 text-xs">
            <Switch
              aria-label={b.label}
              checked={trend.badges.includes(b.value)}
              disabled={patch.isPending}
              onCheckedChange={(on) => toggleBadge(b.value, on)}
            />
            {b.label}
          </label>
        ))}
        <SortOrderInput value={trend.sortOrder} onCommit={(sortOrder) => patch.mutate({ sortOrder }, { onError })} />
      </div>
    </li>
  )
}

function SortOrderInput({ value, onCommit }: { readonly value: number; readonly onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value))
  const [seen, setSeen] = useState(value)
  // A refetch moved it: show the server's value.
  if (seen !== value) {
    setSeen(value)
    setText(String(value))
  }
  const commit = () => {
    const n = Number(text)
    if (!Number.isInteger(n) || Math.abs(n) > 1_000_000) {
      setText(String(value))
      return
    }
    if (n !== value) onCommit(n)
  }
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">Order</span>
      <Input
        type="number"
        inputMode="numeric"
        aria-label="Sort order"
        className="h-9 w-20"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur()
        }}
      />
    </label>
  )
}

function CreateTrendDialog({ open, onOpenChange }: { readonly open: boolean; readonly onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const create = useCreateTrend()
  const [slug, setSlug] = useState("")
  const [name, setName] = useState("")
  const slugOk = isTrendSlug(slug)
  const canCreate = slugOk && name.trim().length > 0 && name.trim().length <= 200 && !create.isPending

  const submit = () => {
    if (!canCreate) return
    create.mutate(
      { slug, name: { en: name.trim() } },
      {
        onSuccess: ({ id }) => {
          onOpenChange(false)
          setSlug("")
          setName("")
          navigate(`/admin/trends/${id}`)
        },
        onError: (err: Error) => toast.error(err.message),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New trend</DialogTitle>
          <DialogDescription>It starts as a draft; nobody sees it until it is published.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-trend-slug">Slug</Label>
            <Input
              id="new-trend-slug"
              value={slug}
              placeholder="office-dance"
              autoCapitalize="none"
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              aria-invalid={slug.length > 0 && !slugOk}
            />
            <p className={cn("text-xs", slug.length > 0 && !slugOk ? "text-destructive" : "text-muted-foreground")}>
              a–z, 0–9 and -, starting with a letter or digit. It is the trend's address.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="new-trend-name">Name (English)</Label>
            <Input id="new-trend-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canCreate}>
            {create.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
