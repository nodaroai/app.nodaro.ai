/**
 * The Nodaro family, in canonical order — broad → specific, APPEND-ONLY:
 * a new app is added at the END so existing positions never reshuffle and
 * the order is identical on every surface. Every app's logo menu renders
 * this same list minus itself ({@link otherNodaroApps}), so the menus can't
 * drift apart across the fleet. (The client apps carry the same file; their
 * Flow entry tracks the platform origin they're built against.)
 */
export type NodaroAppId = "flow" | "studio" | "person" | "voice" | "recast"

export interface NodaroApp {
  readonly id: NodaroAppId
  readonly label: string
  readonly href: string
}

export const NODARO_APPS: readonly NodaroApp[] = [
  { id: "flow", label: "Flow", href: "https://app.nodaro.ai" },
  { id: "studio", label: "Studio", href: "https://studio.nodaro.ai" },
  { id: "person", label: "Person", href: "https://person.nodaro.ai" },
  { id: "voice", label: "Voice Changer Pro", href: "https://voice.nodaro.ai" },
  { id: "recast", label: "Recast", href: "https://recast.nodaro.ai" },
]

/** The canonical list minus the app rendering it. */
export function otherNodaroApps(current: NodaroAppId): readonly NodaroApp[] {
  return NODARO_APPS.filter((app) => app.id !== current)
}
