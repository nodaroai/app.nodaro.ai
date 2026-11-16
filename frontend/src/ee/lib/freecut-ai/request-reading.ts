/**
 * Reading a request for Edit with AI: which abilities it asks for, read from
 * its own words, and the planner model's answer turned into a plan.
 *
 * The words are read in the five languages Nodaro speaks. A request made only
 * of the cards' own phrases is read here and needs no model at all
 * (`cardOnlyPlan`); anything written in the person's own words goes to the
 * planner first, and this reading is only the fallback when it cannot answer.
 */
import { z } from "zod"
import { DEFAULT_MUSIC_STYLE, EDIT_STEPS, LOOKS, SPEAKER_LAYOUT_KINDS, type EditPlan, type EditStep, type Look, type PlanParams, type SpeakerLayoutKind } from "./edit-plan"

// `\b` knows only ASCII letters: a word with accents or in another script is bounded by lookarounds.
const INTENT_PATTERNS: Record<EditStep, RegExp> = {
  pauses: /pause|silen|dead air|\bgaps?\b|tighten|שתיק|הפסק|רווח|שקט|מתים|間を|無音|沈黙|詰め|침묵|공백|쉼|pausa|silênc|silenc|respiro/iu,
  // Not a bare "um": in Portuguese it is the article ("coloque um fundo musical").
  fillers: /filler|\bums\b|\bumm+s?\b|\buhs?\b|stutter|hesitat|מילות ה?מילוי|אממ|גמגו|היסוס|フィラー|えーと|言い淀|필러|군말|더듬|vícios? de linguagem|muletas?|(?<!\p{L})hã(?!\p{L})/iu,
  mistakes: /mistake|repeat|re-?takes?|restart|false start|stumbl|flub|off[- ]topic|טעו|חזרו|התחל(?:ה|ות) (?:שגוי|מחדש)|לא קשור|言い間違|間違い|繰り返|やり直|실수|반복|다시 시작|(?<!\p{L})erros?(?!\p{L})|repeti|recome[cç]|fora do assunto/iu,
  captions: /caption|subtit|text on screen|כתובי|תמליל על|字幕|テロップ|자막|legend/iu,
  music: /music|\bsong\b|soundtrack|\bbeat\b|\bbgm\b|מוזיק|שיר|מנגינ|פסקול|音楽|ＢＧＭ|음악|배경음|브금|música|trilha/iu,
  broll: /b[- ]?roll|cut-?aways?|stock (?:footage|shots?)|insert shots?|בי[- ]?רול|שוטים מכסים|インサート|[bＢ][- ]?ロール|b[- ]?롤|인서트|컷어웨이|imagens de apoio|cenas de cobertura/iu,
  titles: /\btitles?\b|headline|key ?words? on|on-?screen text|pop-?up text|text overlays?|כותרות|מילות מפתח על|טקסט שקופץ|見出し|キーワードを画面|화면에 제목|키워드를 화면|títulos|palavras-chave na tela/iu,
  picture:
    /background(?! (?:music|sound|track|score|noise))|backdrop|\bshirts?\b|clothes|outfit|jacket|\bdress\b|\bhair\b|\bcar\b|vehicle|\bsky\b|presenter|replace (?:the |him|her)|swap (?:the )?(?:person|face)|turn (?:it|him|her|them|the video) into|cartoon|anime|(?<!מוזיקת |מוסיקת |צלילי )רקע|חולצ|בגד|ז'קט|שמלה|שיער|רכב|מכונית|שמיים|מגיש|מצויר|אנימה|背景(?!音)|シャツ|服|髪|車|空を|アニメ風|배경(?!음)|옷|셔츠|머리를|자동차|하늘|만화|fundo(?! musical)|camisa|roupa|cabelo|carro|c[ée]u|desenho animado/iu,
  color:
    /colou?r grad|\bgrade\b|warm(?:er| up)?\b.{0,20}colou?r|colou?rs?.{0,20}warm|cinematic (?:look|colou?r)|\bLUT\b|black and white|b&w|gr[ae]yscale|לחמם|צבע חם|צבעים חמים|תיקון צבע|גרייד|שחור[- ]?לבן|色を暖|暖かい色|カラーグレーディング|色調補正|白黒|색감|색 보정|따뜻하게|흑백|cores? mais quentes|corre[cç][aã]o de cor|esquentar|preto e branco/iu,
  zoom: /zoom|punch[- ]?in|push[- ]?in|close-?up on|זום|התקרב|ズーム|寄り|줌|확대|aproxim/iu,
  phone: /9:16|vertical|portrait|\bphone\b|mobile|\bshorts\b|\breels?\b|tik ?tok|\bstories\b|אנכי|לטלפון|לנייד|טיקטוק|רילס|סטורי|縦|スマホ|ショート動画|リール|세로|휴대폰|모바일|쇼츠|릴스|celular|retrato/iu,
  layout: /speaker (?:layout|view)|(?:every|each|both) speakers?|split[- ]?screen|\bstacked\b|side by side|כל דובר|פריסת דוברים|מסך מפוצל|話者ごと|話者レイアウト|分割画面|화자마다|화자 레이아웃|분할 화면|cada falante|layout dos falantes|tela dividida/iu,
  cameras: /camera|\bangles?\b|multi-?cam|מצלמ|זוויות|カメラ|アングル|카메라|앵글|c[âa]mera|[âa]ngulo/iu,
  clips: /\bclips?\b|highlights?|קליפ|ハイライト|クリップ|클립|하이라이트|clipes?|melhores momentos/iu,
  trailer: /trailer|teaser|\bpromo\b|טריילר|טיזר|予告|トレーラー|티저|트레일러|예고편/iu,
  chapters: /chapters?|timestamps|table of contents|פרקים|チャプター|目次|챕터|타임스탬프|cap[íi]tulos/iu,
}

