import { useState } from "react"
import { usePipelineEntities } from "@/hooks/use-pipeline-entities"
import { pipelinesApi } from "@/lib/pipelines-api"
import { SceneCard } from "./scene-card"
import { Button } from "@/components/ui/button"
import { useT } from "@/lib/i18n"

interface Props {
  pipelineId: string
  title: string
}

export function SceneGrid({ pipelineId, title }: Props) {
  const t = useT()
  const { data, refetch } = usePipelineEntities(pipelineId, "scene")
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
        <div className="text-sm text-zinc-500 italic">{t("pipe.noScenesYet")}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {data.map((entity) => (
            <SceneCard
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
          <div className="text-sm font-semibold mb-2">{t("pipe.rejectSceneWithFeedback")}</div>
          <textarea
            className="w-full rounded border border-zinc-300 p-2 text-sm"
            rows={3}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder={t("pipe.sceneShotListChangePlaceholder")}
          />
          <div className="flex gap-2 mt-2">
            <Button size="sm" onClick={() => handleReject(rejectingId)} disabled={!feedback.trim()}>
              {t("pipe.submit")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setRejectingId(null)
                setFeedback("")
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
