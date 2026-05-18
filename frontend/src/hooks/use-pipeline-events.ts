import { useEffect, useState } from "react"
import type { PipelineEvent } from "@nodaro/shared"
import { pipelinesApi } from "@/lib/pipelines-api"

export function usePipelineEvents(pipelineId: string | undefined): {
  events: PipelineEvent[]
  connected: boolean
} {
  const [events, setEvents] = useState<PipelineEvent[]>([])
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!pipelineId) return
    const url = pipelinesApi.eventsUrl(pipelineId)
    const source = new EventSource(url, { withCredentials: true })

    source.addEventListener("open", () => setConnected(true))
    source.addEventListener("error", () => setConnected(false))

    source.addEventListener("execution", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { data: PipelineEvent }
        setEvents((prev) => [...prev, data.data])
      } catch {
        // ignore malformed event
      }
    })
    source.addEventListener("done", () => {
      setConnected(false)
      source.close()
    })

    return () => {
      source.close()
      setConnected(false)
    }
  }, [pipelineId])

  return { events, connected }
}
