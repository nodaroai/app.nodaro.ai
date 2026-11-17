import type { CompetitorPost, SocialPost } from "@nodaro/shared/social"
import { reachOf } from "@/components/competitors/brand-platforms"

/** A topic's posts as the card views read them, by id: every one is about the topic. */
export function asAboutPosts(posts: readonly SocialPost[]): Readonly<Record<string, CompetitorPost>> {
  return Object.fromEntries(posts.map((post) => [post.id, { ...post, role: "about" as const }]))
}

/** The scan's posts, most reached first. */
export function postsByReach(posts: readonly SocialPost[]): SocialPost[] {
  return [...posts].sort((a, b) => reachOf(b) - reachOf(a))
}