/** The abilities the request's words name, in card order. */
export function stepsInWords(request: string): EditStep[] {
  return EDIT_STEPS.filter((step) => INTENT_PATTERNS[step].test(request))
}

const LOOK_WORDS: ReadonlyArray<readonly [Look, RegExp]> = [
  ["bw", /black and white|b&w|gr[ae]yscale|שחור[- ]?לבן|白黒|흑백|preto e branco/iu],
  ["cool", /\bcool(?:er)?\b|\bcold\b|קר(?!\p{L})|קרים|クール|寒色|차갑|frio|fria/iu],
  ["vivid", /vivid|vibrant|punchy|saturat|עז|רווי|鮮やか|선명|생생|vibrante|vivo/iu],
]

/** The look a request asks for: warm unless it names another one. */
export function lookInWords(request: string): Look {
  return LOOK_WORDS.find(([, words]) => words.test(request))?.[0] ?? "warm"
}

/** How many clips a request asks for ("make 3 short clips"), within 1–6; 2 when it does not say. */
export function clipCountInWords(request: string): number {
  const match = /(\d+)\s*(?:\p{L}+\s*){0,3}?(?:clips?|highlights?|קליפ|クリップ|本|클립|개|clipes?)/iu.exec(request) ?? /(?:clips?|קליפים)\D{0,12}(\d+)/iu.exec(request)
  const n = match ? Number(match[1]) : NaN
  return Number.isFinite(n) && n >= 1 ? Math.min(6, Math.round(n)) : 2
}

/** The layout a request asks for: stacked unless it names another one. */
export function layoutInWords(request: string): SpeakerLayoutKind {
  if (/side by side|זה לצד זה|横並び|나란히|lado a lado/iu.test(request)) return "side"
  if (/\bgrid\b|רשת|グリッド|그리드|grade/iu.test(request)) return "grid"
  if (/picture[- ]in[- ]picture|\bpip\b|תמונה בתוך תמונה|ピクチャーインピクチャー|화면 속 화면/iu.test(request)) return "pip"
  return "stacked"
}

export const DEFAULT_PARAMS: PlanParams = { musicStyle: null, picture: null, look: "warm", clips: 2, layout: "stacked" }

/**
 * The plan a request asks for, read from its words alone: the planner's
 * fallback. A request that names nothing this edit can do gets no steps. A
 * picture change is passed on in the person's own words.
 */
export function planFromRequest(request: string): EditPlan {
  const steps = stepsInWords(request)
  return {
    steps,
    params: {
      musicStyle: steps.includes("music") ? DEFAULT_MUSIC_STYLE : null,
      picture: steps.includes("picture") ? { instruction: request.trim().slice(0, 400), what: null } : null,
      look: lookInWords(request),
      clips: clipCountInWords(request),
      layout: layoutInWords(request),
    },
    reply: null,
    cannot: [],
  }
}

// ── the cards' own phrases ───────────────────────────────────────────────────

/** A card's phrase in one language, and what it means when the request is only cards. */
export interface CardPhrase {
  readonly step: EditStep
  readonly text: string
}

/** What a card's phrase stands for, exactly: its default settings. */
const CARD_PARAMS: Partial<Record<EditStep, Partial<PlanParams>>> = {
  music: { musicStyle: DEFAULT_MUSIC_STYLE },
  picture: {
    picture: {
      instruction: "Replace the background with a bright sunny beach with sand and sea. Keep the person, their face, hair, clothes, movements and lip sync exactly the same.",
      what: null,
    },
  },
  color: { look: "warm" },
  clips: { clips: 2 },
}

