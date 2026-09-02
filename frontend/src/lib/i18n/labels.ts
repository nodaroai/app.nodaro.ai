// Node-header + handle-label localization.
//
// The canvas renders a node's *persisted* `data.label` (Title Case, e.g.
// "Generate Image"), which for default nodes equals the node definition's
// default label and which the user can rename. To flip EXISTING + new node
// headers to Hebrew while leaving user renames untouched, we translate by the
// English default-label STRING at render time: a label present in the map is
// swapped; anything else (a custom name) passes through verbatim.
//
// Handle pip labels ("Look", "Elements", picker pips like "Camera format")
// flow through one render path, so a second string-keyed map flips them all.
//
// Keyed by English string (not MessageKey) because that's what the render sites
// already hold. Missing keys degrade gracefully to English.
import { useCallback } from "react"
import { useLocaleStore } from "@/lib/locale-store"
import type { LocaleId } from "@nodaro/shared"
import { PRESET_CONTENT_HE, type PresetCopy } from "./preset-content.he"

const NODE_LABELS_HE: Record<string, string> = {
  "List": "רשימה",
  "Lip Sync": "סנכרון שפתיים",
  "Motion Transfer": "העברת תנועה",
  "Compose Video": "הרכבת וידאו",
  "After Effects": "אפקטים מיוחדים",
  "Lottie Overlay": "שכבת אנימציה",
  "3D Title": "כותרת תלת־ממד",
  "Motion Graphics": "גרפיקת תנועה",
  "Composite": "שילוב שכבות",
  "Render Video": "רינדור וידאו",
  "Sticky Note": "פתק",
  "AI Audit": "ביקורת AI",
  "Choose Best": "בחירת המיטב",
  "Face": "פנים",
  "Paint Mask": "ציור מסכה",
  "Slideshow": "מצגת",
  "Still to Video": "תמונה נייחת לווידאו",
  "Gif to Video": "GIF לווידאו",
  // Inputs
  "Text": "טקסט",
  "Upload Image": "העלאת תמונה",
  "Upload Video": "העלאת וידאו",
  "Upload Audio": "העלאת אודיו",
  "RSS Feed": "פיד RSS",
  "Video URL": "כתובת וידאו",
  "Web Scrape": "גריפת אתר",
  "Video Analysis": "ניתוח וידאו",
  "Reference Audio": "אודיו ייחוס",
  // Parameter pickers (Look / Camera / Subject)
  "Tone": "טון",
  "Style Guide": "מדריך סגנון",
  "Provider": "ספק",
  "Scene Count": "מספר סצנות",
  "Duration": "משך",
  "Aspect Ratio": "יחס גובה־רוחב",
  "Motion": "תנועה",
  "Camera Motion": "תנועת מצלמה",
  "Music Genre": "ז׳אנר מוזיקלי",
  "Music Mood": "מצב־רוח מוזיקלי",
  "Instrumentation": "כלי נגינה",
  "Voice Character": "אופי הקול",
  "Voice Delivery": "מסירת הקול",
  "Framing": "מסגור",
  "Lens": "עדשה",
  "Camera / Film Stock": "מצלמה / סרט צילום",
  "Lighting": "תאורה",
  "Color / Look": "צבע / מראה",
  "Atmosphere": "אווירה",
  "Action FX": "אפקטי פעולה",
  "Style": "סגנון",
  "Setting": "סביבה",
  "Loop Subject": "נושא לולאה",
  "Person": "דמות",
  "Mood": "מצב־רוח",
  "Photographer / Artist Style": "סגנון צלם / אמן",
  "Aesthetic / Microtrend": "אסתטיקה / מיקרו־טרנד",
  "Era / Period": "תקופה",
  "Pose": "תנוחה",
  "Styling": "סטיילינג",
  "Material": "חומר",
  "Animal": "חיה",
  "Vehicle": "רכב",
  "Weapon": "נשק",
  "Furniture": "רהיטים",
  "Photo Genre": "ז׳אנר צילום",
  "Backdrop": "רקע",
  "Held Prop": "אביזר יד",
  "Temporal": "זמן",
  "Exposure Settings": "הגדרות חשיפה",
  "Render Quality": "איכות עיבוד",
  "Composition Effects": "אפקטי קומפוזיציה",
  "Post-Process Effects": "אפקטי פוסט־עיבוד",
  "Transition": "מעבר",
  "Character FX": "אפקטי דמות",
  // AI generation
  "Generate Script": "יצירת תסריט",
  "Generate Image": "יצירת תמונה",
  "Modify Image": "עריכת תמונה",
  "Image to Image": "תמונה לתמונה",
  "Upscale Image": "הגדלת תמונה",
  "Remove Background": "הסרת רקע",
  "Generate Mask": "יצירת מסכה",
  "Image to Video": "תמונה לווידאו",
  "Video to Video": "וידאו לווידאו",
  "Relight & Switch": "תאורה מחדש והחלפה",
  "Text to Video": "טקסט לווידאו",
  "Generate Video": "יצירת וידאו",
  "Generate Video Pro": "יצירת וידאו Pro",
  "Edit Video Pro": "עריכת וידאו Pro",
  "Text to Speech": "טקסט לדיבור",
  "QA Check": "בדיקת איכות",
  "Image Critic": "מבקר תמונות",
  "Generate Music": "יצירת מוזיקה",
  "Text to Audio": "טקסט לאודיו",
  "Voice Extractor": "מחלץ קול",
  "Text to Dialogue": "טקסט לדיאלוג",
  "Voice Changer": "משנה קול",
  "Voice Changer Pro": "משנה קול Pro",
  "Dubbing": "דיבוב",
  "Voice Remix": "רמיקס קול",
  "Voice Design": "עיצוב קול",
  "Forced Alignment": "יישור מאולץ",
  "Suno Voice": "קול Suno",
  "Suno Generate": "יצירת Suno",
  "Suno Cover": "קאבר Suno",
  "Suno Extend": "הרחבת Suno",
  "Suno Lyrics": "מילים Suno",
  "Suno Separate": "הפרדת Suno",
  "Audio Separation": "הפרדת אודיו",
  "Music Video": "קליפ מוזיקלי",
  "Suno Mashup": "מאשאפ Suno",
  "Suno Replace Section": "החלפת מקטע Suno",
  "Suno Style Boost": "חיזוק סגנון Suno",
  "Suno Add Instrumental": "הוספת ליווי Suno",
  "Suno Add Vocals": "הוספת שירה Suno",
  "Suno Convert WAV": "המרת WAV ב-Suno",
  "Suno Upload Extend": "הרחבה מהעלאה ב-Suno",
  "Transcribe": "תמלול",
  "Describe Image": "תיאור תמונה",
  "Describe to Picker": "תיאור לבורר",
  "Generate Text": "יצירת טקסט",
  // Processing
  "Combine Videos": "שילוב סרטונים",
  "Assemble Narrated Video": "הרכבת וידאו מוקרן",
  "Image Collage": "קולאז׳ תמונות",
  "Merge Video & Audio": "מיזוג וידאו ואודיו",
  "Add Captions": "הוספת כתוביות",
  "Resize Video": "שינוי גודל וידאו",
  "Social Media Format": "פורמט לרשתות חברתיות",
  "Trim Audio": "קיצוץ אודיו",
  "Split into Chunks": "פיצול למקטעים",
  "Extract Audio": "חילוץ אודיו",
  "Remove Audio": "הסרת אודיו",
  "Mix Audio": "מיקס אודיו",
  "Combine Audio": "שילוב אודיו",
  "Adjust Volume": "כוונון עוצמה",
  "Audio FX": "אפקטי אודיו",
  "Trim Video": "קיצוץ וידאו",
  "Extract Frame": "חילוץ פריים",
  "Adjust Speed": "כוונון מהירות",
  "Loop Video": "לולאת וידאו",
  "Fade In/Out": "עמעום כניסה/יציאה",
  "Transcode Video": "המרת וידאו",
  "Manual Edit": "עריכה ידנית",
  "Extend Video": "הרחבת וידאו",
  "Retake Video": "צילום מחדש",
  "Face Swap": "החלפת פנים",
  "Video SFX": "אפקטי קול לווידאו",
  "Speech to Video": "דיבור לווידאו",
  "AI Avatar": "אווטאר AI",
  "Cinematic Avatar": "אווטאר קולנועי",
  "Upscale Video": "הגדלת וידאו",
  // Data / list
  "Combine Text": "שילוב טקסט",
  "Split Text": "פיצול טקסט",
  "Extract Field": "חילוץ שדה",
  "JSON Process": "עיבוד JSON",
  "Filter List": "סינון רשימה",
  "Remove Duplicates": "הסרת כפילויות",
  "Merge Lists": "מיזוג רשימות",
  "Sort List": "מיון רשימה",
  "Selector": "בורר",
  "Reference Sheet": "גיליון ייחוס",
  "Reference Board": "לוח ייחוס",
  // Output / assets / structure
  "Preview": "תצוגה מקדימה",
  "Save to Storage": "שמירה לאחסון",
  "Webhook Output": "פלט Webhook",
  "Character Asset": "נכס דמות",
  "Object/Props Asset": "נכס אובייקט/אביזר",
  "Animal/Creature Asset": "נכס חיה/יצור",
  "Location Asset": "נכס מיקום",
  "Scene": "סצנה",
  "Sub-Workflow Input": "קלט תת־תהליך",
  "Sub-Workflow Output": "פלט תת־תהליך",
  "Sub-Workflow": "תת־תהליך",
  "Component": "רכיב",
  "Webhook Trigger": "טריגר Webhook",
  "Schedule Trigger": "טריגר מתוזמן",
  "Instagram Post": "פוסט לאינסטגרם",
  "TikTok Post": "פוסט לטיקטוק",
  "YouTube Upload": "העלאה ליוטיוב",
  "LinkedIn Post": "פוסט ללינקדאין",
  "X Post": "פוסט ל-X",
  "Facebook Post": "פוסט לפייסבוק",
  "Telegram Post": "פוסט לטלגרם",
  "Publish to Social": "פרסום לרשתות",
  "Telegram Channel Feed": "פיד ערוץ טלגרם",
  "Telegram Trigger": "טריגר טלגרם",
  "Teleport Send": "שיגור טלפורט",
  "Teleport Receive": "קליטת טלפורט",
  "Router": "נתב",
  "Story → Video": "סיפור → וידאו",
  "Group": "קבוצה",
  "Collect": "איסוף",
}

