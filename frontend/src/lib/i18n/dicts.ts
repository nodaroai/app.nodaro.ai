// The chrome dictionaries, one per shipped locale. `en` is the canonical key
// set; every other dict is a partial map that falls back to English. This is
// the ONE registry both the translate() resolver and the offered-locales
// gate read, so a locale cannot be resolvable in one place and invisible in
// the other.
import type { LocaleId } from "@nodaro/shared"
import { en, type ChromeDict } from "./en"
import { he } from "./he"
import { ar } from "./ar"
import { de } from "./de"
import { es } from "./es"
import { fr } from "./fr"
import { hi } from "./hi"
import { ja } from "./ja"
import { ko } from "./ko"
import { ptBR } from "./pt-br"
import { ru } from "./ru"
import { zhCN } from "./zh-cn"

// All twelve shipped locales are registered here. Most start as stub dicts
// and fall back to English until translated; `en` and `he` are complete.
export const DICTS: Partial<Record<LocaleId, ChromeDict>> = {
  en, he, ar, de, es, fr, hi, ja, ko, "pt-BR": ptBR, ru, "zh-CN": zhCN,
}
