import { useMutation } from "@tanstack/react-query"
import type { PipelineMode, PipelineStatus } from "@nodaro/shared"
import { Button } from "@/components/ui/button"
import { pipelinesApi } from "@/lib/pipelines-api"

interface Props {
  pipelineId: string
  mode: PipelineMode | null | undefined
  status: PipelineStatus | string | null | undefined
  onSwitched: () => void
}

/**
 * Phase 1D.2a §4.5 — "Switch to Manual" button. Visible only while a
 * pipeline is actively running (or paused at an approval gate) in `auto`
 * or `guided` mode. Failed/completed/cancelled pipelines use the Branch
 * path instead — there's nothing to switch on a terminal run.
 *
 * The API helper (`pipelinesApi.patchMode`) calls `PATCH /v1/pipelines/:id`
 * with `{ mode: 'manual' }`. The backend enforces the same gate (route
 * I2); a stale UI click against an ineligible pipeline surfaces as a
 * thrown error from the mutation.
 */
export function ModeSwitchButton({ pipelineId, mode, status, onSwitched }: Props) {
  const mutation = useMutation({
    mutationFn: () => pipelinesApi.patchMode(pipelineId, "manual"),
    onSuccess: () => onSwitched(),
  })
  const visible =
    (mode === "auto" || mode === "guided") &&
    (status === "running" || status === "awaiting_approval")
  if (!visible) return null
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={mutation.isPending}
      onClick={() => mutation.mutate()}
      data-testid="mode-switch-button"
    >
      {mutation.isPending ? "Switching…" : "Switch to Manual"}
    </Button>
  )
}
