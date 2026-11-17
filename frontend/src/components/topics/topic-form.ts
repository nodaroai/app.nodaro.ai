import {
  TOPIC_DEFAULT_PLATFORMS,
  TOPIC_PLATFORMS,
  type CompetitorSchedule,
  type CreateTopicInput,
  type TopicPlatform,
  type TopicPostCount,
  type TrackedTopic,
  type UpdateTopicInput,
} from "@nodaro/shared/social"

/**
 * The topic form as data: its state, what it sends, and what an edit
 * changes. Pure, so the dialog and its tests share it.
 */

/** The longest name a topic form takes. */
export const TOPIC_NAME_MAX_LENGTH = 100

export interface TopicFormState {
  readonly name: string
  /** The hashtag or phrase; empty searches the name. */
  readonly term: string
  readonly platforms: readonly TopicPlatform[]
  readonly postCount: TopicPostCount
  readonly schedule: CompetitorSchedule
}

/** A new topic's form: no name, the default platforms, 20 posts per search, weekly (the server's defaults). */
export function emptyTopicForm(): TopicFormState {
  return { name: "", term: "", platforms: TOPIC_DEFAULT_PLATFORMS, postCount: 20, schedule: "weekly" }
}

/** A followed topic's form, to edit it. */
export function topicFormFrom(topic: TrackedTopic): TopicFormState {
  return { name: topic.name, term: topic.term, platforms: topic.platforms, postCount: topic.postCount, schedule: topic.schedule }
}

/** The form as the API's input: the term is the name when none was typed; platforms in the page's order. */
export function topicInputFrom(form: TopicFormState): CreateTopicInput {
  const name = form.name.trim()
  return {
    name,
    term: form.term.trim().replace(/\s+/g, " ") || name,
    platforms: TOPIC_PLATFORMS.filter((p) => form.platforms.includes(p)),
    postCount: form.postCount,
    schedule: form.schedule,
  }
}

/** What an edit changes. An unchanged schedule is not sent: sending it would restart the topic's schedule. */
export function changedTopicFields(before: TrackedTopic, input: CreateTopicInput): UpdateTopicInput {
  const platforms = input.platforms ?? []
  const samePlatforms = platforms.length === before.platforms.length && platforms.every((p) => before.platforms.includes(p))
  return {
    ...(input.name !== before.name ? { name: input.name } : {}),
    ...(input.term !== undefined && input.term !== before.term ? { term: input.term } : {}),
    ...(input.platforms !== undefined && !samePlatforms ? { platforms: input.platforms } : {}),
    ...(input.postCount !== undefined && input.postCount !== before.postCount ? { postCount: input.postCount } : {}),
    ...(input.schedule !== undefined && input.schedule !== before.schedule ? { schedule: input.schedule } : {}),
  }
}
