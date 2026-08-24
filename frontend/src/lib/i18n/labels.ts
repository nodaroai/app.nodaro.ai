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