const HANDLE_LABELS_HE: Record<string, string> = {
  "Analysis": "ניתוח",
  "Audio": "שמע",
  "Audio Refs": "ייחוסי שמע",
  "Clips": "קליפים",
  "End Frame": "פריים סיום",
  "End state": "מצב סיום",
  "Image Refs": "ייחוסי תמונה",
  "Items": "פריטים",
  "List": "רשימה",
  "Lists": "רשימות",
  "Lottie": "אנימציה",
  "Source": "מקור",
  "Start Frame": "פריים פתיחה",
  "Start state": "מצב פתיחה",
  "Subject": "נושא",
  "Target subject": "נושא היעד",
  "Text": "טקסט",
  "URL / Query": "כתובת / שאילתה",
  "Variables": "משתנים",
  "Video": "וידאו",
  "Video + Audio": "וידאו ושמע",
  "Video Refs": "ייחוסי וידאו",
  "Video or Audio": "וידאו או שמע",
  "Voices": "קולות",
  // Consumer input/output pips
  "Look": "מראה",
  "Elements": "אלמנטים",
  "Assets": "נכסים",
  "References": "הפניות",
  "Negative": "שלילי",
  "Prompt": "פרומפט",
  "Image": "תמונה",
  "Output": "פלט",
  "Character": "דמות",
  "Picker JSON": "JSON בורר",
  // Picker source pips (picker-handles.ts REGISTRY)
  "Lens": "עדשה",
  "Lighting": "תאורה",
  "Mood": "מצב־רוח",
  "Atmosphere": "אווירה",
  "Styling": "סטיילינג",
  "Pose": "תנוחה",
  "Framing": "מסגור",
  "Aesthetic": "אסתטיקה",
  "Era": "תקופה",
  "Photo genre": "ז׳אנר צילום",
  "Backdrop": "רקע",
  "Color look": "מראה צבע",
  "Photographer": "צלם",
  "Render quality": "איכות עיבוד",
  "Composition FX": "אפקטי קומפוזיציה",
  "Post-process FX": "אפקטי פוסט",
  "Exposure": "חשיפה",
  "Temporal": "זמן",
  "Style": "סגנון",
  "Camera format": "פורמט מצלמה",
  "Setting": "סביבה",
  "Action FX": "אפקטי פעולה",
  "Loop subject": "נושא לולאה",
  "Person": "דמות",
  "Animal": "חיה",
  "Vehicle": "רכב",
  "Weapon": "נשק",
  "Furniture": "רהיטים",
  "Held prop": "אביזר יד",
  "Material": "חומר",
  "Character FX": "אפקטי דמות",
  "Camera motion": "תנועת מצלמה",
  "Transition": "מעבר",
  "Music genre": "ז׳אנר מוזיקלי",
  "Music mood": "מצב־רוח מוזיקלי",
  "Instrumentation": "כלי נגינה",
  "Voice character": "אופי הקול",
  "Voice delivery": "מסירת הקול",
  "Tone": "טון",
  "Text prompt": "פרומפט טקסט",
}

