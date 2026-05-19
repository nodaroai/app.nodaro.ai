import { useCallback, useState } from "react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import {
  MapPin,
  Loader2,
  AlertCircle,
  Trash2,
  ArchiveRestore,
  ArrowLeft,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import { useAuth } from "@/hooks/use-auth"
import { useLocations, useArchivedLocations } from "@/hooks/queries/use-assets-queries"
import { useInvalidateLocation } from "@/hooks/queries/use-invalidate-location"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import {
  restoreLocation,
  permanentDeleteLocation,
  type DbLocation,
} from "@/lib/api"

type TabKey = "active" | "archived"

/**
 * `/library/locations` — the standalone archive view for locations. Mirrors
 * the character precedent (`components/editor/character-gallery.tsx`) with two
 * meaningful additions:
 *
 *   1. Renders as a full dashboard page (under `DashboardLayout`) rather than a
 *      modal popup. The Character precedent is a sidebar-button overlay; the
 *      Location precedent is a route — this is the canonical "Library archive"
 *      pattern PR-2 establishes for entity types going forward.
 *   2. The Archived tab offers a two-step permanent-delete: first click opens
 *      a confirmation modal with a typed-name confirmation field; the
 *      "Permanently delete" button stays disabled until the typed text matches
 *      the location name exactly. Permanent-delete is intentionally NOT on the
 *      SDK surface (UI-only — see `permanentDeleteLocation` in `lib/api.ts`).
 */
