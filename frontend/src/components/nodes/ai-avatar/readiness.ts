// Readiness of an AI Avatar node — what its status bar says before a run.
//
// The rules MIRROR the ai-avatar branch of execute-node.ts (the validation
// that rejects a run with a toast); keep the two in lockstep so the bar never
// says "Ready to run" for a node the executor would refuse:
//   text mode  → a script (wired Script input OR typed) AND a voice
//   audio mode → audio (wired Audio input OR data.audioUrl)
//   avatar src → an avatarId        image src → an image (wired OR data.imageUrl)

import type { AiAvatarData } from "@/types/nodes"
import {
  AI_AVATAR_ENGINE_OPTIONS,
  AI_AVATAR_RESOLUTION_OPTIONS,
} from "@/components/editor/config-panels/model-options"

/** Which of the node's input handles currently have an incoming edge. */
export interface AiAvatarWiring {
  readonly script: boolean
  readonly audio: boolean
  readonly image: boolean
}

export type AiAvatarMissing = "avatar" | "image" | "voice" | "script" | "audio"

export interface AiAvatarReadiness {
  readonly ready: boolean
  /** In display order (visual → voice → script, or visual → audio) — the same
   *  order the ready sentence lists them in. */
  readonly missing: ReadonlyArray<AiAvatarMissing>
  /** Status-bar sentence. */
  readonly text: string
}

const MISSING_PHRASE: Record<AiAvatarMissing, string> = {
  avatar: "an avatar",
  image: "a source image",
  voice: "a voice",
  script: "a script",
  audio: "wired audio",
}

/** "a, b and c" — natural English list. */
function joinNatural(items: ReadonlyArray<string>): string {
  if (items.length <= 1) return items[0] ?? ""
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
}

export function computeAiAvatarReadiness(
  data: AiAvatarData,
  wiring: AiAvatarWiring,
): AiAvatarReadiness {
  const source = data.avatarSource ?? "avatar"
  const mode = data.speechMode ?? "text"

  const hasVisual =
    source === "image"
      ? wiring.image || !!data.imageUrl?.trim()
      : !!data.avatarId

  const missing: AiAvatarMissing[] = []
  if (!hasVisual) missing.push(source === "image" ? "image" : "avatar")
  if (mode === "text") {
    if (!data.voiceId) missing.push("voice")
    if (!(wiring.script || data.script?.trim())) missing.push("script")
  } else if (!(wiring.audio || data.audioUrl)) {
    missing.push("audio")
  }

  if (missing.length > 0) {
    return {
      ready: false,
      missing,
      text: `Needs ${joinNatural(missing.map((m) => MISSING_PHRASE[m]))} before it can run`,
    }
  }

  const visual = source === "image" ? "image" : "avatar"
  const set = mode === "text" ? `${visual}, voice and script` : `${visual} and audio`
  return { ready: true, missing, text: `Ready to run · ${set} are set` }
}

/**
 * The right-hand label of the status bar: which engine will render, at what
 * resolution. Image-source mode uses HeyGen's own image engine (no IV/V lever),
 * so it never claims an avatar engine it won't run.
 */
export function aiAvatarEngineLabel(data: AiAvatarData): string {
  const engine = data.engine ?? "avatar-iv"
  const resolution = data.resolution ?? "720p"
  const resolutionLabel =
    (AI_AVATAR_RESOLUTION_OPTIONS[engine] ?? AI_AVATAR_RESOLUTION_OPTIONS["avatar-iv"] ?? [])
      .find((o) => o.value === resolution)?.label ?? resolution
  if ((data.avatarSource ?? "avatar") === "image") {
    return `Image animation · ${resolutionLabel}`
  }
  const engineLabel = AI_AVATAR_ENGINE_OPTIONS.find((o) => o.value === engine)?.label ?? engine
  return `${engineLabel} · ${resolutionLabel}`
}
