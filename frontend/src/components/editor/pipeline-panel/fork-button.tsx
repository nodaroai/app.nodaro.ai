"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { pipelinesApi } from "@/lib/pipelines-api"

interface Props {
  readonly pipelineId: string
  readonly pipelineStatus: string
  readonly onForked?: () => void
}

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "forked",
])

/**
 * Phase 1B.4 — "Fork pipeline" panel header button. Hidden on terminal
 * statuses (the backend route returns 409 there anyway; hiding the button
 * keeps the UX honest). Clicking opens a destructive-action confirm Dialog
 * before calling `pipelinesApi.forkPipeline`. The orchestrator stops at the
 * next checkpoint and unspent credits are refunded — this is irreversible.
 */
export function ForkButton({ pipelineId, pipelineStatus, onForked }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  if (TERMINAL_STATUSES.has(pipelineStatus)) return null

  const handleFork = async () => {
    setWorking(true)
    setErrMsg(null)
    try {
      await pipelinesApi.forkPipeline(pipelineId)
      setConfirming(false)
      onForked?.()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error("[fork-button] fork failed:", err)
      setErrMsg(message)
    } finally {
      setWorking(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setConfirming(true)}
        data-testid="fork-pipeline-trigger"
      >
        Fork pipeline
      </Button>
      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent data-testid="fork-pipeline-dialog">
          <DialogHeader>
            <DialogTitle>Fork this pipeline?</DialogTitle>
            <DialogDescription>
              Forking takes the canvas off the pipeline&apos;s hands. The engine stops at
              the next checkpoint and unspent credits are refunded.{" "}
              <strong>This cannot be undone.</strong> You can keep editing the canvas
              freely after forking.
            </DialogDescription>
          </DialogHeader>
          {errMsg && (
            <div className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-800">
              {errMsg}
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirming(false)}
              disabled={working}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleFork}
              disabled={working}
              data-testid="fork-pipeline-confirm"
            >
              {working ? "Forking…" : "Fork"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
