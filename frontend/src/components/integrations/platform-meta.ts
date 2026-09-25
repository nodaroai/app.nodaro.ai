import type { SocialProviderInfo } from "@/lib/api"
import type { MessageKey, TFunction } from "@/lib/i18n"

/**
 * One-line descriptions for the known networks. These used to live inside
 * `platform-card.tsx`; the redesigned page also SEARCHES them, so they moved
 * out rather than being duplicated or reached for through the card.
 *
 * The map holds dictionary keys; `describeProvider` translates at call time,
 * so the cards and the search both see the reader's language.
 */
const PLATFORM_DESCRIPTIONS: Readonly<Record<string, MessageKey>> = {
  instagram: "integ.platformDescInstagram",
  "instagram-standalone": "integ.platformDescInstagramDirect",
  tiktok: "integ.platformDescTiktok",
  youtube: "integ.platformDescYoutube",
  linkedin: "integ.platformDescLinkedin",
  x: "integ.platformDescX",
  facebook: "integ.platformDescFacebook",
  telegram: "integ.platformDescTelegram",
  bluesky: "integ.platformDescBluesky",
  devto: "integ.platformDescDevto",
  hashnode: "integ.platformDescHashnode",
  medium: "integ.platformDescMedium",
  wordpress: "integ.platformDescWordpress",
  lemmy: "integ.platformDescLemmy",
  reddit: "integ.platformDescReddit",
  pinterest: "integ.platformDescPinterest",
  discord: "integ.platformDescDiscord",
  twitch: "integ.platformDescTwitch",
  threads: "integ.platformDescThreads",
  mastodon: "integ.platformDescMastodon",
}

/**
 * The backend registry's media kinds (`MediaKind`: image, video, carousel,
 * story, text) in words. A kind added there before this map catches up shows
 * its id rather than nothing.
 */
const MEDIA_KIND_KEYS: Readonly<Record<string, MessageKey>> = {
  image: "integ.mediaImage",
  video: "integ.mediaVideo",
  carousel: "integ.mediaCarousel",
  story: "integ.mediaStory",
  text: "integ.mediaText",
}

/**
 * A network the registry added but this map has not caught up with still gets
 * a sentence, derived from its declared media capabilities — the grid has
 * always been allowed to grow from the backend alone.
 */
export function describeProvider(provider: SocialProviderInfo, t: TFunction): string {
  const key: MessageKey | undefined = PLATFORM_DESCRIPTIONS[provider.id]
  if (key) return t(key)
  const media = provider.capabilities.media
    .map((kind) => {
      const kindKey: MessageKey | undefined = MEDIA_KIND_KEYS[kind]
      return kindKey ? t(kindKey) : kind
    })
    .join(t("common.listComma"))
  return t("integ.platformDescFallbackMedia", { media })
}

export { PLATFORM_DESCRIPTIONS }
