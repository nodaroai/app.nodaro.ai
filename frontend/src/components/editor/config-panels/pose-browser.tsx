"use client"

import { memo } from "react"
import { PersonStanding } from "lucide-react"
import { POSES } from "@nodaro-shared/pose"
import { DimensionModalBrowser } from "./dimension-modal-browser"
import { PoseIcon } from "./pose-icon"

/**
 * Modal browser for the Pose parameter node. ~25 entries with pose names
 * that describe shapes better seen than read ("lounging", "leaning",
 * "crouching"). Stick-figure silhouettes per pose.
 */
export const PoseBrowser = memo(function PoseBrowser({
  value,
  onChange,
  className,
}: {
  readonly value: string | undefined
  readonly onChange: (id: string | undefined) => void
  readonly className?: string
}) {
  return (
    <DimensionModalBrowser
      entries={POSES}
      value={value}
      onChange={onChange}
      title="Choose Pose"
      placeholder="Choose pose…"
      fallbackIcon={<PersonStanding className="size-3.5" />}
      renderIcon={(entry) => <PoseIcon poseId={entry.id} className="size-full" />}
      className={className}
    />
  )
})
