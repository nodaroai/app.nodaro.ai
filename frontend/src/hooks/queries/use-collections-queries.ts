import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AddCollectionRecordInput, CreateCollectionInput, UpdateCollectionInput } from "@nodaro/shared"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"
import {
  addCollectionRecord,
  createCollection,
  deleteCollection,
  deleteCollectionRecord,
  deleteOrAlreadyGone,
  getCollection,
  listCollectionRecords,
  listCollections,
  updateCollection,
} from "@/lib/api"

const PAGE_SIZE = 50

type RecordFilters = { q?: string; since?: string }

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

/** A collection's records, newest first, a page at a time. */
export function useCollectionRecords(id: string | undefined, filters: RecordFilters) {
  const { user } = useAuth()
  return useInfiniteQuery({
    queryKey: queryKeys.collections.records(id ?? "", filters),
    queryFn: ({ pageParam }) => listCollectionRecords(id!, { ...filters, cursor: pageParam, limit: PAGE_SIZE }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: !!user && !!id,
    staleTime: 30_000,
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
  const removeRecord = useMutation({
    mutationFn: ({ id, recordId }: { id: string; recordId: string }) => deleteOrAlreadyGone(deleteCollectionRecord(id, recordId)),
    onSuccess: invalidateAll,
  })
  return { create, update, remove, addRecord, removeRecord }
}
