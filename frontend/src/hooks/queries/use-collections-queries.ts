import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type {
  AddCollectionRecordInput,
  CollectionBulkAction,
  CollectionRecordStatus,
  CollectionUsage,
  CreateCollectionInput,
  UpdateCollectionInput,
} from "@nodaro/shared"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"
import {
  addCollectionRecord,
  bulkCollectionRecords,
  createCollection,
  deleteCollection,
  deleteCollectionRecord,
  deleteCollectionRecordForever,
  deleteOrAlreadyGone,
  getCollection,
  listCollectionRecords,
  listCollections,
  restoreCollectionRecord,
  setCollectionRecordUsed,
  updateCollection,
} from "@/lib/api"

export type RecordFilters = {
  q?: string
  since?: string
  until?: string
  usage?: CollectionUsage
  status?: CollectionRecordStatus
  order?: "newest" | "oldest"
}

/** The person's collections with their record counts, their caps, and whether the server has collections at all. */
export function useCollections() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.collections.list(),
    queryFn: () => listCollections(),
    enabled: !!user,
    staleTime: 30_000,
  })
}

export function useCollection(id: string | undefined) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.collections.detail(id ?? ""),
    queryFn: () => getCollection(id!),
    enabled: !!user && !!id,
    staleTime: 30_000,
  })
}

/**
 * One numbered page of a collection's records (`offset` = (page − 1) × limit),
 * with how many match in all. The previous page stays on screen while the next
 * loads, so turning a page never flashes an empty list.
 */
export function useCollectionRecordsPage(id: string | undefined, filters: RecordFilters, page: { offset: number; limit: number }) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.collections.records(id ?? "", { ...filters, ...page }),
    queryFn: () => listCollectionRecords(id!, { ...filters, offset: page.offset, limit: page.limit }),
    enabled: !!user && !!id,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  })
}

export function useCollectionMutations() {
  const qc = useQueryClient()
  const invalidateAll = () => qc.invalidateQueries({ queryKey: queryKeys.collections.all })
  const create = useMutation({
    mutationFn: (input: CreateCollectionInput) => createCollection(input),
    onSuccess: invalidateAll,
  })
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCollectionInput }) => updateCollection(id, input),
    onSuccess: invalidateAll,
  })
  const remove = useMutation({
    // Already removed elsewhere (404) is the state the click asked for.
    mutationFn: (id: string) => deleteOrAlreadyGone(deleteCollection(id)),
    onSuccess: invalidateAll,
  })
  const addRecord = useMutation({
    mutationFn: ({ id, input }: { id: string; input: AddCollectionRecordInput }) => addCollectionRecord(id, input),
    onSuccess: invalidateAll,
  })
  /** To the Trash. */
  const removeRecord = useMutation({
    mutationFn: ({ id, recordId }: { id: string; recordId: string }) => deleteOrAlreadyGone(deleteCollectionRecord(id, recordId)),
    onSuccess: invalidateAll,
  })
  /** For good — a record already in the Trash. */
  const deleteForever = useMutation({
    mutationFn: ({ id, recordId }: { id: string; recordId: string }) => deleteOrAlreadyGone(deleteCollectionRecordForever(id, recordId)),
    onSuccess: invalidateAll,
  })
  const restoreRecord = useMutation({
    mutationFn: ({ id, recordId }: { id: string; recordId: string }) => restoreCollectionRecord(id, recordId),
    onSuccess: invalidateAll,
  })
  const bulkRecords = useMutation({
    mutationFn: ({ id, ids, action }: { id: string; ids: readonly string[]; action: CollectionBulkAction }) => bulkCollectionRecords(id, { ids, action }),
    onSuccess: invalidateAll,
  })
  const setUsed = useMutation({
    mutationFn: ({ id, recordId, used }: { id: string; recordId: string; used: boolean }) => setCollectionRecordUsed(id, recordId, used),
    onSuccess: invalidateAll,
  })
  return { create, update, remove, addRecord, removeRecord, deleteForever, restoreRecord, bulkRecords, setUsed }
}
