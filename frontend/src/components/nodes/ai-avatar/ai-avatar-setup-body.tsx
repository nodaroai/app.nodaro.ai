"use client"

// The AI Avatar card interior before a video exists (design: "AI Avatar Node"):
//
//   Empty       catalog source → the featured-avatar quick pick
//               image source   → the upload / wire prompt
//   Configured  the look on the left, voice + script (or wired audio) on the
//               right; "Change avatar" reopens the quick pick in place
//   foot        readiness + engine · resolution
//
// The result (video) view and the running spinner live in ai-avatar-node.tsx;
// this component owns the idle interior — also shown after a FAILED run (same
// card, red status bar with the error) and when the strip's "New run" hides
// the results. Every ACTION (Run, New run, settings) lives in the bottom
// strip, never in the card. Handles and the settings panel are untouched.

import { useCallback, useState } from "react"
import type { HeygenAvatar } from "@/lib/api"
import type { AiAvatarData } from "@/types/nodes"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { hasCredits } from "@/lib/edition"
import { avatarSelectionPatch } from "@/components/heygen/heygen-catalog"
import { AvatarPickerModal } from "@/components/heygen/avatar-picker-modal/avatar-picker-modal"
import { AvatarQuickPick } from "./avatar-quick-pick"
import { ImageSourceEmpty } from "./image-source-empty"
import { ConfiguredView } from "./configured-view"
import { AiAvatarStatusBar } from "./status-bar"
import { useAiAvatarWiring } from "./use-ai-avatar-wiring"
import { computeAiAvatarReadiness, aiAvatarEngineLabel } from "./readiness"

interface AiAvatarSetupBodyProps {
  readonly nodeId: string
  readonly data: AiAvatarData
  /** The last run failed: the setup stays editable and the status bar
   *  carries the error (the retry is the strip's Run). */
  readonly failureMessage?: string
  readonly failed?: boolean
  /** The node's run cost in credits (what the strip shows) — the avatar
   *  picker's DETAILS lists it. */
  readonly costCredits?: number
}

export function AiAvatarSetupBody({ nodeId, data, failed = false, failureMessage, costCredits }: AiAvatarSetupBodyProps) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const selectNode = useWorkflowStore((s) => s.selectNode)
  const wiring = useAiAvatarWiring(nodeId)

  // "Change avatar" shows the quick pick over a configured card. Local UI
  // state on purpose: it is a transient view, not part of the workflow.
  const [browsing, setBrowsing] = useState(false)
  // "Browse all N ›" opens the Avatar Picker modal, seeded with the card's
  // search text when there is one.
  const [picker, setPicker] = useState<{ open: boolean; query?: string }>({ open: false })

  const source = data.avatarSource ?? "avatar"
  const hasAvatar = !!data.avatarId
  const hasImage = wiring.image || !!data.imageUrl?.trim()

  const onUpdate = useCallback(
    (patch: Partial<AiAvatarData>) => updateNodeData(nodeId, patch),
    [nodeId, updateNodeData],
  )
  const openSettings = useCallback(() => selectNode(nodeId), [nodeId, selectNode])
  const pickAvatar = useCallback(
    (avatar: HeygenAvatar) => {
      onUpdate(avatarSelectionPatch(avatar, data.voiceId))
      setBrowsing(false)
    },
    [onUpdate, data.voiceId],
  )
  const openPicker = useCallback((query?: string) => setPicker({ open: true, query }), [])

  const readiness = computeAiAvatarReadiness(data, wiring)
  const engineLabel = aiAvatarEngineLabel(data)

  let view: "quick-pick" | "image-empty" | "configured"
  if (source === "image") view = hasImage ? "configured" : "image-empty"
  else view = hasAvatar && !browsing ? "configured" : "quick-pick"

  return (
    <div className="flex flex-col h-full min-h-0" data-testid="ai-avatar-setup-body" data-view={view}>
      <div className="flex-1 min-h-0">
        {view === "quick-pick" && (
          <AvatarQuickPick
            currentAvatarId={hasAvatar ? data.avatarId : undefined}
            onPick={pickAvatar}
            onBrowseAll={openPicker}
            onUseImage={() => { setBrowsing(false); onUpdate({ avatarSource: "image" }) }}
            onCancel={hasAvatar && browsing ? () => setBrowsing(false) : undefined}
          />
        )}
        {view === "image-empty" && (
          <ImageSourceEmpty
            onUploaded={(url) => onUpdate({ imageUrl: url })}
            onOpenSettings={openSettings}
            onUseCatalog={() => onUpdate({ avatarSource: "avatar" })}
          />
        )}
        {view === "configured" && (
          <ConfiguredView
            data={data}
            wiring={wiring}
            onUpdate={onUpdate}
            onChangeAvatar={() => setBrowsing(true)}
          />
        )}
      </div>
      <AiAvatarStatusBar
        readiness={readiness}
        engineLabel={engineLabel}
        failure={failed ? { message: failureMessage } : undefined}
      />
      {/* Mounted only while open: every AI Avatar node on the canvas renders
          this body, and a closed modal must not subscribe each of them to the
          7,000-look catalog. */}
      {picker.open && (
        <AvatarPickerModal
          open
          onOpenChange={(open) => setPicker((p) => ({ ...p, open }))}
          value={hasAvatar ? data.avatarId : undefined}
          initialQuery={picker.query}
          onSelect={pickAvatar}
          // Credits are a Cloud thing: off-cloud the hook hands back its
          // fallback, which must never be shown as a price.
          costLabel={hasCredits() && costCredits !== undefined && costCredits > 0 ? `from ${costCredits} CR` : undefined}
        />
      )}
    </div>
  )
}
