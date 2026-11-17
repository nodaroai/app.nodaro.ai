import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import type { CreateTopicInput, TrackedTopic } from "@nodaro/shared/social"
import { scanLanded, scanStateOf, type ScanState } from "@/components/competitors/scan-state"
import { useInFlight } from "@/components/competitors/use-in-flight"
import { useTopicCards, useTopicMutations, useTopics } from "@/hooks/queries/use-topics-queries"
import { isNotReadyError } from "@/lib/api"
import { useT, type MessageKey } from "@/lib/i18n"
import { queryKeys } from "@/lib/query-keys"
import { changedTopicFields } from "./topic-form"
import type { TopicActions } from "./topic-row"
import { scanBlockText, scanBlocks } from "./topic-scan-rights"

/** What the page body shows: the list is on its way, the server has no topics, the list could not be read, or the list. */
export type TopicsBodyState = "loading" | "unavailable" | "error" | "ready"

/**
 * The body's state from the list query. A list already read stays shown when
 * a later re-read fails (one failed poll does not hide it).
 */
export function topicsBodyState(list: { readonly data: unknown; readonly error: unknown }): TopicsBodyState {
  if (list.data === null) return "unavailable"
  if (list.data !== undefined) return "ready"
  if (isNotReadyError(list.error)) return "unavailable"
  return list.error ? "error" : "loading"
}

/** Re-reads every topic query as soon as one topic's scan lands, whatever the others are still doing. */
function useScanLanding(topics: readonly TrackedTopic[]) {
  const qc = useQueryClient()
  const seen = useRef<ScanState>(new Map())
  useEffect(() => {
    const landed = scanLanded(seen.current, topics)
    seen.current = scanStateOf(topics)
    if (landed) void qc.invalidateQueries({ queryKey: queryKeys.topics.all })
  }, [topics, qc])
}

/** The add / edit form: whether it is open, the topic edited, and Save (an edit sends only what changed). */
function useTopicEditing(fail: (fallback: MessageKey) => (err: unknown) => void, inFlight: ReturnType<typeof useInFlight>) {
  const t = useT()
  const { create, update } = useTopicMutations()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<TrackedTopic | null>(null)
  const close = () => {
    setOpen(false)
    setEditing(null)
  }
  const submit = (input: CreateTopicInput) => {
    const done = () => {
      close()
      toast.success(t("topics.saved"))
    }
    if (!editing) return create.mutate(input, { onSuccess: done, onError: fail("apiErr.saveTopic") })
    const changes = changedTopicFields(editing, input)
    if (Object.keys(changes).length === 0) return done()
    const id = editing.id
    void inFlight.track(id, () => update.mutateAsync({ id, input: changes })).then(done, fail("apiErr.saveTopic"))
  }
  const start = (topic: TrackedTopic | null) => {
    setEditing(topic)
    setOpen(true)
  }
  return { open, editing, start, close, submit, busy: create.isPending || update.isPending }
}

/** The Topics page's data and what its controls do. */
export function useTopicsPage() {
  const t = useT()
  const list = useTopics()
  const topics = useMemo(() => list.data?.data ?? [], [list.data])
  // The plan's cap on topics: 0 locks the page, null is no cap.
  const limit = list.data?.limits?.topics
  const cards = useTopicCards(topics.length > 0)
  const { remove, scan } = useTopicMutations()
  const inFlight = useInFlight()
  const fail = (fallback: MessageKey) => (err: unknown) => toast.error(err instanceof Error ? err.message : t(fallback))
  const form = useTopicEditing(fail, inFlight)
  const [removing, setRemoving] = useState<TrackedTopic | null>(null)
  const [openedId, setOpenedId] = useState<string | null>(null)
  useScanLanding(topics)

  const blocks = useMemo(() => scanBlocks(topics, limit), [topics, limit])
  const scanBlockedWhy = (topic: TrackedTopic) => {
    const block = blocks.get(topic.id)
    return block ? scanBlockText(block, limit, t) : null
  }
  // Promises, not mutate() callbacks: those fire for a mutation's latest call only.
  const startScan = (topic: TrackedTopic) =>
    void inFlight.track(topic.id, () => scan.mutateAsync(topic.id)).then(() => toast.success(t("topics.scanStarted", { name: topic.name })), fail("apiErr.scanTopic"))
  const removeTopic = (topic: TrackedTopic) => remove.mutate(topic.id, { onSuccess: () => toast.success(t("topics.removed")), onError: fail("apiErr.deleteTopic") })
  const actions: TopicActions = {
    isBusy: (topic) => inFlight.isBusy(topic.id),
    scanBlockedWhy,
    onOpen: (topic) => setOpenedId(topic.id),
    onScan: startScan,
    onEdit: form.start,
    onRemove: setRemoving,
  }
  const opened = topics.find((topic) => topic.id === openedId) ?? null
  return { list, topics, limit, cards, form, actions, removing, setRemoving, removeTopic, opened, closeOpened: () => setOpenedId(null) }
}