const NODE_LABEL_MAPS: Partial<Record<LocaleId, Record<string, string>>> = { he: NODE_LABELS_HE }
const HANDLE_LABEL_MAPS: Partial<Record<LocaleId, Record<string, string>>> = { he: HANDLE_LABELS_HE }

/** Translate a node's display label for a locale; unknown/custom labels pass through. */
export function localizeNodeLabel(label: string, locale: LocaleId): string {
  return NODE_LABEL_MAPS[locale]?.[label] ?? label
}

/** Translate a handle pip label for a locale; unknown labels pass through. */
export function localizeHandleLabel(label: string, locale: LocaleId): string {
  return HANDLE_LABEL_MAPS[locale]?.[label] ?? label
}

/** Hook: returns a node-label localizer bound to the current locale.
 *  Stable across renders (memoized on locale) so callers can safely list it in
 *  effect/memo dependency arrays without re-running on every render. */
export function useLocalizeNodeLabel(): (label: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((label: string) => localizeNodeLabel(label, locale), [locale])
}

/** Hook: returns a handle-label localizer bound to the current locale. */
export function useLocalizeHandleLabel(): (label: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return (label: string) => localizeHandleLabel(label, locale)
}

/**
 * Factory-preset GROUP names (the folder/section headers in the node preset
 * dropdown). Keyed by the English catalog string that ships in
 * `@nodaro/prompts` factory-presets, same as the node/handle maps above — a
 * name with no entry passes through untranslated.
 */
const PRESET_GROUPS_HE: Record<string, string> = {
  "Accessibility & SEO": "נגישות וקידום",
  "Advertising & Hype": "פרסום והייפ",
  "Ambiences (loopable)": "אווירות (ניתנות ללולאה)",
  "Animation & Style": "הנפשה וסגנון",
  "Architecture & Interiors": "אדריכלות ופנים",
  "Assistants": "עוזרים",
  "B-Roll & Nature": "צילומי רקע וטבע",
  "Backgrounds": "רקעים",
  "Branding & Logos": "מיתוג ולוגואים",
  "By Format": "לפי פורמט",
  "By Genre": "לפי ז'אנר",
  "By Mood / Score": "לפי מצב רוח / פסקול",
  "By Use-Case": "לפי שימוש",
  "Camera Moves": "תנועות מצלמה",
  "Caption Styles": "סגנונות כתוביות",
  "Cast & Consistency": "שחקנים ועקביות",
  "Celebration & FX": "חגיגה ואפקטים",
  "Characters": "דמויות",
  "Cinematic & Specialty": "קולנועי ומיוחד",
  "Connected Graphic": "גרפיקה מחוברת",
  "Conversational & Calm": "שיחתי ורגוע",
  "Creative": "יצירתי",
  "Diagrams & Infographics": "תרשימים ואינפוגרפיקה",
  "Edit by Name": "עריכה לפי שם",
  "Edits": "עריכות",
  "Emphasis & UI": "הדגשה וממשק",
  "Extraction": "חילוץ",
  "Face Privacy": "פרטיות פנים",
  "FX Overlays": "שכבות אפקטים",
  "Film & Storyboard": "סרט וסטוריבורד",
  "Foley & Action": "אפקטי קול ופעולה",
  "Handmade & Stop-Motion": "עבודת יד וסטופ־מושן",
  "Icons, Game Assets & Textures": "אייקונים, נכסי משחק ומרקמים",
  "Illustration & Art Styles": "איור וסגנונות אמנות",
  "Intros & Logos": "פתיחים ולוגואים",
  "Joins & Transitions": "חיבורים ומעברים",
  "Long-Form & Narrative": "תוכן ארוך ונרטיב",
  "Looping & Backgrounds": "לולאות ורקעים",
  "Marketing & Social": "שיווק ורשתות",
  "Motion Graphics & Logo": "גרפיקת תנועה ולוגו",
  "Narration": "קריינות",
  "Narration & Character": "קריינות ודמות",
  "Photography & Cinematic": "צילום וקולנוע",
  "Portrait Transformations": "שינויי דיוקן",
  "Print & Posters": "דפוס ופוסטרים",
  "Product & Ads": "מוצר ופרסומות",
  "Product & Commerce": "מוצר ומסחר",
  "Professional & Assistant": "מקצועי ועוזר",
  "Reactions & Social": "תגובות ורשתות",
  "Reference Sheet": "גיליון ייחוס",
  "Relight & Composite": "תאורה מחדש והרכבה",
  "Restyle Looks": "עיצוב מראה מחדש",
  "Revoice Styles": "סגנונות החלפת קול",
  "Scene Recipes": "מתכוני סצנה",
  "Seedance Director": "בימוי Seedance",
  "Shot Types & Angles": "סוגי שוט וזוויות",
  "Social & CTA": "רשתות וקריאה לפעולה",
  "Social & Reels": "רשתות ורילס",
  "Structured Output": "פלט מובנה",
  "Stylized Subject": "נושא מסוגנן",
  "Titles & Text": "כותרות וטקסט",
  "Transitions & Impacts": "מעברים וחבטות",
  "UI & Icons": "ממשק ואייקונים",
  "UI & Stingers": "ממשק וסטינגרים",
  "Utility": "כלי עזר",
  "Viral & Effects": "ויראלי ואפקטים",
  "Vocals & Songs": "שירה ושירים",
  "Writing & Marketing": "כתיבה ושיווק",
}

