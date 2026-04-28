"use client"

import { memo } from "react"
import { getSetting } from "@nodaro/shared"
import { cn } from "@/lib/utils"
import "./setting.css"

interface SettingPreviewProps {
  readonly settingId: string
  readonly className?: string
}

/**
 * Static preview tile for a single setting. Uses a category-keyed gradient
 * background with a per-setting CSS accent (silhouette / texture) so each
 * tile reads as its own environment at a glance without 28 bespoke scenes.
 *
 * No animations — setting is a compositional dimension, not kinetic.
 */
export const SettingPreview = memo(function SettingPreview({ settingId, className }: SettingPreviewProps) {
  const category = getSetting(settingId)?.category ?? "nature"
  return (
    <div
      aria-hidden="true"
      className={cn(
        "setting-preview",
        `setting-preview--cat-${category}`,
        `setting-preview--${settingId}`,
        className,
      )}
    >
      <div className="setting-preview__scene" />
    </div>
  )
})
