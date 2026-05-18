import { useState } from "react"
import type { EntityType } from "@nodaro/shared"
import { usePipelineEntities } from "@/hooks/use-pipeline-entities"
import { pipelinesApi } from "@/lib/pipelines-api"
import { EntityCard } from "./entity-card"
import { Button } from "@/components/ui/button"

interface Props {
  pipelineId: string
  entityType: EntityType
  title: string
}

export function EntityGrid({ pipelineId, entityType, title }: Props) {
  const { data, refetch } = usePipelineEntities(pipelineId, entityType)
  const [rejectingId, setRejectingId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)

  async function handleApprove(entityId: string) {
    setBusyId(entityId)
    try {
      await pipelinesApi.approveEntity(pipelineId, entityId)
      refetch()
    } finally {
      setBusyId(null)
    }
  }

  async function handleReject(entityId: string) {
    if (!feedback.trim()) return
    setBusyId(entityId)
    try {
      await pipelinesApi.rejectEntity(pipelineId, entityId, feedback)
      setRejectingId(null)
      setFeedback("")
      refetch()
    } finally {
      setBusyId(null)
    }
  }

  if (!data) return null

  return (
    <div className="mb-4">
      <div className="text-xs uppercase text-zinc-500 mb-2">{title}</div>
      {data.length === 0 ? (
        <div className="text-sm text-zinc-500 italic">No entities yet</div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {data.map((entity) => (
            <EntityCard
              key={entity.id}
              entity={entity}
              onApprove={() => handleApprove(entity.id)}
              onReject={() => setRejectingId(entity.id)}
              disabled={busyId === entity.id}
            />
          ))}
        </div>
      )}
      {rejectingId && (
        <div className="mt-3 p-3 rounded border border-zinc-200 bg-white">
          <div className="text-sm font-semibold mb-2">Reject with feedback</div>
          <textarea
            className="w-full rounded border border-zinc-300 p-2 text-sm"
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="What should change?"
          />
          <div className="flex gap-2 mt-2">
            <Button
              size="sm"
              onClick={() => handleReject(rejectingId)}
              disabled={!feedback.trim()}
            >
              Submit
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRejectingId(null)
                setFeedback("")
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