const PRESET_GROUP_MAPS: Partial<Record<LocaleId, Record<string, string>>> = { he: PRESET_GROUPS_HE }

/** Translate a factory-preset group name; unknown names pass through. */
export function localizePresetGroup(name: string, locale: LocaleId): string {
  return PRESET_GROUP_MAPS[locale]?.[name] ?? name
}

/** Hook: returns a preset-group localizer bound to the current locale. */
export function useLocalizePresetGroup(): (name: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return (name: string) => localizePresetGroup(name, locale)
}

/**
 * Node-picker family / section headers (the sub-headers inside a tab, e.g.
 * "Camera" or "Light & Look" under the Video tab's Pickers section). Keyed
 * by the `label` field of `NODE_FAMILIES` and `COMMON_SECTIONS` in
 * `@/lib/node-families`. Same pass-through contract as the maps above.
 */
const NODE_GROUPS_HE: Record<string, string> = {
  // Synthetic section headers minted by node-picker-sections.ts /
  // picker-search-results.tsx rather than by a NODE_FAMILIES entry.
  "Popular": "פופולריים",
  "Other": "אחר",
  "Recent": "אחרונים",
  "Add Your Own": "העלאה משלכם",
  "Analyze": "ניתוח",
  "Animate & Perform": "הנפשה וביצוע",
  "Batch": "אצווה",
  "Build Once, Reuse": "בנו פעם, השתמשו שוב",
  "Camera": "מצלמה",
  "Canvas": "קנבס",
  "Characters": "דמויות",
  "Clean & Separate": "ניקוי והפרדה",
  "Continue & Restyle": "המשך ועיצוב מחדש",
  "Create": "יצירה",
  "Creatures": "יצורים",
  "Cut & Assemble": "חיתוך והרכבה",
  "Edit": "עריכה",
  "Edit & Retouch": "עריכה ושיפור",
  "Edit Audio": "עריכת אודיו",
  "Effects": "אפקטים",
  "Export": "ייצוא",
  "Finish": "סיום",
  "Format & Export": "פורמט וייצוא",
  "Generation Settings": "הגדרות יצירה",
  "Get Content": "קבלת תוכן",
  "Light & Look": "תאורה ומראה",
  "Lists & Batching": "רשימות ואצוות",
  "Logic & Data": "לוגיקה ונתונים",
  "Motion & Time": "תנועה וזמן",
  "Music": "מוזיקה",
  "Music & Voice": "מוזיקה וקול",
  "Objects": "אובייקטים",
  "One-Click": "בלחיצה אחת",
  "Places": "מקומות",
  "Platforms": "פלטפורמות",
  "References": "ייחוסים",
  "Scene": "סצנה",
  "Sound Effects": "אפקטי קול",
  "Sound for Video": "סאונד לווידאו",
  "Speech & Voiceover": "דיבור וקריינות",
  "Story & Script": "סיפור ותסריט",
  "Subject": "נושא",
  "Text": "טקסט",
  "Titles, Graphics & Captions": "כותרות, גרפיקה וכתוביות",
  "Transcribe": "תמלול",
  "Triggers": "טריגרים",
  "Understand": "הבנה",
  "Voices": "קולות",
  "Wardrobe & Pose": "לבוש ותנוחה",
  "Workflows": "תהליכי עבודה",
}

const NODE_GROUP_MAPS: Partial<Record<LocaleId, Record<string, string>>> = { he: NODE_GROUPS_HE }

/** Translate a node-toolbar group header; unknown names pass through. */
export function localizeNodeGroup(name: string, locale: LocaleId): string {
  return NODE_GROUP_MAPS[locale]?.[name] ?? name
}

/** Hook: returns a node-group localizer bound to the current locale. */
export function useLocalizeNodeGroup(): (name: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return (name: string) => localizeNodeGroup(name, locale)
}

/**
 * Model DESCRIPTIONS — the one-line marketing copy under a model's name in
 * every provider dropdown ("Higher detail, production images") and in the
 * hint below it. They ship as `desc:` strings in config-panels/model-options.ts
 * and in @nodaro/shared's LLM / voice-changer tables; render sites look them
 * up here by the English string. Model NAMES stay Latin. Unmapped copy passes
 * through in English (coverage test: model-descriptions-he.test.ts).
 */
