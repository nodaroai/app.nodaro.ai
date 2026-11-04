/**
 * Admin → Nodaro Motion's style-only setting: per engine, what a direct
 * style-only run does (a Prism Flex run with an art style and nothing to
 * swap): the original clip restyled (the default) or the path of any
 * art-style Flex run, and its own engine prompt (the template by default)
 * (GET/PUT /v1/admin/nodaro-motion/style-only). Never saved
 * (`styleOnly: null`) = the defaults on every engine.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { fetchNodaroMotionStyleOnly, saveNodaroMotionStyleOnly } from "@/lib/api"

export function useNodaroMotionStyleOnly() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionStyleOnly(),
    queryFn: fetchNodaroMotionStyleOnly,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionStyleOnly() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: saveNodaroMotionStyleOnly,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.admin.nodaroMotionStyleOnly(), view)
    },
  })
}
