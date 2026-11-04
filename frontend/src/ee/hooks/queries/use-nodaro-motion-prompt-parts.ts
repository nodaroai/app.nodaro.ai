/**
 * The Cast Swap engine's prompt parts, as the admin screens read and save
 * them: a trend's engine prompt (Admin → Trends → one trend → 4. Prompts) and
 * the direct runs' overrides per engine and style (Admin → Nodaro Motion).
 * The engine owns every default and checks every override; a refused save is
 * a `PromptPartsInvalidError` with its problems, for the screen to show.
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import {
  fetchAdminTrendEnginePrompt,
  fetchNodaroMotionPromptParts,
  previewNodaroMotionPromptParts,
  saveAdminTrendEnginePrompt,
  saveNodaroMotionPromptParts,
  type AdminTrendEnginePrompt,
  type CastSwapPromptWordingId,
  type NodaroMotionPromptPartsKey,
  type NodaroMotionEngine,
  type PromptPartTexts,
} from "@/lib/api"

/** Errors are the screen's to show (inline problems, the out-of-date engine), not the default toast. */
const handledByScreen = () => {}

/** A trend's engine prompt for the saved draft at `revision`; asked only while `enabled` (the section is open). */
export function useTrendPromptParts(id: string, revision: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.admin.trendPromptParts(id, revision),
    queryFn: () => fetchAdminTrendEnginePrompt(id),
    enabled: hasAdmin() && enabled && !!revision,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 30_000,
  })
}

/** Save a trend's overrides at `revision`; the answer is cached under the revision the save moved the draft to. */
export function useSaveTrendPromptParts(id: string) {
  const qc = useQueryClient()
  return useMutation({
    onError: handledByScreen,
    mutationFn: ({ parts, revision }: { parts: PromptPartTexts; revision: string }) => saveAdminTrendEnginePrompt(id, parts, revision),
    onSuccess: (w) => {
      // Overrides cleared without asking the engine carry no answer: the next read asks it.
      if (!w.parts || w.assembled === undefined || !w.set) return
      const answer: AdminTrendEnginePrompt = {
        set: w.set,
        parts: w.parts,
        assembled: w.assembled,
        length: w.length ?? w.assembled.length,
        max: w.max ?? 0,
        problems: w.problems ?? [],
        overrides: w.overrides,
        revision: w.revision,
      }
      qc.setQueryData(queryKeys.admin.trendPromptParts(id, w.revision), answer)
    },
  })
}

export function useNodaroMotionPromptParts() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPromptParts(),
    queryFn: fetchNodaroMotionPromptParts,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

export function useSaveNodaroMotionPromptParts() {
  const qc = useQueryClient()
  return useMutation({
    onError: handledByScreen,
    mutationFn: saveNodaroMotionPromptParts,
    onSuccess: (view) => qc.setQueryData(queryKeys.admin.nodaroMotionPromptParts(), view),
  })
}

/**
 * One engine and key's (a style, or `styleOnly`) parts and assembled prompt with `overrides` (the
 * screen's edits). `shape`: what else decides the answer server-side (the
 * saved Motion setting's entry, as JSON), so a change of it asks again.
 * `promptWording`: the Flex wording to preview (the screen's choice; left
 * out = the engine's saved one, server-side).
 */
export function useNodaroMotionPromptPreview(
  engine: NodaroMotionEngine,
  style: NodaroMotionPromptPartsKey,
  overrides: PromptPartTexts,
  shape = "",
  enabled = true,
  promptWording?: CastSwapPromptWordingId,
) {
  const key = `${JSON.stringify(overrides)}|${shape}|${promptWording ?? ""}`
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionPromptPreview(engine, style, key),
    queryFn: () => previewNodaroMotionPromptParts({ engine, style, overrides, ...(promptWording ? { promptWording } : {}) }),
    enabled: hasAdmin() && enabled,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 60_000,
  })
}