const MODEL_DESCRIPTIONS_HE: Record<string, string> = {
  "1–9 reference images to video, 3–15s, per-second pricing": "1–9 תמונות ייחוס לווידאו, 3–15 שניות, תמחור לפי שנייה",
  "29 languages, natural delivery": "29 שפות, דיבור טבעי",
  "29 languages; preserves emotion, cadence & timing. Default — ElevenLabs recommends this even for English audio.": "29 שפות; משמר רגש, קצב ותזמון. ברירת מחדל — ElevenLabs ממליצה על זה גם לאודיו באנגלית.",
  "3–15s, 720p/1080p, 9 aspect ratios, per-second pricing": "3–15 שניות, 720p/1080p, 9 יחסי גובה־רוחב, תמחור לפי שנייה",
  "3–15s, 720p/1080p, image or text, per-second pricing": "3–15 שניות, 720p/1080p, תמונה או טקסט, תמחור לפי שנייה",
  "AI-guided image editing": "עריכת תמונות בהנחיית AI",
  "AI-powered image editing with instructions": "עריכת תמונות מבוססת AI לפי הוראות",
  "AI-powered upscaling and enhancement": "הגדלה ושיפור מבוססי AI",
  "Advanced motion control with prompts": "שליטה מתקדמת בתנועה באמצעות פרומפטים",
  "Advanced reasoning, large context": "חשיבה מתקדמת, הקשר גדול",
  "Advanced upscaling with configurable factor": "הגדלה מתקדמת עם פקטור מתכוונן",
  "Premium AI upscaling with a 1x / 2x / 4x factor": "הגדלת AI פרימיום בפקטור 1x / 2x / 4x",
  "Alibaba Wan 3.0, 2–30s, 480p/720p/1080p, native audio, image/video/audio refs": "Alibaba Wan 3.0, 2–30 שניות, 480p/720p/1080p, אודיו מובנה, ייחוסי תמונה/וידאו/אודיו",
  "Avatar-inference dubbing on a video. Dynamic duration, premium.": "דיבוב מבוסס אווטאר על סרטון. משך דינמי, פרימיום.",
  "BFL FLUX Fill Pro via Replicate — dedicated masked inpainting (white = edit area)": "BFL FLUX Fill Pro דרך Replicate — מילוי אזורים ייעודי לפי מסכה (לבן = אזור העריכה)",
  "BFL Flux 2 9B via Replicate — fast, no safety filter": "BFL Flux 2 9B דרך Replicate — מהיר, ללא פילטר בטיחות",
  "BFL Flux 2 Max via Replicate — even larger sibling, up to 8 refs, safety_tolerance=5 (variable pricing: 2-62 cr)": "BFL Flux 2 Max דרך Replicate — גרסה גדולה עוד יותר, עד 8 ייחוסים, safety_tolerance=5 (תמחור משתנה: 2–62 cr)",
  "BFL Flux 2 Max via Replicate — up to 8 refs, safety_tolerance=5 (variable pricing: 2-62 cr)": "BFL Flux 2 Max דרך Replicate — עד 8 ייחוסים, safety_tolerance=5 (תמחור משתנה: 2–62 cr)",
  "BFL Flux 2 Pro via Replicate — flagship quality, safety_tolerance=5": "BFL Flux 2 Pro דרך Replicate — איכות דגל, safety_tolerance=5",
  "BFL Flux 2 Pro via Replicate — flagship quality, safety_tolerance=5 (max for Pro)": "BFL Flux 2 Pro דרך Replicate — איכות דגל, safety_tolerance=5 (המקסימום ל-Pro)",
  "Balanced GPT-5.6 for production work": "GPT-5.6 מאוזן לעבודת פרודקשן",
  "Balanced quality and speed": "איזון בין איכות למהירות",
  "Budget Hailuo, 6-10s": "Hailuo חסכוני, 6–10 שניות",
  "Built-in face enhancement, clean output": "שיפור פנים מובנה, פלט נקי",
  "Bytedance Fast, 4-15s, multimodal references": "Bytedance Fast, 4–15 שניות, ייחוסים מולטימודליים",
  "Bytedance budget, 4-15s, 480p/720p": "Bytedance חסכוני, 4–15 שניות, 480p/720p",
  "Bytedance latest, up to 30s in one shot, wide multimodal refs, 480p/720p/1080p": "Bytedance העדכני ביותר, עד 30 שניות ברצף אחד, מגוון רחב של ייחוסים מולטימודליים, 480p/720p/1080p",
  "Bytedance, 4-12s with audio option": "Bytedance, 4–12 שניות עם אפשרות אודיו",
  "Bytedance, 4-12s, audio generation": "Bytedance, 4–12 שניות, יצירת אודיו",
  "Bytedance, 4-15s, multimodal references": "Bytedance, 4–15 שניות, ייחוסים מולטימודליים",
  "Change aspect ratio intelligently": "שינוי חכם של יחס גובה־רוחב",
  "Cheapest VEO tier, 4/6/8s with audio": "דרגת VEO הזולה ביותר, 4/6/8 שניות עם אודיו",
  "Context-aware editing via Kontext": "עריכה מודעת־הקשר באמצעות Kontext",
  "Context-aware generation and editing": "יצירה ועריכה מודעות־הקשר",
  "Context-aware image editing with prompt": "עריכת תמונות מודעת־הקשר עם פרומפט",
  "Creative and stylized imagery": "תמונות יצירתיות ומסוגננות",
  "Creative, stylized motion": "תנועה יצירתית ומסוגננת",
  "Custom models tailored to unique taste": "מודלים מותאמים אישית לטעם ייחודי",
  "Diffusion-based, best for singing": "מבוסס דיפוזיה, המתאים ביותר לשירה",
  "English-optimized speech-to-speech.": "המרת דיבור לדיבור ממוטבת לאנגלית.",
  "Extended duration support": "תמיכה במשך מוארך",
  "Fast 1K edits, up to 10 reference images": "עריכות 1K מהירות, עד 10 תמונות ייחוס",
  "Fast Imagen, lower latency": "Imagen מהיר, השהיה נמוכה יותר",
  "Fast V2V with audio & multi-shot": "V2V מהיר עם אודיו וריבוי שוטים",
  "Fast VEO, 4/6/8s with audio": "VEO מהיר, 4/6/8 שניות עם אודיו",
  "Fast Wan, 5s clips": "Wan מהיר, קליפים של 5 שניות",
  "Fast and cheap, good for simple tasks": "מהיר וזול, מתאים למשימות פשוטות",
  "Fast drafts, iteration, storyboards": "טיוטות מהירות, איטרציות, סטוריבורדים",
  "Fast economy, good reasoning": "חסכוני ומהיר, חשיבה טובה",
  "Fast generation, 32 languages": "יצירה מהירה, 32 שפות",
  "Fast generation, 5-10s": "יצירה מהירה, 5–10 שניות",
  "Fast generation, 5s clips": "יצירה מהירה, קליפים של 5 שניות",
  "Fast generation, end frame support": "יצירה מהירה, תמיכה בפריים סיום",
  "Fast iteration, quick transforms": "איטרציה מהירה, טרנספורמציות זריזות",
  "Fast pro generation": "יצירה מהירה באיכות מקצועית",
  "Fast text-to-image, affordable": "טקסט לתמונה מהיר, במחיר נוח",
  "Fast, 5-10s": "מהיר, 5–10 שניות",
  "Fast, high-quality upscaling": "הגדלה מהירה ואיכותית",
  "Fast, lightweight generation": "יצירה מהירה וקלילה",
  "Fast, low-cost 1K drafts and iteration": "טיוטות 1K מהירות וזולות לאיטרציה",
  "Fast, reliable 5s clips": "קליפים של 5 שניות, מהירים ואמינים",
  "Fastest GPT-5.6, high-volume workloads": "ה-GPT-5.6 המהיר ביותר, לעומסי עבודה גדולים",
  "Fastest and cheapest, image or video input": "המהיר והזול ביותר, קלט תמונה או וידאו",
  "Flagship GPT-5.6, deepest reasoning": "GPT-5.6 הדגל, החשיבה העמוקה ביותר",
  "Flagship Seedream, best instruction following": "Seedream הדגל, הציות הטוב ביותר להוראות",
  "Flexible Flux, fast generation": "Flux גמיש, יצירה מהירה",
  "Frontier Claude above Opus, hardest problems": "Claude מהדור המתקדם ביותר, מעל Opus, לבעיות הקשות ביותר",
  "Full instrument + vocal generation": "יצירה מלאה של כלי נגינה ושירה",
  "Google's latest, strong prompt adherence": "העדכני של Google, היצמדות חזקה לפרומפט",
  "Google, 4–10s, 720p/1080p/4K, native audio, refs + video-edit": "Google, 4–10 שניות, 720p/1080p/4K, אודיו מובנה, ייחוסים + עריכת וידאו",
  "Guided video editing with reference image support": "עריכת וידאו מונחית עם תמיכה בתמונות ייחוס",
  "Hailuo 02, end frame support": "Hailuo 02, תמיכה בפריים סיום",
  "High quality video-to-video": "וידאו לווידאו באיכות גבוהה",
  "High quality, 5-10s": "איכות גבוהה, 5–10 שניות",
  "High quality, 5-15s, 1080p": "איכות גבוהה, 5–15 שניות, 1080p",
  "High-speed Wan 3.0, 2–30s, 480p/720p/1080p, native audio, image/video/audio refs": "Wan 3.0 במהירות גבוהה, 2–30 שניות, 480p/720p/1080p, אודיו מובנה, ייחוסי תמונה/וידאו/אודיו",
  "Higher detail, production images": "יותר פרטים, תמונות לפרודקשן",
  "Higher detail, production-ready images": "יותר פרטים, תמונות מוכנות לפרודקשן",
  "Higher quality Bytedance": "Bytedance באיכות גבוהה יותר",
  "Higher quality T2I, 1K/2K/4K": "T2I באיכות גבוהה יותר, 1K/2K/4K",
  "Highest quality Google image gen": "יצירת התמונות האיכותית ביותר של Google",
  "Highest quality Kontext editing": "עריכת Kontext באיכות הגבוהה ביותר",
  "Highest quality Kontext generation": "יצירת Kontext באיכות הגבוהה ביותר",
  "Improved quality and coherence": "איכות וקוהרנטיות משופרות",
  "KIE flexible resolution, 480p\u2013720p": "KIE ברזולוציה גמישה, 480p–720p",
  "Kling V2.1 Master, high quality": "Kling V2.1 Master, איכות גבוהה",
  "Latest GPT Image, sharper text + photorealism, up to 4K": "GPT Image העדכני, טקסט חד יותר + פוטוריאליזם, עד 4K",
  "Latest GPT, premium quality": "GPT העדכני, איכות פרימיום",
  "Latest Grok — expressive, high-contrast imagery": "Grok העדכני — תמונות אקספרסיביות בניגודיות גבוהה",
  "Latest Hailuo, 6-10s pro quality": "Hailuo העדכני, 6–10 שניות באיכות מקצועית",
  "Latest Hailuo, 6-10s standard": "Hailuo העדכני, 6–10 שניות באיכות סטנדרטית",
  "Latest Kling, 3-15s variable duration": "Kling העדכני, משך משתנה של 3–15 שניות",
  "Latest Opus, deepest agentic reasoning": "Opus העדכני, החשיבה העמוקה ביותר לעבודת סוכנים",
  "Latest Seedream image-to-image": "Seedream העדכני, תמונה לתמונה",
  "Latest Seedream, fast and sharp": "Seedream העדכני, מהיר וחד",
  "Latest fast Gemini, sharper reasoning": "Gemini המהיר העדכני, חשיבה חדה יותר",
  "Latest, supports audio tags for emotions": "העדכני ביותר, תומך בתגיות אודיו לרגשות",
  "Light, fast, end frame support": "קליל, מהיר, תמיכה בפריים סיום",
  "Lightricks LTX 2.3 Fast — text/image→video, durations up to 20s": "Lightricks LTX 2.3 Fast — מטקסט/תמונה לווידאו, משך עד 20 שניות",
  "Lightricks LTX 2.3 Pro — text/image/audio→video, up to 4K": "Lightricks LTX 2.3 Pro — מטקסט/תמונה/אודיו לווידאו, עד 4K",
  "Luma video modification": "שינוי וידאו עם Luma",
  "MiniMax premium, 4-15s, 2K or 768P, multimodal references, native audio": "MiniMax פרימיום, 4–15 שניות, 2K או 768P, ייחוסים מולטימודליים, אודיו מובנה",
  "Move subjects within scene": "הזזת נושאים בתוך הסצנה",
  "Multi-image Flux Kontext via Replicate — up to 4 refs, no safety filter": "Flux Kontext לריבוי תמונות דרך Replicate — עד 4 ייחוסים, ללא פילטר בטיחות",
  "Native phoneme lip sync, 8+ languages, cinematic. Premium quality.": "סנכרון שפתיים פונמי מובנה, 8+ שפות, קולנועי. איכות פרימיום.",
  "Near-Opus quality at Sonnet cost": "איכות קרובה ל-Opus בעלות של Sonnet",
  "Newest fast Gemini, agentic-tuned": "Gemini המהיר החדש ביותר, מכוונן לעבודת סוכנים",
  "Older Opus, complex tasks": "Opus מדור קודם, למשימות מורכבות",
  "Photorealistic image editing": "עריכת תמונות פוטוריאליסטית",
  "Photorealistic, high detail": "פוטוריאליסטי, ברמת פירוט גבוהה",
  "Photorealistic, highest quality output": "פוטוריאליסטי, פלט באיכות הגבוהה ביותר",
  "Premium quality image transforms": "טרנספורמציות תמונה באיכות פרימיום",
  "Premium talking head, 1080p": "ראש מדבר פרימיום, 1080p",
  "Previous flagship GPT, deep reasoning": "GPT הדגל הקודם, חשיבה עמוקה",
  "Previous-gen Opus, long-horizon work": "Opus מהדור הקודם, לעבודה ארוכת טווח",
  "Pro Seedream image-to-image, multi-reference edits": "Seedream Pro, תמונה לתמונה, עריכות מרובות ייחוסים",
  "Prompt-directed talking avatar, 720p\u20131080p, premium": "אווטאר מדבר בהכוונת פרומפט, 720p–1080p, פרימיום",
  "Remove background, transparent PNG output": "הסרת רקע, פלט PNG שקוף",
  "Replace subjects with motion": "החלפת נושאים תוך שמירה על התנועה",
  "Restyle with character consistency": "שינוי סגנון עם עקביות דמות",
  "Runway AI video-to-video conversion": "המרת וידאו לווידאו עם Runway AI",
  "Runway Gen-3, 5-10s, 720p/1080p": "Runway Gen-3, 5–10 שניות, 720p/1080p",
  "Same lip sync, budget tier, 480p/720p": "אותו סנכרון שפתיים, דרגה חסכונית, 480p/720p",
  "Same lip sync, cheaper / quicker tier": "אותו סנכרון שפתיים, דרגה זולה ומהירה יותר",
  "Same lip sync, latest generation, up to 30s, 480p/720p/1080p": "אותו סנכרון שפתיים, הדור החדש, עד 30 שניות, 480p/720p/1080p",
  "Sharper text + photorealism, up to 4K": "טקסט חד יותר + פוטוריאליזם, עד 4K",
  "Stable, proven music generation": "יצירת מוזיקה יציבה ומוכחת",
  "Standard motion transfer": "העברת תנועה סטנדרטית",
  "Strong general purpose": "חזק לשימוש כללי",
  "Studio-grade sync.so lip sync. Video input, expressive.": "סנכרון שפתיים של sync.so ברמת סטודיו. קלט וידאו, אקספרסיבי.",
  "Style-faithful transformations": "טרנספורמציות נאמנות לסגנון",
  "Superior musical expression, faster generation": "הבעה מוזיקלית מעולה, יצירה מהירה יותר",
  "T2I, 1K/2K/4K, up to 9 ref images": "T2I, 1K/2K/4K, עד 9 תמונות ייחוס",
  "Talking avatar from single image": "אווטאר מדבר מתמונה אחת",
  "Talking head, 720p, speech-optimized": "ראש מדבר, 720p, ממוטב לדיבור",
  "Targeted image editing": "עריכת תמונות ממוקדת",
  "Text rendering, complex compositions": "רינדור טקסט, קומפוזיציות מורכבות",
  "Top quality, 4/6/8s with audio": "איכות מובילה, 4/6/8 שניות עם אודיו",
  "Updated Nano Banana with web grounding": "Nano Banana מעודכן עם ביסוס מהרשת",
  "Updated Nano Banana — web-grounded transforms, up to 4K": "Nano Banana מעודכן — טרנספורמציות עם ביסוס מהרשת, עד 4K",
  "Versatile image transformation": "טרנספורמציית תמונות רב־תכליתית",
  "Versatile, 5-10s clips": "רב־תכליתי, קליפים של 5–10 שניות",
  "Versatile, good at diverse styles": "רב־תכליתי, מצטיין במגוון סגנונות",
  "Video-to-video AI dubbing. Multi-speaker (basic mode). Cheapest modern dubbing, billed per second.": "דיבוב AI מווידאו לווידאו. ריבוי דוברים (מצב בסיסי). הדיבוב המודרני הזול ביותר, חיוב לפי שנייה.",
  "Video-to-video editing, up to 60s input": "עריכת וידאו לווידאו, קלט עד 60 שניות",
  "Wan 2.7 I2V, 2–15s, 720p/1080p, start+end frame": "Wan 2.7 I2V, 2–15 שניות, 720p/1080p, פריים פתיחה וסיום",
  "Wan 2.7 T2V, 2–15s, 720p/1080p": "Wan 2.7 T2V, 2–15 שניות, 720p/1080p",
  "Wan I2V, 5-15s, resolution options": "Wan I2V, 5–15 שניות, אפשרויות רזולוציה",
  "fal.ai sync.so v3 dubbing. Video input, billed per second.": "דיבוב fal.ai sync.so v3. קלט וידאו, חיוב לפי שנייה.",
  "xAI Grok, 1–15s, 480p/720p (image required)": "xAI Grok, 1–15 שניות, 480p/720p (נדרשת תמונה)",
  "xAI Grok, 1–15s, 480p/720p, per-second pricing": "xAI Grok, 1–15 שניות, 480p/720p, תמחור לפי שנייה",
  "xAI flagship, strong reasoning": "הדגל של xAI, חשיבה חזקה",
}

