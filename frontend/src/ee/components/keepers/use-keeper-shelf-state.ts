import { useEffect, useState } from "react"
import { toast } from "sonner"
import { KEEPER_CATALOG_SORT_MAX } from "@nodaro/shared/entities"
import { readKeeperShelf, setKeeperCatalog, type KeeperKind } from "@/lib/api"
import { tx } from "@/lib/i18n"

/** The shelf dialog's form: what the admin sees and edits, and what it can do. */
export interface KeeperShelfForm {
  readonly loading: boolean
  readonly loadFailed: boolean
  readonly submitting: boolean
  readonly onShelf: boolean
  readonly category: string
  /** The order as typed — validated, not coerced, so a half-typed value is never sent. */
  readonly sort: string
  readonly sortValid: boolean
  readonly canSubmit: boolean
  readonly setOnShelf: (value: boolean) => void
  readonly setCategory: (value: string) => void
  readonly setSort: (value: string) => void
  /** Writes the form through the kind's catalog route; resolves true when the dialog may close. */
  readonly submit: () => Promise<boolean>
}

/** The route's own rule for the order: an integer within ±KEEPER_CATALOG_SORT_MAX. */
export function isValidShelfSort(sort: string): boolean {
  const n = Number(sort)
  return sort.trim() !== "" && Number.isInteger(n) && Math.abs(n) <= KEEPER_CATALOG_SORT_MAX
}

/**
 * The state behind `KeeperShelfDialog`: prefilled from the item's own read on
 * every open (the server is the only truth for the shelf state, and a stale
 * draft from a previous item must never bleed through), locked while loading
 * or after a failed read, and written through `setKeeperCatalog`.
 */
export function useKeeperShelfState(kind: KeeperKind, entityId: string, open: boolean): KeeperShelfForm {
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [onShelf, setOnShelf] = useState(false)
  const [category, setCategory] = useState("")
  const [sort, setSort] = useState("0")

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setSubmitting(false)
    readKeeperShelf(kind, entityId)
      .then((state) => {
        if (cancelled) return
        setOnShelf(state.catalog)
        setCategory(state.category ?? "")
        setSort(String(state.sort))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadFailed(true)
        toast.error(err instanceof Error ? err.message : tx("apiErr.readKeeperShelf"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, kind, entityId])

  const sortValid = isValidShelfSort(sort)
  const canSubmit = !loading && !loadFailed && !submitting && sortValid

  const submit = async (): Promise<boolean> => {
    if (!canSubmit) return false
    setSubmitting(true)
    try {
      const trimmed = category.trim()
      const result = await setKeeperCatalog(kind, entityId, {
        catalog: onShelf,
        sort: Number(sort),
        category: trimmed ? trimmed : null,
      })
      toast.success(result.catalog ? tx("keepers.savedOn") : tx("keepers.savedOff"))
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tx("apiErr.setKeeperCatalog"))
      return false
    } finally {
      setSubmitting(false)
    }
  }

  return { loading, loadFailed, submitting, onShelf, category, sort, sortValid, canSubmit, setOnShelf, setCategory, setSort, submit }
}
