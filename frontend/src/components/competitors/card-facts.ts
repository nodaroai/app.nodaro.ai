import { SOCIAL_PLATFORMS, type ActionCard, type CompetitorPost, type SocialPlatform } from "@nodaro/shared"

/**
 * What the Competitors page reads off the action cards: which platform a
 * card is about, what people say about a brand on a platform, and how many
 * cards each brand has. Pure, so the page and its tests share it.
 */

const PLATFORMS: readonly string[] = SOCIAL_PLATFORMS

function isPlatform(value: unknown): value is SocialPlatform {
  return typeof value === "string" && PLATFORMS.includes(value)
}

/**
 * The platform a card is about: the one it names, else the one most of its
 * posts are on (the first such on a tie); null when it names none and has no
 * posts to go by.
 */
export function cardPlatform(card: ActionCard, posts: Readonly<Record<string, CompetitorPost>>): SocialPlatform | null {
  if (isPlatform(card.params.platform)) return card.params.platform
  const counts = new Map<SocialPlatform, number>()
  for (const id of card.evidence) {
    const platform = posts[id]?.platform
    if (isPlatform(platform)) counts.set(platform, (counts.get(platform) ?? 0) + 1)
  }
  let best: SocialPlatform | null = null
  let most = 0
  for (const [platform, n] of counts) {
    if (n > most) {
      best = platform
      most = n
    }
  }
  return best
}

/** The cards about a platform (all of them when none is chosen). */
export function cardsOn(cards: readonly ActionCard[], posts: Readonly<Record<string, CompetitorPost>>, platform: SocialPlatform | null): ActionCard[] {
  return platform ? cards.filter((card) => cardPlatform(card, posts) === platform) : [...cards]
}

export interface PeopleSay {
  /** complaints: people are unhappy (shown as a warning) · spreading: a post about them is taking off. */
  readonly kind: "complaints" | "spreading"
  /** The post's own words (untrusted: render as text). */
  readonly quote: string
}

const firstLine = (text: string | undefined): string => (text ?? "").split("\n").map((l) => l.trim()).find(Boolean) ?? ""
const str = (value: unknown): string => (typeof value === "string" ? value : "")

/**
 * What people say about a brand on a platform, from its cards: complaints
 * with a post on that platform first, else a post about it spreading there;
 * null when neither.
 */
export function peopleSay(
  cards: readonly ActionCard[],
  posts: Readonly<Record<string, CompetitorPost>>,
  subjectId: string,
  platform: SocialPlatform,
): PeopleSay | null {
  const theirs = cards.filter((card) => card.subjectId === subjectId)
  for (const card of theirs) {
    if (card.kind !== "complaints") continue
    const post = card.evidence.map((id) => posts[id]).find((p) => p?.platform === platform)
    if (post) return { kind: "complaints", quote: firstLine(post.title || post.text) || str(card.params.example) }
  }
  const spreading = theirs.find((card) => card.kind === "spreading" && card.params.platform === platform)
  return spreading ? { kind: "spreading", quote: str(spreading.params.firstLine) } : null
}

/** How many of the cards each brand has (market cards, about no one brand, are not counted). */
export function cardsPerBrand(cards: readonly ActionCard[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const card of cards) {
    if (card.subjectId) counts.set(card.subjectId, (counts.get(card.subjectId) ?? 0) + 1)
  }
  return counts
}
