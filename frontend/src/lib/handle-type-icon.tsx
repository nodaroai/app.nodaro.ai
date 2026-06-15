import type { ReactNode } from "react"
import {
  Type,
  Image as ImageIcon,
  Film,
  Music,
  Sparkles,
  Layers,
  UserCircle,
  Ban,
  ScanFace,
  Square,
  List,
  Braces,
  Circle,
} from "lucide-react"
import type { HandleColorType } from "./handle-colors"

/**
 * Icon for a connection `HandleColorType` — the same visual language as the
 * handle pips (text=Type, image=Image, video=Film, audio=Music, …). Used by the
 * in-search connector buttons so a connection reads as a typed wire, not a bare
 * dot. Pair with `getEdgeTypeColor` for the matching color.
 */
export function handleTypeIcon(type: HandleColorType | undefined): ReactNode {
  switch (type) {
    case "text":
      return <Type />
    case "image":
    case "imageRef":
    case "endFrame":
      return <ImageIcon />
    case "video":
      return <Film />
    case "audio":
    case "audioRef":
      return <Music />
    case "look":
    case "pickerJson":
      return <Sparkles />
    case "reference":
      return <Layers />
    case "identity":
      return <UserCircle />
    case "face":
      return <ScanFace />
    case "negative":
      return <Ban />
    case "mask":
      return <Square />
    case "list":
      return <List />
    case "variables":
      return <Braces />
    default:
      return <Circle />
  }
}
