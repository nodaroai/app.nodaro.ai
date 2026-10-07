import { useState } from "react"
import { Link } from "react-router-dom"
import { Database, Loader2, MoreHorizontal, Plus } from "lucide-react"
import { toast } from "sonner"
import type { Collection } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { DeleteConfirmationDialog } from "@/components/ui/delete-confirmation-dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { CollectionCapMeter } from "@/components/collections/collection-cap-meter"
import { CollectionFormDialog } from "@/components/collections/collection-form-dialog"
import { useCollectionMutations, useCollections } from "@/hooks/queries/use-collections-queries"
import { useT } from "@/lib/i18n"
import { formatNumber } from "@/lib/i18n/format"

/**
 * Collections: the named sets of records a person's workflows save to and
 * read back. Create, rename, delete; each card says how full it is against
 * the plan's cap and opens the collection's records.
 */
export default function CollectionsPage() {
  const t = useT()
  const list = useCollections()
  const { create, update, remove } = useCollectionMutations()
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Collection | null>(null)
  const [removing, setRemoving] = useState<Collection | null>(null)

  const collections = list.data?.data ?? []
  const caps = list.data?.caps ?? { collections: null, records: null }
  const available = list.data?.available ?? true
  const atLimit = caps.collections !== null && collections.length >= caps.collections

  const submit = (input: { name: string; description: string }) => {
    if (editing) {
      update.mutate(
        { id: editing.id, input },
        {
          onSuccess: () => {
            toast.success(t("collections.updated"))
            setFormOpen(false)
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : t("apiErr.updateCollection")),
        },
      )
      return
    }
    create.mutate(input, {
      onSuccess: () => {
        toast.success(t("collections.created"))
        setFormOpen(false)
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : t("apiErr.createCollection")),
    })
  }

  const confirmRemove = (collection: Collection) => {
    remove.mutate(collection.id, {
      onSuccess: () => toast.success(t("collections.deleted")),
      onError: (err) => toast.error(err instanceof Error ? err.message : t("apiErr.deleteCollection")),
    })
  }

  return (
    <div className="container mx-auto max-w-6xl p-6">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <Database className="h-6 w-6 text-muted-foreground" />
            <h1 className="text-2xl font-semibold">{t("collections.title")}</h1>
          </div>
          <p className="max-w-2xl text-sm text-muted-foreground">{t("collections.description")}</p>
        </div>
        {available && (
          <Button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            disabled={atLimit || list.isLoading}
          >
            <Plus className="me-1.5 h-4 w-4" />
            {t("collections.new")}
          </Button>
        )}
      </div>

      {list.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{t("apiErr.loadCollections")}</div>
      ) : !available ? (
        <div className="rounded-lg border bg-muted/40 p-6 text-center text-sm text-muted-foreground">{t("collections.notAvailable")}</div>
      ) : collections.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Database className="mb-3 h-10 w-10 text-muted-foreground/40" />
          <p className="max-w-md text-sm text-muted-foreground">{t("collections.empty")}</p>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => (
              <li key={collection.id} className="relative rounded-lg border bg-card p-4 transition-colors hover:border-foreground/30">
                <div className="flex items-start gap-2">
                  <Link to={`/collections/${collection.id}`} className="min-w-0 flex-1">
                    <h2 className="truncate text-base font-medium" dir="auto">
                      {collection.name}
                    </h2>
                    {collection.description && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground" dir="auto">
                        {collection.description}
                      </p>
                    )}
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label={t("common.more")}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => {
                          setEditing(collection)
                          setFormOpen(true)
                        }}
                      >
                        {t("collections.edit")}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setRemoving(collection)}>
                        {t("collections.deleteCollection")}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <CollectionCapMeter count={collection.recordCount} cap={caps.records} className="mt-3" />
              </li>
            ))}
          </ul>
          {caps.collections !== null && (
            <p className="mt-4 text-xs text-muted-foreground">
              {t("collections.limitLine", { n: formatNumber(collections.length), cap: formatNumber(caps.collections) })}
            </p>
          )}
        </>
      )}

      <CollectionFormDialog open={formOpen} collection={editing} onOpenChange={setFormOpen} onSubmit={submit} busy={create.isPending || update.isPending} />
      <DeleteConfirmationDialog
        isOpen={removing !== null}
        onClose={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) confirmRemove(removing)
        }}
        title={t("collections.deleteConfirmTitle")}
        description={t("collections.deleteConfirmDesc")}
        confirmLabel={t("common.delete")}
      />
    </div>
  )
}