const MODEL_DESCRIPTION_MAPS: Partial<Record<LocaleId, Record<string, string>>> = { he: MODEL_DESCRIPTIONS_HE }

/** Translate a model description for a locale; unknown copy passes through. */
export function localizeModelDescription(desc: string, locale: LocaleId): string {
  return MODEL_DESCRIPTION_MAPS[locale]?.[desc] ?? desc
}

/** Hook: model-description localizer bound to the current locale. */
export function useLocalizeModelDescription(): (desc: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((desc: string) => localizeModelDescription(desc, locale), [locale])
}

/**
 * Dropdown OPTION labels — data, not chrome: aspect ratios ("16:9
 * (Landscape)"), resolutions ("2K (Standard)"), sources ("From image").
 * They ship as `label:` strings in option tables (config-panels/
 * model-options.ts and @nodaro/shared). Two maps: whole labels, and the
 * parenthetical qualifier alone, so "16:9 (Landscape)" keeps its token and
 * translates the word. Brand names and bare tokens pass through.
 */
const OPTION_LABELS_HE: Record<string, string> = {
  "From image": "מתמונה",
  "Catalog avatar": "אווטאר מהקטלוג",
  "Text (TTS)": "טקסט (דיבור)",
  "Wired Audio": "אודיו מחובר",
  // Bare option words and the catalog's decorated quality tiers
  // (@nodaro/shared model-catalog `labels`): whole-label entries so the
  // token half is translated too, not only the qualifier.
  "Auto": "אוטומטי",
  "Adaptive": "אדפטיבי",
  "Balanced": "מאוזן",
  "Basic (2K)": "בסיסי (2K)",
  "Medium (Balanced)": "בינוני (מאוזן)",
  "High (Detailed)": "גבוה (מפורט)",
  "Turbo (fast)": "טורבו (מהיר)",
  "Quality (best)": "איכות (הטוב ביותר)",
}
const OPTION_QUALIFIERS_HE: Record<string, string> = {
  "Landscape": "לרוחב",
  "Portrait": "לאורך",
  "Square": "ריבוע",
  "Wide": "רחב",
  "Tall": "גבוה",
  "Ultra-wide": "אולטרה-רחב",
  "Tall ultra-wide": "אולטרה-רחב לאורך",
  "Cinema": "קולנועי",
  "Photo": "צילום",
  "Standard": "רגיל",
  "Social": "רשתות חברתיות",
  "High": "גבוה",
  "Ultra": "אולטרה",
  "Detailed": "מפורט",
  "Default": "ברירת מחדל",
  "Auto": "אוטומטי",
  "Fast": "מהיר",
  "Best": "הטוב ביותר",
  "Quality": "איכות",
  "Balanced": "מאוזן",
}
const OPTION_LABEL_MAPS: Partial<Record<LocaleId, { whole: Record<string, string>; qualifier: Record<string, string> }>> = {
  he: { whole: OPTION_LABELS_HE, qualifier: OPTION_QUALIFIERS_HE },
}

