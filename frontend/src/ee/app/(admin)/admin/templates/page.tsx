/**
 * Admin → Templates. Every template on the platform, whoever published it, with
 * the two switches an operator needs (PATCH /v1/admin/workflow-templates/:id/listing):
 *
 *   On          off sets is_active=false: the template is gone everywhere — the
 *               gallery, its page, cloning and the tutorials. Workflows people
 *               already made from it are their own and keep working.
 *   In gallery  the marketplace tag only. Off takes the template out of the
 *               Templates gallery; a tutorial stays a tutorial (Admin → Tutorials).
 *
 * Both are reversible, so neither asks for confirmation, and the tutorial seeder
 * never writes either column back (OPERATOR_OWNED_COLUMNS), so a redeploy does
 * not undo a switch.
 *
 * A template's cover or name opens the gallery's own preview (the detail popup,
 * then the canvas), for ANY template: GET /v1/templates/:slug answers an admin
 * whether the template is listed or not, on or off.
 */
import { Suspense, useDeferredValue, useMemo, useState } from "react"
import { Copy, ExternalLink, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { hasAdmin } from "@/lib/edition"
import { lazyWithRetry } from "@/lib/lazy-with-retry"
import { cn } from "@/lib/utils"
import type { AdminWorkflowTemplateRow } from "@/lib/api"
import {
  useAdminTemplatesList,
  useSetTemplateListing,
  type TemplateListingChange,
  type TemplateListingFilter,
} from "@/ee/hooks/queries/use-admin-templates"

const isAdmin = hasAdmin()

// The gallery's own preview, loaded only once a template is opened (the canvas
// carries the whole node library).
const TemplateDetailModal = lazyWithRetry(() =>
  import("@/components/templates/template-detail-modal").then((m) => ({ default: m.TemplateDetailModal })),
)
const TemplateCanvasPreview = lazyWithRetry(() =>
  import("@/components/templates/template-canvas-preview").then((m) => ({ default: m.TemplateCanvasPreview })),
)

interface OpenPreview {
  readonly slug: string
  readonly view: "detail" | "canvas"
}

/** The gallery link of a template — what the Templates page opens with `?template=`. */
function templateGalleryUrl(slug: string, origin: string): string {
  return `${origin}/templates?template=${encodeURIComponent(slug)}`
}

type StatusFilter = "all" | "on" | "off"

const LISTING_OPTIONS: ReadonlyArray<{ value: "all" | Exclude<TemplateListingFilter, "">; label: string }> = [
  { value: "all", label: "All" },
  { value: "marketplace", label: "In gallery" },
  { value: "tutorial", label: "Tutorials" },
  { value: "unlisted", label: "Not listed" },
]

function Cover({ row }: { readonly row: AdminWorkflowTemplateRow }) {
  if (!row.previewMediaUrl) {
    return <div className="h-10 w-14 rounded bg-muted" />
  }
  if (row.previewMediaType === "video") {
    return <video src={row.previewMediaUrl} muted playsInline preload="metadata" className="h-10 w-14 rounded object-cover" />
  }
  return <img src={row.previewMediaUrl} alt="" loading="lazy" className="h-10 w-14 rounded object-cover" />
}

function TemplateRow({
  row,
  onPreview,
}: {
  readonly row: AdminWorkflowTemplateRow
  readonly onPreview: (slug: string) => void
}) {
  const setListing = useSetTemplateListing()

  const apply = (change: Omit<TemplateListingChange, "templateId">, done: string) =>
    setListing.mutate(
      { templateId: row.id, ...change },
      {
        onSuccess: () => toast.success(`"${row.name}" ${done}`),
        onError: (error) => toast.error(error instanceof Error ? error.message : "Update failed"),
      },
    )

  // Everyone else can open the link only while the template is on and listed
  // somewhere public; an admin opens any template.
  const opensForEveryone = row.isActive && (row.isListed || row.isTutorial)
  const slug = row.slug

  const copyLink = () => {
    if (!slug) return
    void navigator.clipboard.writeText(templateGalleryUrl(slug, window.location.origin)).then(
      () =>
        toast.success(
          opensForEveryone
            ? "Link copied"
            : "Link copied. Until the template is on and listed, only admins and its creator can open it.",
        ),
      () => toast.error("Could not copy the link"),
    )
  }

  return (
    <tr className={cn("border-t hover:bg-muted/30", !row.isActive && "opacity-60")}>
      <td className="px-3 py-2">
        {slug ? (
          <button type="button" onClick={() => onPreview(slug)} title="Preview" aria-label={`Preview: ${row.name}`} className="block cursor-pointer">
            <Cover row={row} />
          </button>
        ) : (
          <Cover row={row} />
        )}
      </td>
      <td className="px-3 py-2 max-w-[320px]">
        {slug ? (
          <button type="button" onClick={() => onPreview(slug)} className="block max-w-full font-medium truncate text-left hover:underline cursor-pointer">
            {row.name}
          </button>
        ) : (
          <div className="font-medium truncate">{row.name}</div>
        )}
        <div className="text-xs text-muted-foreground font-mono truncate">{row.slug ?? "--"}</div>
        <div className="text-xs text-muted-foreground truncate">by {row.creatorDisplayName ?? row.creatorId}</div>
      </td>
      <td className="px-3 py-2 text-xs font-mono">{row.category}</td>
      <td className="px-3 py-2">
        <div className="flex flex-wrap gap-1">
          {row.isTutorial && <Badge variant="outline" className="text-xs">Tutorial</Badge>}
          {!row.previewMediaUrl && <Badge variant="outline" className="text-xs">No cover</Badge>}
        </div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{row.cloneCount}</td>
      <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{new Date(row.createdAt).toLocaleDateString()}</td>
      <td className="px-3 py-2">
        <Switch
          checked={row.isActive}
          disabled={setListing.isPending}
          onCheckedChange={(on) => apply({ isActive: on }, on ? "is on" : "is off everywhere")}
          aria-label={`On: ${row.name}`}
        />
      </td>
      <td className="px-3 py-2">
        <Switch
          checked={row.isListed}
          disabled={setListing.isPending}
          onCheckedChange={(listed) =>
            apply(
              { isListed: listed },
              !listed ? "is out of the gallery" : row.isActive ? "is in the gallery" : "goes in the gallery once it is on",
            )
          }
          aria-label={`In gallery: ${row.name}`}
        />
      </td>
      <td className="px-3 py-2">
        {slug && (
          <div className="flex items-center gap-2">
            <a
              href={templateGalleryUrl(slug, "")}
              target="_blank"
              rel="noreferrer"
              title="Open in the gallery"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
            <button type="button" onClick={copyLink} title="Copy link" aria-label={`Copy link: ${row.name}`} className="text-muted-foreground hover:text-foreground cursor-pointer">
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}

export default function AdminTemplatesPage() {
  const [search, setSearch] = useState("")
  const [listed, setListed] = useState<"all" | Exclude<TemplateListingFilter, "">>("all")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [preview, setPreview] = useState<OpenPreview | null>(null)
  // Captured once: the preview's "New" badge reads it.
  const [now] = useState(() => Date.now())
  const deferredSearch = useDeferredValue(search.trim())

  const list = useAdminTemplatesList({ search: deferredSearch, listed: listed === "all" ? "" : listed })

  const loaded = useMemo(() => list.data?.pages.flatMap((page) => page.data) ?? [], [list.data])
  // On/off is filtered among the loaded rows: the server lists both.
  const rows = useMemo(
    () => (status === "all" ? loaded : loaded.filter((row) => row.isActive === (status === "on"))),
    [loaded, status],
  )

  if (!isAdmin) return null

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <h1 className="text-xl font-bold">Templates</h1>
        <p className="text-sm text-muted-foreground">Every template on the platform, whoever published it.</p>
      </div>

      <div className="mb-6 rounded-lg border bg-muted/30 p-4 text-sm space-y-1">
        <p><span className="font-medium">On</span>: off hides the template everywhere: the gallery, its page, cloning and the tutorials. Workflows people already made from it keep working.</p>
        <p><span className="font-medium">In gallery</span>: shows the template in the Templates gallery. Off takes it out of the gallery only; a tutorial stays in the tutorials (see Tutorials).</p>
        <p className="text-muted-foreground">Changes apply at once, for everyone, and a redeploy does not undo them.</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-64">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Search</label>
          <Input placeholder="Name or description" value={search} onChange={(e) => setSearch(e.target.value)} className="text-sm" />
        </div>
        <div className="w-40">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Listing</label>
          <Select value={listed} onValueChange={(v) => setListed(v as typeof listed)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LISTING_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-32">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Status</label>
          <Select value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="on">On</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {list.isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : list.isError ? (
        <p className="py-8 text-center text-sm text-destructive">
          {list.error instanceof Error ? list.error.message : "Failed to load templates"}
        </p>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Cover</th>
                <th className="text-left px-3 py-2 font-medium">Template</th>
                <th className="text-left px-3 py-2 font-medium">Category</th>
                <th className="text-left px-3 py-2 font-medium">Notes</th>
                <th className="text-right px-3 py-2 font-medium">Clones</th>
                <th className="text-left px-3 py-2 font-medium">Published</th>
                <th className="text-left px-3 py-2 font-medium">On</th>
                <th className="text-left px-3 py-2 font-medium">In gallery</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <TemplateRow key={row.id} row={row} onPreview={(slug) => setPreview({ slug, view: "detail" })} />
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">No templates match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-muted-foreground">
          Showing {rows.length} of {loaded.length} loaded{list.hasNextPage ? "; more on the next page" : ""}
        </p>
        {list.hasNextPage && (
          <Button variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
            {list.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Load more
          </Button>
        )}
      </div>

      {preview && (
        <Suspense fallback={null}>
          <TemplateDetailModal
            slug={preview.slug}
            open={preview.view === "detail"}
            fallback={null}
            now={now}
            favoriteIds={[]}
            onClose={() => setPreview(null)}
            onPreviewCanvas={() => setPreview({ slug: preview.slug, view: "canvas" })}
            onOpenTemplate={(slug) => setPreview({ slug, view: "detail" })}
          />
          <TemplateCanvasPreview
            slug={preview.slug}
            open={preview.view === "canvas"}
            fallback={null}
            onBack={() => setPreview({ slug: preview.slug, view: "detail" })}
          />
        </Suspense>
      )}
    </div>
  )
}