export default function LocationGallery() {
  const { user } = useAuth()
  const [tab, setTab] = useState<TabKey>("active")
  const queryClient = useQueryClient()
  const invalidateActive = useInvalidateLocation(undefined, user?.id)

  const invalidateArchived = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: [...queryKeys.assets.locations(undefined, user?.id), "archived"],
    })
  }, [queryClient, user?.id])

  // Invalidate both lists after any archive/restore/permanent-delete so each
  // tab sees the row move (or disappear, for permanent).
  const invalidateLists = useCallback(() => {
    invalidateActive()
    invalidateArchived()
  }, [invalidateActive, invalidateArchived])

  const {
    data: activeLocations = [],
    isLoading: loadingActive,
    error: errorActive,
    refetch: refetchActive,
  } = useLocations(undefined, user?.id)

  const {
    data: archivedLocations = [],
    isLoading: loadingArchived,
    error: errorArchived,
    refetch: refetchArchived,
  } = useArchivedLocations(undefined, user?.id)

  const handleRestore = useCallback(
    async (e: React.MouseEvent, loc: DbLocation) => {
      e.stopPropagation()
      try {
        const result = await restoreLocation(loc.id)
        invalidateLists()
        toast.success(
          result.name !== loc.name
            ? `Restored as '${result.name}' (the original name was taken)`
            : `Restored '${result.name}'`,
        )
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to restore location.")
      }
    },
    [invalidateLists],
  )

  // Two-step permanent-delete state. `deleteTarget` is null when the modal is
  // closed; otherwise holds the row about to be destroyed plus the typed
  // confirmation text the user has entered.
  const [deleteTarget, setDeleteTarget] = useState<DbLocation | null>(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)

  const beginPermanentDelete = useCallback(
    (e: React.MouseEvent, loc: DbLocation) => {
      e.stopPropagation()
      setDeleteTarget(loc)
      setDeleteConfirmText("")
    },
    [],
  )

  const cancelPermanentDelete = useCallback(() => {
    if (deleting) return
    setDeleteTarget(null)
    setDeleteConfirmText("")
  }, [deleting])

  const confirmPermanentDelete = useCallback(async () => {
    if (!deleteTarget) return
    if (deleteConfirmText !== deleteTarget.name) return
    setDeleting(true)
    try {
      await permanentDeleteLocation(deleteTarget.id)
      invalidateLists()
      toast.success(`Permanently deleted '${deleteTarget.name}'`)
      setDeleteTarget(null)
      setDeleteConfirmText("")
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to permanently delete location.",
      )
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, deleteConfirmText, invalidateLists])

  const activeCount = activeLocations.length
  const archivedCount = archivedLocations.length

  return (
    <div className="max-w-5xl mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/projects" className="text-muted-foreground hover:text-foreground transition-colors" aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <MapPin className="h-6 w-6 text-cyan-500" />
        <h1 className="text-2xl font-bold">Location Library</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setTab("active")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            tab === "active"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Active
          {activeCount > 0 && <span className="ml-1.5 opacity-60">({activeCount})</span>}
        </button>
        <button
          type="button"
          onClick={() => setTab("archived")}
          className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
            tab === "archived"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Archived
          {archivedCount > 0 && <span className="ml-1.5 opacity-60">({archivedCount})</span>}
        </button>
      </div>

      {/* Body */}
      {tab === "active" ? (
        <ActivePane
          loading={loadingActive}
          error={errorActive}
          locations={activeLocations}
          refetch={refetchActive}
        />
      ) : (
        <ArchivedPane
          loading={loadingArchived}
          error={errorArchived}
          locations={archivedLocations}
          onRestore={handleRestore}
          onPermanentDelete={beginPermanentDelete}
          refetch={refetchArchived}
        />
      )}

      {/* Two-step permanent-delete modal — typed-name confirmation. */}
      {deleteTarget && (
        <PermanentDeleteModal
          target={deleteTarget}
          confirmText={deleteConfirmText}
          onConfirmTextChange={setDeleteConfirmText}
          deleting={deleting}
          onCancel={cancelPermanentDelete}
          onConfirm={confirmPermanentDelete}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Active pane — read-only grid; clicking a card is a no-op here (this is the
// archive *view*, not the picker). Users who want to open a location on the
// canvas should use the `LocationGalleryButton` from the editor sidebar.
// ---------------------------------------------------------------------------

function ActivePane({
  loading,
  error,
  locations,
  refetch,
}: {
  loading: boolean
  error: unknown
  locations: DbLocation[]
  refetch: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin mb-2" />
        <p className="text-sm">Loading locations...</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-destructive">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">{error instanceof Error ? error.message : "Failed to load locations"}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={refetch}>
          Retry
        </Button>
      </div>
    )
  }
  if (locations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <MapPin className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm">No saved locations</p>
        <p className="text-xs mt-1">Generate a location image to save it here</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {locations.map((loc) => (
        <div
          key={loc.id}
          className="flex flex-col items-center gap-2 p-3 rounded-lg border border-border/50 bg-card"
        >
          {loc.sourceImageUrl ? (
            <div className="w-full aspect-square rounded-lg overflow-hidden bg-muted/30">
              <CachedImage
                src={loc.sourceImageUrl}
                alt={loc.name}
                className="w-full h-full object-cover"
                thumbnail
                thumbnailWidth={320}
              />
            </div>
          ) : (
            <div className="w-full aspect-square rounded-lg bg-muted/30 flex items-center justify-center">
              <MapPin className="w-10 h-10 text-muted-foreground/30" />
            </div>
          )}
          <span className="text-sm font-medium truncate w-full text-center" title={loc.name}>
            {loc.name}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Archived pane — each row gets a Restore button + a Permanently Delete button
// that opens the two-step typed-name confirmation modal.
// ---------------------------------------------------------------------------

function ArchivedPane({
  loading,
  error,
  locations,
  onRestore,
  onPermanentDelete,
  refetch,
}: {
  loading: boolean
  error: unknown
  locations: DbLocation[]
  onRestore: (e: React.MouseEvent, loc: DbLocation) => void
  onPermanentDelete: (e: React.MouseEvent, loc: DbLocation) => void
  refetch: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin mb-2" />
        <p className="text-sm">Loading archive...</p>
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-destructive">
        <AlertCircle className="w-8 h-8 mb-2" />
        <p className="text-sm">{error instanceof Error ? error.message : "Failed to load archived locations"}</p>
        <Button variant="outline" size="sm" className="mt-2" onClick={refetch}>
          Retry
        </Button>
      </div>
    )
  }
  if (locations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <ArchiveRestore className="w-10 h-10 mb-2 opacity-40" />
        <p className="text-sm">No archived locations</p>
        <p className="text-xs mt-1">Archived locations land here. Restore any time.</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
      {locations.map((loc) => (
        <div
          key={loc.id}
          className="relative flex flex-col items-center gap-2 p-3 rounded-lg border border-border/50 bg-muted/10"
        >
          {loc.sourceImageUrl ? (
            <div className="w-full aspect-square rounded-lg overflow-hidden bg-muted/30 opacity-60">
              <CachedImage
                src={loc.sourceImageUrl}
                alt={loc.name}
                className="w-full h-full object-cover"
                thumbnail
                thumbnailWidth={320}
              />
            </div>
          ) : (
            <div className="w-full aspect-square rounded-lg bg-muted/30 flex items-center justify-center opacity-60">
              <MapPin className="w-10 h-10 text-muted-foreground/30" />
            </div>
          )}
          <span className="text-sm font-medium truncate w-full text-center opacity-70" title={loc.name}>
            {loc.name}
          </span>
          <div className="flex gap-2 w-full">
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1 text-xs gap-1"
              onClick={(e) => onRestore(e, loc)}
              title={`Restore ${loc.name}`}
            >
              <ArchiveRestore className="w-3.5 h-3.5" />
              Restore
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => onPermanentDelete(e, loc)}
              title={`Permanently delete ${loc.name}`}
              aria-label={`Permanently delete ${loc.name}`}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// PermanentDeleteModal — typed-name confirmation. The two-step UX is
// intentionally implemented as a single modal with a "type the name" gate
// rather than a two-screen wizard: the visual + interactive cost of confirming
// is high enough on its own (read the name → type it → click) that an
// additional "Are you sure?" screen would add friction without raising the
// safety bar. The button stays disabled until the typed text matches exactly.
// ---------------------------------------------------------------------------

function PermanentDeleteModal({
  target,
  confirmText,
  onConfirmTextChange,
  deleting,
  onCancel,
  onConfirm,
}: {
  target: DbLocation
  confirmText: string
  onConfirmTextChange: (value: string) => void
  deleting: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const matches = confirmText === target.name
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60"
        onClick={deleting ? undefined : onCancel}
      />
      <div className="relative bg-card border rounded-xl shadow-2xl w-[440px] max-w-[90vw] p-5">
        <div className="flex items-start gap-3 mb-3">
          <div className="rounded-full bg-destructive/10 p-2 mt-0.5">
            <Trash2 className="w-4 h-4 text-destructive" />
          </div>
          <div>
            <h4 className="text-sm font-semibold">Permanently delete '{target.name}'?</h4>
            <p className="text-xs text-muted-foreground mt-1">
              This is permanent. The location row and every R2-hosted asset (main image,
              time-of-day variants, weather, seasons, angles, lighting, atmosphere
              motion clips, reference photos) will be deleted. This cannot be undone.
            </p>
          </div>
        </div>

        <div className="mb-3">
          <label
            htmlFor="permanent-delete-confirm"
            className="text-xs text-muted-foreground block mb-1.5"
          >
            Type <span className="font-semibold text-foreground">{target.name}</span> to confirm:
          </label>
          <input
            id="permanent-delete-confirm"
            type="text"
            value={confirmText}
            onChange={(e) => onConfirmTextChange(e.target.value)}
            disabled={deleting}
            autoFocus
            autoComplete="off"
            className="w-full px-3 py-2 text-sm bg-background border border-border rounded-md outline-none focus:ring-2 focus:ring-destructive/40"
            placeholder={target.name}
            aria-label="Type location name to confirm"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            onClick={onConfirm}
            disabled={!matches || deleting}
          >
            {deleting ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Trash2 className="w-3 h-3 mr-1" />
            )}
            Permanently delete
          </Button>
        </div>
      </div>
    </div>
  )
}
