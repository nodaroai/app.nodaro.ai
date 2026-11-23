/**
 * The language a share card speaks: the interface language the link was
 * shared in (`share_links.locale`, migration 689, sent by the creator's
 * client when it turns the link on), else English.
 *
 * The card's description is one line, "<what it is> made with Nodaro", in
 * every interface language Nodaro offers (the platform's languages: one set
 * in every Nodaro product). A link may record any language the platform has
 * a name for; one with no line here reads in English.
 */
import { z } from "zod"
import { LANGUAGES, type LocaleId } from "@nodaro/shared/i18n"
import type { ShareWorkKind } from "./tool-names.js"

/** The interface languages Nodaro offers, the ones a card has its own words in. */
export const SHARE_CARD_LOCALES = ["en", "de", "es", "he", "ja", "ko", "pt-BR"] as const satisfies readonly LocaleId[]
export type ShareCardLocale = (typeof SHARE_CARD_LOCALES)[number]

const LOCALE_IDS = LANGUAGES.map((l) => l.id) as [LocaleId, ...LocaleId[]]
const BY_LOWER = new Map<string, LocaleId>(LOCALE_IDS.map((id) => [id.toLowerCase(), id]))

/**
 * A language id as a link stores it: one the platform names (`pt-br` and
 * `pt-BR` alike), else its base language when the platform names that
 * (`de-AT` → `de`, `he-IL` → `he`), else null.
 */
export function normalizeShareLocale(value: unknown): LocaleId | null {
  if (typeof value !== "string") return null
  const raw = value.trim().replace(/_/g, "-").toLowerCase()
  if (!raw || raw.length > 35) return null
  const exact = BY_LOWER.get(raw)
  if (exact) return exact
  if (raw === "pt" || raw.startsWith("pt-")) return "pt-BR"
  if (raw === "iw" || raw.startsWith("iw-")) return "he"
  if (raw.startsWith("zh")) return BY_LOWER.get("zh-cn") ?? null
  return BY_LOWER.get(raw.split("-")[0]!) ?? null
}

/**
 * The request field: lenient about its value. Any string is accepted, and one
 * that names no language the platform knows is "the client did not say"
 * (never a 400), so an older or newer client never loses a share over a
 * language id. The route stores it through `normalizeShareLocale`. (A plain
 * string, so the OpenAPI document can describe it.)
 */
export const shareLocaleField = z
  .string()
  .optional()
  .describe(
    "The interface language the link is shared in (an id like `en`, `de`, `pt-BR`, `he`): the link's preview is written in it. Optional; omitted, the link keeps the language it has (English on a new link). An unknown id is ignored.",
  )

/** The card's language for a stored id: one it has words in, else English. */
export function cardLocaleOf(stored: string | null | undefined): ShareCardLocale {
  const id = normalizeShareLocale(stored)
  return (SHARE_CARD_LOCALES as readonly string[]).includes(id ?? "") ? (id as ShareCardLocale) : "en"
}

/** Open Graph's `og:locale` for a card language. */
export const OG_LOCALES: Readonly<Record<ShareCardLocale, string>> = {
  en: "en_US",
  de: "de_DE",
  es: "es_ES",
  he: "he_IL",
  ja: "ja_JP",
  ko: "ko_KR",
  "pt-BR": "pt_BR",
}

export const HTML_LANGS: Readonly<Record<ShareCardLocale, string>> = {
  en: "en",
  de: "de",
  es: "es",
  he: "he",
  ja: "ja",
  ko: "ko",
  "pt-BR": "pt-BR",
}

export const RTL_LOCALES: ReadonlySet<ShareCardLocale> = new Set(["he"])

interface CardWords {
  /** "A song made with Nodaro", by what the result is. */
  readonly made: Readonly<Record<ShareWorkKind, string>>
  /** A trend run: `{trend}` is the trend's name. */
  readonly trend: string
  /** A session: how many results it shows. */
  readonly results: (n: number) => string
  /** A project: how many sessions it shows. */
  readonly sessions: (n: number) => string
}

const n1 = (n: number, one: string, many: string): string => (n === 1 ? one : many.replace("{n}", String(n)))

