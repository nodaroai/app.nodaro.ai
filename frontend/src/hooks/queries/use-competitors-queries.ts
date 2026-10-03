import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CreateCompetitorInput, UpdateCompetitorInput } from "@nodaro/shared"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"
import {
  competitorCards,
  createCompetitor,
  deleteCompetitor,
  deleteOrAlreadyGone,
  getCompetitor,
  listCompetitors,
  scanCompetitor,
  updateCompetitor,
} from "@/lib/api"

/** While a scan runs, re-read this often so the page shows when it lands. */
const SCANNING_REFRESH_MS = 8_000

export function useCompetitors() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.competitors.list(),
    queryFn: () => listCompetitors(),
    enabled: !!user,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.some((c) => c.scanning) ? SCANNING_REFRESH_MS : false),
  })
}

export function useCompetitorDetail(id: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.competitors.detail(id ?? ""),
    queryFn: () => getCompetitor(id!),
    enabled: !!user && !!id,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.scanning ? SCANNING_REFRESH_MS : false),
  })
}

export function useCompetitorCards(enabled: boolean) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.competitors.cards(),
    queryFn: () => competitorCards(),
    enabled: enabled && !!user,
    staleTime: 30_000,
  })
}

export function useCompetitorMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.competitors.all })
  const create = useMutation({ mutationFn: (input: CreateCompetitorInput) => createCompetitor(input), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateCompetitorInput }) => updateCompetitor(id, input),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => deleteOrAlreadyGone(deleteCompetitor(id)), onSuccess: invalidate })
  const scan = useMutation({ mutationFn: (id: string) => scanCompetitor(id), onSuccess: invalidate })
  return { create, update, remove, scan }
}
