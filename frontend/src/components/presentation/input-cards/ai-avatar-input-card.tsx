"use client"

// frontend/src/components/presentation/input-cards/ai-avatar-input-card.tsx
//
// Published-app input card for the `ai-avatar` (HeyGen) node.
// Gives app users the same rich avatar/voice/script pickers as the editor,
// with optional per-field editability controlled by a `appInputFields` meta
// stored in the node's data by the workflow author.
//
// Layout by speech mode:
//   text  → avatar picker + voice picker + script textarea
//   audio → avatar picker only (audio is wired upstream; voice irrelevant)
//
// Value resolution follows the same fullscreen vs. canvas pattern used by
// every other input card: in fullscreen (app-runner) mode, `inputValues`
// overrides take precedence; in canvas mode the live node.data values are
// read directly (and updated via the store).

import { useCallback } from "react"
import { User } from "lucide-react"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { cn } from "@/lib/utils"
import type { InputCardProps } from "../input-card"
import { GlassCard } from "../output-cards/shared"
import { AvatarPicker } from "@/components/heygen/avatar-picker"
import { VoicePicker } from "@/components/heygen/voice-picker"
import type { HeygenAvatar, HeygenVoice } from "@/lib/api"
import { INPUT_CLS } from "./shared"

// ---------------------------------------------------------------------------
// AppInputFields — per-sub-control visibility flag stored by the app author
// in node.data.appInputFields.  All three default to true when absent.
// ---------------------------------------------------------------------------
interface AppInputFields {
  avatar?: boolean
  voice?: boolean
  script?: boolean
}

const LABEL_CLS =
  "text-xs font-medium text-muted-foreground uppercase tracking-wider"

// ---------------------------------------------------------------------------
// Sub-section label separator
// ---------------------------------------------------------------------------
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className={cn(LABEL_CLS, "mb-2")}>{children}</p>
  )
}

// ---------------------------------------------------------------------------
// AiAvatarInputCard
// ---------------------------------------------------------------------------

/**
 * Input card for the `ai-avatar` node in published apps and presentation mode.
 *
 * - `speechMode === "text"` (default): avatar picker + voice picker + script textarea
 * - `speechMode === "audio"`: avatar picker only (audio is wired from an
 *   upstream audio node; the voice picker has no meaning in that mode)
 *
 * Per-field editability: set `node.data.appInputFields.{avatar,voice,script} = false`
 * to hide/disable a sub-control.  The full card is still rendered; omitted
 * fields simply don't appear so the card stays clean even when only one lever
 * is exposed.
 *
 * Value reads: `isFullscreen` → inputValues[nodeId] override first, falls
 * back to node.data (same pattern as every other input card).
 */
export function AiAvatarInputCard({
  node,
  isFullscreen,
  inputValues,
  onUpdateInput,
  readOnly,
}: InputCardProps) {
  const data = node.data as Record<string, unknown>

  // Determine which sub-controls the app author wants to expose.
  const fields = (data.appInputFields ?? {}) as AppInputFields
  const showAvatar = fields.avatar !== false
  const showVoice  = fields.voice  !== false
  const showScript = fields.script !== false

  // Read speech mode from node.data (the app author sets this; it's not
  // overridden at run time via inputValues).
  const speechMode = (data.speechMode as string) ?? "text"
  const isTextMode = speechMode !== "audio"

  // ---- Resolve current values (fullscreen: inputValues first, else data) ----
  const nodeOverrides = isFullscreen ? (inputValues[node.id] ?? {}) : {}

  const avatarId  = String(nodeOverrides.avatarId  ?? data.avatarId  ?? "")
  const voiceId   = String(nodeOverrides.voiceId   ?? data.voiceId   ?? "")
  const script    = String(nodeOverrides.script     ?? data.script    ?? "")

  // ---- Writers ---------------------------------------------------------------
  const write = useCallback(
    (key: string, value: unknown) => {
      if (isFullscreen) {
        onUpdateInput(node.id, key, value)
      } else {
        useWorkflowStore.getState().updateNodeData(node.id, { [key]: value })
      }
    },
    [isFullscreen, node.id, onUpdateInput],
  )

  const handleAvatarSelect = useCallback(
    (avatar: HeygenAvatar) => {
      if (readOnly) return
      // Pre-fill voice with the avatar's default when no voice is set yet.
      const nextVoiceId = voiceId || avatar.defaultVoiceId
      write("avatarId", avatar.avatarId)
      if (nextVoiceId) write("voiceId", nextVoiceId)
    },
    [readOnly, voiceId, write],
  )

  const handleVoiceSelect = useCallback(
    (voice: HeygenVoice) => {
      if (readOnly) return
      write("voiceId", voice.voiceId)
    },
    [readOnly, write],
  )

  const handleScriptChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (readOnly) return
      write("script", e.target.value)
    },
    [readOnly, write],
  )

  // ---- Render ----------------------------------------------------------------

  // Nothing to show: app author hid every relevant control.
  const nothingVisible =
    !showAvatar &&
    (!isTextMode || (!showVoice && !showScript))

  if (nothingVisible) {
    return (
      <GlassCard>
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <User className="size-4 shrink-0" />
          <span>AI Avatar (no editable fields)</span>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard>
      <div className={cn("flex flex-col gap-4", readOnly && "opacity-70 pointer-events-none")}>

        {/* ---- Avatar picker ---- */}
        {showAvatar && (
          <div>
            <SectionLabel>Avatar</SectionLabel>
            <AvatarPicker
              value={avatarId || undefined}
              onSelect={handleAvatarSelect}
            />
          </div>
        )}

        {/* ---- Voice picker (text mode only) ---- */}
        {isTextMode && showVoice && (
          <div>
            <SectionLabel>Voice</SectionLabel>
            <VoicePicker
              value={voiceId || undefined}
              onSelect={handleVoiceSelect}
            />
          </div>
        )}

        {/* ---- Script textarea (text mode only) ---- */}
        {isTextMode && showScript && (
          <div>
            <SectionLabel>Script</SectionLabel>
            <textarea
              value={script}
              onChange={handleScriptChange}
              placeholder="Enter the script for the avatar to speak…"
              rows={4}
              maxLength={5000}
              className={cn(
                INPUT_CLS,
                "resize-none max-h-[40vh] overflow-y-auto",
              )}
              aria-label="Avatar script"
            />
            <p className="mt-1 text-right text-[10px] text-muted-foreground">
              {script.length}/5000
            </p>
          </div>
        )}

      </div>
    </GlassCard>
  )
}
