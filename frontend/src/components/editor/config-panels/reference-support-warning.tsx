"use client"

import { useMemo } from "react"
import { AlertTriangle } from "lucide-react"
import { MODELS_WITH_REFERENCE_IMAGE_SUPPORT, REF_IMAGE_MAX_LIMITS, DEFAULT_REF_IMAGE_MAX } from "./model-options"
import { T2I_TO_I2I_VARIANT } from "@nodaro/shared"

const IMAGE_TOKEN_RE = /\{image:(\d+)(?::([a-zA-Z0-9_-]+))?\}/gi

/**
 * Hard-no alternatives: providers that don't accept refs and don't have an
 * i2i sibling — point users at the only T2I family that actually supports
 * multi-reference natively.
 */
const NO_REF_ALTERNATIVE: Record<string, string> = {
  "ideogram-v3": "nano-banana-pro for native multi-reference T2I",
  "imagen4": "nano-banana-pro for native multi-reference T2I",
  "imagen4-fast": "nano-banana-pro for native multi-reference T2I",
  "imagen4-ultra": "nano-banana-pro for native multi-reference T2I",
  "z-image": "nano-banana-pro for native multi-reference T2I",
}

interface ReferenceSupportWarningProps {
  /** Selected provider for the node. */
  readonly provider: string | undefined
  /** The user prompt — scanned for {image:N:label} tokens. */
  readonly prompt: string | undefined
  /** Number of currently-attached references (manual + wired + char). */
  readonly attachedRefCount: number
}

interface UsageScan {
  readonly hasMentions: boolean
  readonly maxIndex: number
}

function scanPrompt(prompt: string | undefined): UsageScan {
  if (!prompt) return { hasMentions: false, maxIndex: 0 }
  let max = 0
  let any = false
  for (const m of prompt.matchAll(IMAGE_TOKEN_RE)) {
    any = true
    const n = parseInt(m[1], 10)
    if (Number.isFinite(n) && n > max) max = n
  }
  return { hasMentions: any, maxIndex: max }
}

/**
 * Renders inline warnings near the provider card when the user has reference
 * tokens or attached images that the selected model can't actually use:
 *
 *  - Provider has no ref support and no i2i sibling → "ignored" warning.
 *  - Provider has a lower limit than the number of attached refs → "limit" warning.
 *  - User mentions {image:N:…} where N exceeds attached count → "out of range".
 *
 * No banner shown for the auto-routing case — the swap is transparent.
 */
export function ReferenceSupportWarning({ provider, prompt, attachedRefCount }: ReferenceSupportWarningProps) {
  const { hasMentions, maxIndex } = useMemo(() => scanPrompt(prompt), [prompt])

  const messages: string[] = []

  if (provider) {
    const supports = MODELS_WITH_REFERENCE_IMAGE_SUPPORT.has(provider)
    const i2iVariant = T2I_TO_I2I_VARIANT[provider]

    if (!supports && (hasMentions || attachedRefCount > 0)) {
      const alt = NO_REF_ALTERNATIVE[provider]
      const tail = alt ? ` Use ${alt} instead.` : ""
      messages.push(
        `${provider} doesn't accept reference images — attached references and any \`@image:N:…\` tokens in the prompt will be ignored.${tail}`,
      )
    } else if (supports) {
      // Limit + out-of-range checks use the i2i variant's limit when the
      // backend will auto-route to it.
      const limit = REF_IMAGE_MAX_LIMITS[i2iVariant ?? provider] ?? DEFAULT_REF_IMAGE_MAX
      if (attachedRefCount > limit) {
        messages.push(
          `${i2iVariant ?? provider} accepts at most ${limit} reference image${limit === 1 ? "" : "s"} — only the first ${limit} will be sent.`,
        )
      }
      if (maxIndex > attachedRefCount) {
        messages.push(
          `\`@image:${maxIndex}\` mentioned in prompt but only ${attachedRefCount} reference${attachedRefCount === 1 ? " is" : "s are"} attached.`,
        )
      }
    }
  }

  if (messages.length === 0) return null

  return (
    <div className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 mt-1">
      {messages.map((msg, i) => (
        <p key={i} className="text-[11px] text-amber-700 dark:text-amber-300 leading-snug flex items-start gap-1.5">
          <AlertTriangle className="size-3 mt-0.5 shrink-0" aria-hidden />
          <span>{msg}</span>
        </p>
      ))}
    </div>
  )
}
