/**
 * Admin → Nodaro Motion's stored settings sets
 * (/v1/admin/nodaro-motion/settings-sets): the list, and its writes. A write
 * changes the stored sets only, never a live setting; each refreshes the list.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import {
  createMotionSettingsSet,
  deleteMotionSettingsSet,
  fetchMotionSettingsSets,
  markMotionSettingsSetLive,
  updateMotionSettingsSet,
  type MotionSettings,
} from "@/ee/lib/nodaro-motion-settings-sets-api"

export function useMotionSettingsSets() {
  return useQuery({
    queryKey: queryKeys.admin.nodaroMotionSettingsSets(),
    queryFn: fetchMotionSettingsSets,
    enabled: hasAdmin(),
    staleTime: 30_000,
  })
}

function useRefreshing<A, R>(fn: (arg: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.admin.nodaroMotionSettingsSets() }),
  })
}

export function useCreateMotionSettingsSet() {
  return useRefreshing((v: { name: string; settings: MotionSettings }) => createMotionSettingsSet(v.name, v.settings))
}

export function useUpdateMotionSettingsSet() {
  return useRefreshing((v: { id: string; name?: string; settings?: MotionSettings }) =>
    updateMotionSettingsSet(v.id, { ...(v.name !== undefined ? { name: v.name } : {}), ...(v.settings !== undefined ? { settings: v.settings } : {}) }),
  )
}

export function useDeleteMotionSettingsSet() {
  return useRefreshing((id: string) => deleteMotionSettingsSet(id))
}

export function useMarkMotionSettingsSetLive() {
  return useRefreshing((id: string) => markMotionSettingsSetLive(id))
}