export const CARD_WORDS: Readonly<Record<ShareCardLocale, CardWords>> = {
  en: {
    made: {
      image: "A picture made with Nodaro",
      video: "A video made with Nodaro",
      song: "A song made with Nodaro",
      speech: "A voice recording made with Nodaro",
      "sound-effect": "A sound effect made with Nodaro",
      audio: "An audio clip made with Nodaro",
    },
    trend: "Made with the {trend} trend on Nodaro",
    results: (n) => n1(n, "1 result made with Nodaro", "{n} results made with Nodaro"),
    sessions: (n) => n1(n, "1 session made with Nodaro", "{n} sessions made with Nodaro"),
  },
  de: {
    made: {
      image: "Ein mit Nodaro erstelltes Bild",
      video: "Ein mit Nodaro erstelltes Video",
      song: "Ein mit Nodaro erstellter Song",
      speech: "Eine mit Nodaro erstellte Sprachaufnahme",
      "sound-effect": "Ein mit Nodaro erstellter Soundeffekt",
      audio: "Ein mit Nodaro erstellter Audioclip",
    },
    trend: "Mit dem Trend „{trend}“ auf Nodaro erstellt",
    results: (n) => n1(n, "1 Ergebnis, erstellt mit Nodaro", "{n} Ergebnisse, erstellt mit Nodaro"),
    sessions: (n) => n1(n, "1 Sitzung, erstellt mit Nodaro", "{n} Sitzungen, erstellt mit Nodaro"),
  },
  es: {
    made: {
      image: "Una imagen creada con Nodaro",
      video: "Un vídeo creado con Nodaro",
      song: "Una canción creada con Nodaro",
      speech: "Una grabación de voz creada con Nodaro",
      "sound-effect": "Un efecto de sonido creado con Nodaro",
      audio: "Un clip de audio creado con Nodaro",
    },
    trend: "Creado con la tendencia {trend} en Nodaro",
    results: (n) => n1(n, "1 resultado creado con Nodaro", "{n} resultados creados con Nodaro"),
    sessions: (n) => n1(n, "1 sesión creada con Nodaro", "{n} sesiones creadas con Nodaro"),
  },
  he: {
    made: {
      image: "תמונה שנוצרה עם Nodaro",
      video: "סרטון שנוצר עם Nodaro",
      song: "שיר שנוצר עם Nodaro",
      speech: "הקלטת קול שנוצרה עם Nodaro",
      "sound-effect": "אפקט קולי שנוצר עם Nodaro",
      audio: "קטע שמע שנוצר עם Nodaro",
    },
    trend: "נוצר עם הטרנד {trend} ב-Nodaro",
    results: (n) => n1(n, "תוצאה אחת שנוצרה עם Nodaro", "{n} תוצאות שנוצרו עם Nodaro"),
    sessions: (n) => n1(n, "סשן אחד שנוצר עם Nodaro", "{n} סשנים שנוצרו עם Nodaro"),
  },
  ja: {
    made: {
      image: "Nodaroで作成した画像",
      video: "Nodaroで作成した動画",
      song: "Nodaroで作成した曲",
      speech: "Nodaroで作成した音声",
      "sound-effect": "Nodaroで作成した効果音",
      audio: "Nodaroで作成したオーディオ",
    },
    trend: "Nodaroの「{trend}」トレンドで作成",
    results: (n) => `Nodaroで作成した${n}件の作品`,
    sessions: (n) => `Nodaroで作成した${n}件のセッション`,
  },
  ko: {
    made: {
      image: "Nodaro로 만든 이미지",
      video: "Nodaro로 만든 동영상",
      song: "Nodaro로 만든 노래",
      speech: "Nodaro로 만든 음성",
      "sound-effect": "Nodaro로 만든 효과음",
      audio: "Nodaro로 만든 오디오",
    },
    trend: "Nodaro의 {trend} 트렌드로 만든 작품",
    results: (n) => `Nodaro로 만든 결과물 ${n}개`,
    sessions: (n) => `Nodaro로 만든 세션 ${n}개`,
  },
  "pt-BR": {
    made: {
      image: "Uma imagem criada com o Nodaro",
      video: "Um vídeo criado com o Nodaro",
      song: "Uma música criada com o Nodaro",
      speech: "Uma gravação de voz criada com o Nodaro",
      "sound-effect": "Um efeito sonoro criado com o Nodaro",
      audio: "Um clipe de áudio criado com o Nodaro",
    },
    trend: "Criado com a trend {trend} no Nodaro",
    results: (n) => n1(n, "1 resultado criado com o Nodaro", "{n} resultados criados com o Nodaro"),
    sessions: (n) => n1(n, "1 sessão criada com o Nodaro", "{n} sessões criadas com o Nodaro"),
  },
}