/** Translate a dropdown option label for a locale; unknown copy passes through. */
export function localizeOptionLabel(label: string, locale: LocaleId): string {
  const maps = OPTION_LABEL_MAPS[locale]
  if (!maps) return label
  const whole = maps.whole[label]
  if (whole) return whole
  // "<token> (<Qualifier>)" — translate the qualifier, keep the token.
  const m = /^(.*?)\s*\(([^()]+)\)$/.exec(label)
  if (m) {
    // Case-insensitive on the qualifier: the catalog writes "(fast)",
    // "(best)" and "(default)" in lower case next to "(Fast)" elsewhere.
    const raw = m[2]
    const q = maps.qualifier[raw] ?? maps.qualifier[raw.charAt(0).toUpperCase() + raw.slice(1)]
    if (q) return `${m[1]} (${q})`
  }
  return label
}

/**
 * Guard helper: is this English string a KEY of one of the label tables
 * above (a node/handle name, a model description, a dropdown option)? Such a
 * string in a data module is localized at render time by the matching hook,
 * so a raw-English source scan must not count it as a leak.
 */
export function isLocalizedTableKey(s: string): boolean {
  return (
    s in NODE_LABELS_HE ||
    s in HANDLE_LABELS_HE ||
    s in MODEL_DESCRIPTIONS_HE ||
    s in OPTION_LABELS_HE ||
    localizeOptionLabel(s, "he") !== s
  )
}

/** Hook: option-label localizer bound to the current locale. */
export function useLocalizeOptionLabel(): (label: string) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((label: string) => localizeOptionLabel(label, locale), [locale])
}

/**
 * Factory-preset display copy (name + description), keyed by preset id.
 * Partial per locale — a preset with no entry falls back to the catalog's
 * English, so upstream additions never render blank.
 */
const PRESET_CONTENT_MAPS: Partial<Record<LocaleId, Record<string, PresetCopy>>> = { he: PRESET_CONTENT_HE }

/** Hook: returns a preset-copy resolver bound to the current locale.
 *  Stable across renders (memoized on locale) so callers can list it in
 *  effect/memo dependency arrays without re-running on every render. */
export function useLocalizePresetCopy(): (id: string, name: string, description?: string) => PresetCopy {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((id: string, name: string, description?: string) => {
    const hit = PRESET_CONTENT_MAPS[locale]?.[id]
    return {
      name: hit?.name ?? name,
      description: hit?.description ?? description,
    }
  }, [locale])
}
