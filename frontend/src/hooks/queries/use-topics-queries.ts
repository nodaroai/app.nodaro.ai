import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CreateTopicInput, UpdateTopicInput } from "@nodaro/shared/social"
import { queryKeys } from "@/lib/query-keys"
import { useAuth } from "@/hooks/use-auth"
import { createTopic, deleteOrAlreadyGone, deleteTopic, getTopic, isNotReadyError, listTopics, scanTopic, topicCards, topicHistory, updateTopic } from "@/lib/api"

/** While a scan runs, re-read this often so the page shows when it lands. */
const SCANNING_REFRESH_MS = 8_000

/**
 * The person's topics, their plan's caps and how long scans are kept; null
 * when the server has no topic routes. A server whose database is not ready
 * for topics errors with `not_ready`, which is not worth asking again.
 */
export function useTopics() {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.topics.list(),
    queryFn: () => listTopics(),
    enabled: !!user,
    staleTime: 30_000,
    retry: (count, err) => !isNotReadyError(err) && count < 2,
    refetchInterval: (query) => (query.state.data?.data.some((topic) => topic.scanning) ? SCANNING_REFRESH_MS : false),
  })
}

/** A topic as of its latest scan, read while its window is open. */
export function useTopicDetail(id: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.topics.detail(id ?? ""),
    queryFn: () => getTopic(id!),
    enabled: !!user && !!id,
    staleTime: 30_000,
    refetchInterval: (query) => (query.state.data?.scanning ? SCANNING_REFRESH_MS : false),
  })
}

/** A topic's posts per platform, scan after scan. */
export function useTopicHistory(id: string | null) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.topics.history(id ?? ""),
    queryFn: () => topicHistory(id!),
    enabled: !!user && !!id,
    staleTime: 60_000,
  })
}

/** The cards of every topic's latest scan. */
export function useTopicCards(enabled: boolean) {
  const { user } = useAuth()
  return useQuery({
    queryKey: queryKeys.topics.cards(),
    queryFn: () => topicCards(),
    enabled: enabled && !!user,
    staleTime: 30_000,
  })
}

/**
 * Follow, change, stop following and scan a topic. Each re-reads every topic
 * query once it lands (the list, the cards, the topic's window). A remove of
 * a topic already gone counts as done.
 */
export function useTopicMutations() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.topics.all })
  const create = useMutation({ mutationFn: (input: CreateTopicInput) => createTopic(input), onSuccess: invalidate })
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTopicInput }) => updateTopic(id, input),
    onSuccess: invalidate,
  })
  const remove = useMutation({ mutationFn: (id: string) => deleteOrAlreadyGone(deleteTopic(id)), onSuccess: invalidate })
  const scan = useMutation({ mutationFn: (id: string) => scanTopic(id), onSuccess: invalidate })
  return { create, update, remove, scan }
}
