import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { getVoiceClones, createVoiceClone, deleteVoiceClone } from "@/lib/api"

const STALE_TIME = 60_000 // 1 minute

export function useVoiceClones() {
  return useQuery({
    queryKey: queryKeys.voices.clones(),
    queryFn: getVoiceClones,
    staleTime: STALE_TIME,
  })
}

export function useCreateVoiceClone() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, file }: { name: string; file: Blob }) => createVoiceClone(name, file),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.voices.clones() }),
  })
}

export function useDeleteVoiceClone() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: deleteVoiceClone,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.voices.clones() }),
  })
}
