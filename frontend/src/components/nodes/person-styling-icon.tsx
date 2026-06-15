"use client"

/**
 * Returns the small visual that goes alongside a selected Person/Styling
 * entry on the node card. Centralised so PersonNode and StylingNode don't
 * each duplicate the dim → icon-component dispatch.
 */

import type { ReactNode } from "react"
import {
  FacialHairIcon,
  FaceShapeIcon,
  JawlineIcon,
  EyeShapeIcon,
  NoseIcon,
  LipsIcon,
  EyewearIcon,
  HeadwearIcon,
} from "@/components/editor/config-panels/small-silhouette-icons"
import { ColorSwatch } from "@/components/editor/config-panels/color-swatch"
import { getPersonSwatch } from "@/components/editor/config-panels/color-swatches"
import { HairIcon } from "@/components/editor/config-panels/hair-icon"
import type { PersonDimension } from "@nodaro/shared"
import type { StylingDimension } from "@nodaro/shared"

const ICON_CN = "size-7 text-gray-600 dark:text-[#94A3B8]"

export function getPersonEntryIcon(dimension: PersonDimension, entryId: string): ReactNode {
  switch (dimension) {
    case "facial-hair":       return <FacialHairIcon facialHairId={entryId} className={ICON_CN} />
    case "face-shape":        return <FaceShapeIcon id={entryId} className={ICON_CN} />
    case "jawline":           return <JawlineIcon id={entryId} className={ICON_CN} />
    case "eye-shape":
    case "eyelid-type":
    case "canthal-tilt":
    case "eye-spacing":       return <EyeShapeIcon id={entryId} className={ICON_CN} />
    case "nose":
    case "nose-tip":          return <NoseIcon id={entryId} className={ICON_CN} />
    case "lip-fullness":
    case "lip-shape":         return <LipsIcon id={entryId} className={ICON_CN} />
    case "hair-color":
    case "skin-tone":
    case "eye-color": {
      const swatch = getPersonSwatch(entryId)
      return swatch ? <ColorSwatch value={swatch} className="size-5" /> : null
    }
    default:
      return null
  }
}

export function getStylingEntryIcon(dimension: StylingDimension, entryId: string): ReactNode {
  switch (dimension) {
    case "hair-cut":  return <HairIcon hairCutId={entryId} className={ICON_CN} />
    case "eyewear":   return <EyewearIcon eyewearId={entryId} className={ICON_CN} />
    case "headwear":  return <HeadwearIcon headwearId={entryId} className={ICON_CN} />
    default:
      return null
  }
}
