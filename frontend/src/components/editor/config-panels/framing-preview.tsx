"use client"

import { memo } from "react"
import { cn } from "@/lib/utils"
import "./framing.css"

interface FramingPreviewProps {
  readonly framingId: string
  readonly className?: string
}

function Subject({ className }: { className?: string }) {
  return (
    <div className={cn("fr-subject", className)}>
      <div className="fr-head" />
      <div className="fr-body" />
      <div className="fr-shadow" />
    </div>
  )
}

const MULTI_SUBJECT_IDS = new Set([
  "two-shot",
  "three-shot",
  "over-the-shoulder-framing",
  "reverse-shot",
])

/**
 * Static preview for a single framing choice. Renders a scene + subject
 * silhouette sized and positioned to communicate the framing.
 */
export const FramingPreview = memo(function FramingPreview({
  framingId,
  className,
}: FramingPreviewProps) {
  const showExtraSubject = MULTI_SUBJECT_IDS.has(framingId)
  const showThirdSubject = framingId === "three-shot"

  return (
    <div
      aria-hidden="true"
      className={cn("fr-root", `fr-${framingId}`, className)}
    >
      <div className="fr-viewport">
        <div className="fr-ground" />
        <div className="fr-horizon" />
        <Subject />
        {showExtraSubject && (
          <div className="fr-subject-2">
            <div className="fr-head" />
            <div className="fr-body" />
            <div className="fr-shadow" />
          </div>
        )}
        {showThirdSubject && (
          <div className="fr-subject-3">
            <div className="fr-head" />
            <div className="fr-body" />
            <div className="fr-shadow" />
          </div>
        )}
        <div className="fr-thirds-overlay" />
        <div className="fr-leading-lines-overlay" />
      </div>
    </div>
  )
})
