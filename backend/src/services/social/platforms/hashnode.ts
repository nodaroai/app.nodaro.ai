import type { PlatformPublisher, PublishRequest, PublishResult } from "./index.js"

/**
 * Hashnode — GraphQL API. accessToken = the personal access token.
 * Connection metadata stores the publication id resolved at connect time.
 */

const GQL = "https://gql.hashnode.com"

async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: token },
    body: JSON.stringify({ query, variables }),
  })
  const data = (await res.json()) as { data?: T; errors?: Array<{ message: string }> }
  if (!res.ok || data.errors?.length || !data.data) {
    throw new Error(data.errors?.[0]?.message || "Hashnode API error")
  }
  return data.data
}

export async function fetchHashnodeUser(token: string): Promise<{ id: string; username: string; publicationId?: string }> {
  const data = await gql<{
    me: { id: string; username: string; publications: { edges: Array<{ node: { id: string } }> } }
  }>(
    token,
    `query { me { id username publications(first: 1) { edges { node { id } } } } }`,
    {},
  )
  return {
    id: data.me.id,
    username: data.me.username,
    publicationId: data.me.publications.edges[0]?.node.id,
  }
}

export const hashnodePublisher: PlatformPublisher = {
  async publish(
    accessToken: string,
    request: PublishRequest,
    metadata: Record<string, unknown>,
  ): Promise<PublishResult> {
    const publicationId = metadata.publication_id as string | undefined
    if (!publicationId) return { success: false, error: "Hashnode connection has no publication" }
    const title = request.title ?? request.caption?.split("\n")[0]
    if (!title) return { success: false, error: "Hashnode posts need a title" }

    const data = await gql<{ publishPost: { post: { id: string; url: string } } }>(
      accessToken,
      `mutation Publish($input: PublishPostInput!) {
        publishPost(input: $input) { post { id url } }
      }`,
      {
        input: {
          publicationId,
          title,
          contentMarkdown: request.description ?? request.caption ?? "",
          ...(request.mediaUrl ? { coverImageOptions: { coverImageURL: request.mediaUrl } } : {}),
        },
      },
    )
    return {
      success: true,
      platformPostId: data.publishPost.post.id,
      platformPostUrl: data.publishPost.post.url,
    }
  },
}
