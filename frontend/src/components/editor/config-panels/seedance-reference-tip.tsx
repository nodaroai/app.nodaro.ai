import { isSeedance2Provider } from "@nodaro/shared"

/**
 * Inline doctrine hint under the injected-references list, shown only for
 * Seedance 2.x providers: reference ORDER is priority, identity refs should
 * be a headshot + full-body pair (multi-view sheets cause identity drift).
 * Guidance only — never blocks or validates (no-false-positive rule).
 */
// `provider` is `unknown`-tolerant so loosely-typed node data (index-signature
// shapes like SpeechToVideoData) can pass `data.provider` without casts.
export function SeedanceReferenceTip({ provider }: { provider?: unknown }) {
  if (typeof provider !== "string" || !isSeedance2Provider(provider)) return null
  return (
    <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
      Seedance reads references by position — <span className="font-medium">Image 1 carries the most
      weight</span>, so drag the identity-critical ref first. For a person, one headshot + one full-body
      beats a multi-view sheet (sheets cause identity drift). 4–5 total assets beats maxing the caps.
    </p>
  )
}
