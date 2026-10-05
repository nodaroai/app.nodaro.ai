import type { ReactNode } from "react"
import { Instagram, Linkedin, Megaphone, MessagesSquare, Music2, Twitter, Youtube } from "lucide-react"
import type { SocialPlatform, SocialSearchMode } from "@nodaro/shared"
import type { MessageKey } from "@/lib/i18n"

/**
 * What the Social Search surfaces (node card, picker, settings) show per
 * platform. Names are brands and stay Latin in every language; everything a
 * person reads beside them goes through the dictionary.
 */
export interface SocialPlatformMeta {
  readonly name: string
  readonly icon: (className: string) => ReactNode
  /** What "account" means on this platform. */
  readonly accountLabel: MessageKey
  readonly accountPlaceholder: MessageKey
}

export const SOCIAL_PLATFORM_META: Readonly<Record<SocialPlatform, SocialPlatformMeta>> = {
  tiktok: { name: "TikTok", icon: (c) => <Music2 className={c} />, accountLabel: "social.modeAccount", accountPlaceholder: "social.phAccount" },
  instagram: { name: "Instagram", icon: (c) => <Instagram className={c} />, accountLabel: "social.modeAccount", accountPlaceholder: "social.phAccount" },
  youtube: { name: "YouTube", icon: (c) => <Youtube className={c} />, accountLabel: "social.modeChannel", accountPlaceholder: "social.phChannel" },
  x: { name: "X", icon: (c) => <Twitter className={c} />, accountLabel: "social.modeAccount", accountPlaceholder: "social.phAccount" },
  reddit: { name: "Reddit", icon: (c) => <MessagesSquare className={c} />, accountLabel: "social.modeAccount", accountPlaceholder: "social.phAccount" },
  linkedin: { name: "LinkedIn", icon: (c) => <Linkedin className={c} />, accountLabel: "social.modeCompany", accountPlaceholder: "social.phCompany" },
  meta_ads: { name: "Meta Ads", icon: (c) => <Megaphone className={c} />, accountLabel: "social.modeAdvertiser", accountPlaceholder: "social.phAdvertiser" },
}

/** The label of a search mode on a platform ("Page or profile" is LinkedIn's account). */
export function socialModeLabel(platform: SocialPlatform, mode: SocialSearchMode): MessageKey {
  if (mode === "keyword") return "social.modeKeyword"
  if (mode === "community") return "social.modeCommunity"
  return SOCIAL_PLATFORM_META[platform].accountLabel
}

/** The placeholder of the query field for a mode on a platform. */
export function socialQueryPlaceholder(platform: SocialPlatform, mode: SocialSearchMode): MessageKey {
  if (mode === "keyword") return "social.phKeyword"
  if (mode === "community") return "social.phCommunity"
  return SOCIAL_PLATFORM_META[platform].accountPlaceholder
}

/** "3 posts picked", or "The first 5 posts go on" when nobody picked. */
export function choiceLine(picked: boolean, n: number, t: (key: MessageKey, vars?: Record<string, string | number>) => string): string {
  if (picked) return n === 1 ? t("social.pickedOne") : t("social.pickedN", { n })
  return n === 1 ? t("social.firstOne") : t("social.firstN", { n })
}
