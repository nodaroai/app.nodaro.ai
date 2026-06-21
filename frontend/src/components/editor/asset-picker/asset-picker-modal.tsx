"use client"

/**
 * In-node AssetPicker — lets an entity node (Character / Object / Creature /
 * Location) bind, or REPLACE, the asset it points at, choosing from either the
 * user's own library or the public community gallery. One component, fixed to a
 * single `kind` per open (the node it was launched from).
 *
 * - "My Library" tab → the user's own `*DbId` rows (shared React-Query cache),
 *   each with a delete (soft-delete) action behind a confirm.
 * - "Public Gallery" tab → community listings. Selecting one that the user has
 *   NEVER cloned clones it into their library and binds it. If they ALREADY have
 *   a copy, a choice panel offers "use my copy" vs "make a new copy" — so a
 *   gallery pick never silently piles up duplicates.
 *
 * The actual rebind + full-detail hydration lives in `bindEntityNodeFromLibrary`
 * so pick == replace == fully-populated for all four entity types.
 */
import { useMemo, useState } from "react"
import { useQuery, useInfiniteQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Check, Search, UserCircle, Package, PawPrint, MapPin, Globe, FolderOpen, Trash2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { CachedImage } from "@/components/ui/cached-image"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { useAuth } from "@/hooks/use-auth"
import {
  getCharacters,
  getObjects,
  getCreatures,
  getLocations,
  deleteCharacter,
  deleteObject,
  deleteCreature,
  deleteLocation,
  browseCommunity,
  cloneCommunityListing,
  getMyClonesOfListing,
} from "@/lib/api"
import { queryKeys } from "@/lib/query-keys"
import { bindEntityNodeFromLibrary, type EntityKind } from "@/lib/entity-node-data"
import type { CommunityCard, CommunitySort } from "@nodaro/shared"

interface LibItem {
  id: string
  name: string
  sourceImageUrl: string | null
}

const KIND_META: Record<EntityKind, { label: string; Icon: typeof UserCircle; plural: string }> = {
  character: { label: "Character", Icon: UserCircle, plural: "characters" },
  object: { label: "Object/Props", Icon: Package, plural: "objects" },
  creature: { label: "Animal/Creature", Icon: PawPrint, plural: "creatures" },
  location: { label: "Location", Icon: MapPin, plural: "locations" },
}

// Soft-delete (archive) — recoverable; nodes already bound keep working because
// the GET-by-id routes ignore `deleted_at`.
const DELETE_FN: Record<EntityKind, (id: string) => Promise<unknown>> = {
  character: (id) => deleteCharacter(id),
  object: (id) => deleteObject(id),
  creature: (id) => deleteCreature(id),
  location: (id) => deleteLocation(id),
}

function assetKey(kind: EntityKind, userId?: string) {
  switch (kind) {
    case "character":
      return queryKeys.assets.characters(undefined, userId)
    case "object":
      return queryKeys.assets.objects(undefined, userId)
    case "creature":
      return queryKeys.assets.creatures(undefined, userId)
    case "location":
      return queryKeys.assets.locations(undefined, userId)
  }
}

// Same envelope shape (and query key) the sidebar galleries use, so the cache
// is shared and a post-clone/delete invalidation refreshes both at once.
function rawFetch(kind: EntityKind, userId?: string): Promise<unknown> {
  switch (kind) {
    case "character":
      return getCharacters(undefined, userId)
    case "object":
      return getObjects(undefined, userId)
    case "creature":
      return getCreatures(undefined, userId)
    case "location":
      return getLocations(undefined, userId)
  }
}

function extractLibItems(kind: EntityKind, data: unknown): LibItem[] {
  const arr = (data as Record<string, LibItem[]> | undefined)?.[KIND_META[kind].plural] ?? []
  return arr.map((x) => ({ id: x.id, name: x.name, sourceImageUrl: x.sourceImageUrl ?? null }))
}

export function AssetPickerModal({
  kind,
  nodeId,
  currentDbId,
  open,
  onOpenChange,
}: {
  kind: EntityKind
  nodeId: string
  currentDbId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const meta = KIND_META[kind]
  const [tab, setTab] = useState<"library" | "gallery">("library")
  // The id (library asset OR gallery listing) currently being bound — drives the
  // per-card spinner and blocks concurrent picks.
  const [binding, setBinding] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null)
  // Set when a gallery pick finds the user already owns copies — the choice
  // panel ("use my copy" vs "make a new copy") replaces the tabs until resolved.
  const [dupChoice, setDupChoice] = useState<{ card: CommunityCard; clones: LibItem[] } | null>(null)

  async function pickLibrary(entityId: string) {
    if (binding) return
    setBinding(entityId)
    const ok = await bindEntityNodeFromLibrary(kind, nodeId, entityId)
    setBinding(null)
    if (ok) onOpenChange(false)
    else toast.error(`Couldn't load that ${meta.label.toLowerCase()}.`)
  }

  async function doDelete() {
    if (!confirmDelete) return
    const { id, name } = confirmDelete
    try {
      await DELETE_FN[kind](id)
      await qc.invalidateQueries({ queryKey: queryKeys.assets.all })
      toast.success(`Deleted "${name}" from your library`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete.")
    } finally {
      setConfirmDelete(null)
    }
  }

  async function cloneAndBind(card: CommunityCard) {
    setBinding(card.id)
    try {
      const { id } = await cloneCommunityListing(card.id, kind)
      await qc.invalidateQueries({ queryKey: queryKeys.assets.all })
      const ok = await bindEntityNodeFromLibrary(kind, nodeId, id)
      if (ok) {
        toast.success(`Added "${card.title}" to your library`)
        onOpenChange(false)
      } else {
        toast.error("Cloned to your library, but couldn't bind it to the node.")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to add from the gallery.")
    } finally {
      setBinding(null)
    }
  }

  async function bindExisting(entityId: string) {
    if (binding) return
    setBinding(entityId)
    const ok = await bindEntityNodeFromLibrary(kind, nodeId, entityId)
    setBinding(null)
    if (ok) {
      setDupChoice(null)
      onOpenChange(false)
    } else {
      toast.error("Couldn't bind that copy.")
    }
  }

  async function pickGallery(card: CommunityCard) {
    if (binding) return
    setBinding(card.id)
    let clones: LibItem[]
    try {
      clones = (await getMyClonesOfListing(card.id, kind)).clones
    } catch {
      // Detection failed — don't block; fall back to the plain clone path.
      await cloneAndBind(card)
      return
    }
    if (clones.length > 0) {
      setBinding(null)
      setDupChoice({ card, clones })
      return
    }
    await cloneAndBind(card)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-sm">Choose {meta.label} asset</DialogTitle>
          <DialogDescription className="text-xs">
            {dupChoice
              ? "You already have this in your library."
              : `Pick from your library or the public gallery${currentDbId ? " to replace the current one" : ""}.`}
          </DialogDescription>
        </DialogHeader>

        {dupChoice ? (
          <DupChoicePanel
            kind={kind}
            listingTitle={dupChoice.card.title}
            clones={dupChoice.clones}
            binding={binding}
            onUseExisting={bindExisting}
            onMakeNew={() => cloneAndBind(dupChoice.card)}
            onCancel={() => setDupChoice(null)}
          />
        ) : (
          <Tabs value={tab} onValueChange={(v) => setTab(v as "library" | "gallery")} className="px-5">
            <TabsList className="w-full">
              <TabsTrigger value="library" className="flex-1 gap-1.5">
                <FolderOpen className="h-3.5 w-3.5" /> My Library
              </TabsTrigger>
              <TabsTrigger value="gallery" className="flex-1 gap-1.5">
                <Globe className="h-3.5 w-3.5" /> Public Gallery
              </TabsTrigger>
            </TabsList>

            <TabsContent value="library" className="mt-3">
              <LibraryTab
                kind={kind}
                userId={user?.id}
                currentDbId={currentDbId}
                binding={binding}
                onPick={pickLibrary}
                onRequestDelete={(item) => setConfirmDelete({ id: item.id, name: item.name })}
              />
            </TabsContent>

            <TabsContent value="gallery" className="mt-3">
              <GalleryTab kind={kind} binding={binding} onPick={pickGallery} />
            </TabsContent>
          </Tabs>
        )}
        <div className="h-5" />

        <DeleteConfirmationDialog
          isOpen={confirmDelete !== null}
          onClose={() => setConfirmDelete(null)}
          onConfirm={doDelete}
          title={confirmDelete ? `Delete "${confirmDelete.name}"?` : "Delete?"}
          description="This removes it from your library (you can restore it from the studio's archived items). Nodes already using it on the canvas keep working."
        />
      </DialogContent>
    </Dialog>
  )
}

function PlaceholderTile({ kind }: { kind: EntityKind }) {
  const { Icon } = KIND_META[kind]
  return (
    <div className="w-full aspect-square rounded bg-muted flex items-center justify-center">
      <Icon className="h-6 w-6 text-muted-foreground/40" />
    </div>
  )
}

function LibraryTab({
  kind,
  userId,
  currentDbId,
  binding,
  onPick,
  onRequestDelete,
}: {
  kind: EntityKind
  userId?: string
  currentDbId: string | null
  binding: string | null
  onPick: (id: string) => void
  onRequestDelete: (item: LibItem) => void
}) {
  const [filter, setFilter] = useState("")
  const { data, isLoading } = useQuery({
    queryKey: assetKey(kind, userId),
    queryFn: () => rawFetch(kind, userId),
  })
  const items = useMemo(() => extractLibItems(kind, data), [kind, data])
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return items
    return items.filter((i) => i.name.toLowerCase().includes(q))
  }, [items, filter])

  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={`Search your ${KIND_META[kind].plural}…`}
          className="w-full text-xs bg-muted/30 border border-border rounded-md pl-8 pr-3 py-2 outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="h-[360px] overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground text-center px-6">
            {items.length === 0
              ? `No saved ${KIND_META[kind].plural} yet — create one, or browse the Public Gallery.`
              : "No matches."}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2 pb-1">
            {filtered.map((item) => {
              const isCurrent = item.id === currentDbId
              const isBinding = binding === item.id
              return (
                <div
                  key={item.id}
                  className={`group relative rounded-md border overflow-hidden transition-colors ${
                    isCurrent ? "border-primary" : "border-border hover:border-muted-foreground/40"
                  }`}
                >
                  <button
                    type="button"
                    disabled={!!binding}
                    onClick={() => onPick(item.id)}
                    className="block w-full text-left disabled:opacity-60"
                    title={item.name}
                  >
                    {item.sourceImageUrl ? (
                      <CachedImage
                        src={item.sourceImageUrl}
                        alt={item.name}
                        className="w-full aspect-square object-cover"
                        thumbnail
                        thumbnailWidth={220}
                      />
                    ) : (
                      <PlaceholderTile kind={kind} />
                    )}
                    <div className="px-1.5 py-1 text-[10px] truncate">{item.name}</div>
                  </button>
                  {isCurrent && (
                    <span className="absolute top-1 right-1 bg-primary text-primary-foreground rounded-full p-0.5 pointer-events-none">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={`Delete ${item.name}`}
                    disabled={!!binding}
                    onClick={(e) => {
                      e.stopPropagation()
                      onRequestDelete(item)
                    }}
                    className="absolute top-1 left-1 w-5 h-5 flex items-center justify-center bg-black/50 hover:bg-red-600 text-white rounded opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-0"
                    title="Delete from library"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                  {isBinding && (
                    <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                      <Loader2 className="h-4 w-4 animate-spin" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function DupChoicePanel({
  kind,
  listingTitle,
  clones,
  binding,
  onUseExisting,
  onMakeNew,
  onCancel,
}: {
  kind: EntityKind
  listingTitle: string
  clones: LibItem[]
  binding: string | null
  onUseExisting: (id: string) => void
  onMakeNew: () => void
  onCancel: () => void
}) {
  return (
    <div className="px-5 flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        You already have {clones.length === 1 ? "a copy" : `${clones.length} copies`} of{" "}
        <span className="font-medium text-foreground">{listingTitle}</span> in your library. Use one of
        them, or make a fresh copy.
      </p>
      <div className="grid grid-cols-3 gap-2 max-h-[300px] overflow-y-auto">
        {clones.map((c) => {
          const isBinding = binding === c.id
          return (
            <button
              key={c.id}
              type="button"
              disabled={!!binding}
              onClick={() => onUseExisting(c.id)}
              className="group relative text-left rounded-md border border-border hover:border-primary overflow-hidden transition-colors disabled:opacity-60"
              title={c.name}
            >
              {c.sourceImageUrl ? (
                <CachedImage
                  src={c.sourceImageUrl}
                  alt={c.name}
                  className="w-full aspect-square object-cover"
                  thumbnail
                  thumbnailWidth={220}
                />
              ) : (
                <PlaceholderTile kind={kind} />
              )}
              <div className="px-1.5 py-1 text-[10px] truncate">{c.name}</div>
              {isBinding && (
                <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
            </button>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={!!binding}
          className="text-xs text-muted-foreground hover:text-foreground px-3 py-2 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onMakeNew}
          disabled={!!binding}
          className="text-xs bg-muted/40 border border-border rounded-md px-3 py-2 hover:bg-muted/60 transition-colors disabled:opacity-50"
        >
          {binding ? (
            <span className="flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
            </span>
          ) : (
            "Make a new copy"
          )}
        </button>
      </div>
    </div>
  )
}

function GalleryTab({
  kind,
  binding,
  onPick,
}: {
  kind: EntityKind
  binding: string | null
  onPick: (card: CommunityCard) => void
}) {
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<CommunitySort>("newest")
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["community-browse", kind, q, sort],
      queryFn: ({ pageParam }) =>
        browseCommunity({ entityType: kind, q: q || undefined, sort, cursor: pageParam, limit: 24 }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    })
  const cards = useMemo(() => data?.pages.flatMap((p) => p.data) ?? [], [data])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search the public gallery…"
            className="w-full text-xs bg-muted/30 border border-border rounded-md pl-8 pr-3 py-2 outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as CommunitySort)}
          className="text-xs bg-muted/30 border border-border rounded-md px-2 outline-none"
          aria-label="Sort gallery"
        >
          <option value="newest">Newest</option>
          <option value="popular">Popular</option>
        </select>
      </div>
      <div className="h-[360px] overflow-y-auto">
        {isError ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground text-center px-6">
            The public gallery isn&apos;t available right now.
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
          </div>
        ) : cards.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-muted-foreground text-center px-6">
            No public {KIND_META[kind].plural} found.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2 pb-1">
              {cards.map((card) => {
                const preview = card.preview_media_url ?? card.preview_images?.[0]?.url ?? null
                const isBinding = binding === card.id
                return (
                  <button
                    key={card.id}
                    type="button"
                    disabled={!!binding}
                    onClick={() => onPick(card)}
                    className="group relative text-left rounded-md border border-border hover:border-muted-foreground/40 overflow-hidden transition-colors disabled:opacity-60"
                    title={card.title}
                  >
                    {preview ? (
                      <CachedImage
                        src={preview}
                        alt={card.title}
                        className="w-full aspect-square object-cover"
                        thumbnail
                        thumbnailWidth={220}
                      />
                    ) : (
                      <PlaceholderTile kind={kind} />
                    )}
                    <div className="px-1.5 py-1">
                      <div className="text-[10px] truncate">{card.title}</div>
                      <div className="text-[9px] text-muted-foreground truncate">
                        {card.creator_display_name ?? "Community"} · {card.clone_count} uses
                      </div>
                    </div>
                    {isBinding && (
                      <div className="absolute inset-0 bg-background/60 flex flex-col items-center justify-center gap-1">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-[9px]">Adding…</span>
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
            {hasNextPage && (
              <button
                type="button"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
                className="w-full text-xs text-muted-foreground hover:text-foreground py-2 disabled:opacity-50"
              >
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