const SEPARATORS = /^[\s,;،、，；.。!?…\-–—&+]*(?:(?:and|e|y|und|et|그리고|ו)[\s,;،、，；.。!?…\-–—&+]*)*$/iu
const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s+/g, " ")

/**
 * The plan of a request made only of the cards' phrases (in any of the
 * languages they are written in), with the cards' own settings; null when
 * anything else is written. Such a request needs no model to be read.
 */
export function cardOnlyPlan(request: string, phrases: readonly CardPhrase[]): EditPlan | null {
  let rest = normalize(request)
  const steps = new Set<EditStep>()
  // Longest first, so a phrase that contains another is taken whole.
  for (const phrase of [...phrases].sort((a, b) => b.text.length - a.text.length)) {
    const text = normalize(phrase.text).trim()
    if (!text || !rest.includes(text)) continue
    rest = rest.split(text).join(" , ")
    steps.add(phrase.step)
  }
  if (steps.size === 0 || !SEPARATORS.test(rest)) return null
  const ordered = EDIT_STEPS.filter((step) => steps.has(step))
  const params = ordered.reduce<PlanParams>((acc, step) => ({ ...acc, ...CARD_PARAMS[step] }), DEFAULT_PARAMS)
  // The layout card writes its frame into its phrase (side by side keeps the wide one).
  return { steps: ordered, params: { ...params, layout: layoutInWords(request) }, reply: null, cannot: [] }
}

// ── the planner's answer ─────────────────────────────────────────────────────

// Only the steps decide the plan; everything else is read leniently, so an odd
// field never throws a good plan away.
const modelPlan = z.object({
  steps: z.array(z.string()),
  musicStyle: z.unknown().optional(),
  picture: z.unknown().optional(),
  look: z.unknown().optional(),
  clips: z.unknown().optional(),
  layout: z.unknown().optional(),
  reply: z.unknown().optional(),
  cannot: z.unknown().optional(),
})

const MAX_CANNOT = 6
const MAX_CANNOT_CHARS = 120
const MAX_REPLY_CHARS = 400
const MAX_STYLE_CHARS = 300
const MAX_INSTRUCTION_CHARS = 600

const textOf = (value: unknown, max: number): string | null => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null)

function pictureOf(value: unknown): PlanParams["picture"] {
  if (!value || typeof value !== "object") return null
  const v = value as { instruction?: unknown; what?: unknown }
  const instruction = textOf(v.instruction, MAX_INSTRUCTION_CHARS)
  return instruction ? { instruction, what: textOf(v.what, 80) } : null
}

/**
 * The planner's answer (an object, or one JSON object in text, possibly in a
 * code fence), as a plan; null when it is not one. Steps it invents are
 * dropped, and the order is always the card order. An empty steps list is an
 * answer: the request asked for nothing this edit can do.
 */
export function parseModelPlan(answer: unknown): EditPlan | null {
  let raw = answer
  if (typeof answer === "string") {
    const json = /\{[\s\S]*\}/.exec(answer)?.[0]
    if (!json) return null
    try {
      raw = JSON.parse(json)
    } catch {
      return null
    }
  }
  const parsed = modelPlan.safeParse(raw)
  if (!parsed.success) return null
  const asked = new Set(parsed.data.steps.map((s) => s.trim().toLowerCase()))
  const steps = EDIT_STEPS.filter((step) => asked.has(step))
  if (asked.size > 0 && steps.length === 0) return null
  const listed = Array.isArray(parsed.data.cannot) ? parsed.data.cannot : []
  const cannot = [...new Set(listed.map((thing) => textOf(thing, MAX_CANNOT_CHARS)).filter((thing): thing is string => thing !== null))].slice(0, MAX_CANNOT)
  const look = typeof parsed.data.look === "string" && (LOOKS as readonly string[]).includes(parsed.data.look) ? (parsed.data.look as Look) : "warm"
  const clips = typeof parsed.data.clips === "number" && Number.isFinite(parsed.data.clips) ? Math.min(6, Math.max(1, Math.round(parsed.data.clips))) : 2
  const picture = steps.includes("picture") ? pictureOf(parsed.data.picture) : null
  return {
    // A picture change with nothing to change is no picture change.
    steps: picture || !steps.includes("picture") ? steps : steps.filter((s) => s !== "picture"),
    params: {
      musicStyle: steps.includes("music") ? textOf(parsed.data.musicStyle, MAX_STYLE_CHARS) ?? DEFAULT_MUSIC_STYLE : null,
      picture,
      look,
      clips,
      layout: typeof parsed.data.layout === "string" && (SPEAKER_LAYOUT_KINDS as readonly string[]).includes(parsed.data.layout) ? (parsed.data.layout as SpeakerLayoutKind) : "stacked",
    },
    reply: textOf(parsed.data.reply, MAX_REPLY_CHARS),
    cannot,
  }
}
