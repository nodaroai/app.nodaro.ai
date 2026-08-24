/**
 * Hebrew names + descriptions for the FACTORY preset catalog, keyed by preset
 * id (`<nodeType>/<slug>`).
 *
 * Keyed by ID rather than by English string because preset names repeat across
 * node types ("Cinematic", "Podcast", …) and IDs are the stable identity that
 * user favourites are already stored against.
 *
 * Partial by design: a preset with no entry here renders its English name, so
 * adding presets upstream never breaks the UI — it just shows through
 * untranslated until translated. Same pass-through contract as the node,
 * handle and preset-group maps in `labels.ts`.
 *
 * The catalog itself (`FACTORY_PRESETS` in `@nodaro/prompts`) is the source
 * of truth for ids, English copy, and grouping; this file only carries the
 * Hebrew display copy alongside it.
 */

export interface PresetCopy {
  readonly name: string
  readonly description?: string
}

export const PRESET_CONTENT_HE: Record<string, PresetCopy> = {
  // ── Reference Sheet ──
  "generate-image/character-board": { name: "לוח דמות", description: "חברו תמונה חדה ומוארת ← גיליון דמות צפוף; השתמשו בו כייחוס לצילומים עקביים." },
  "generate-image/pose-board": { name: "לוח תנוחות", description: "חברו תמונה חדה ← גיליון תנוחות והבעות מוכן להנפשה; ייחוס לפעולה עקבית." },
  "generate-image/location-board": { name: "לוח מיקום", description: "חברו תמונה ← גיליון מיקום צפוף; ייחוס לסצנות עקביות." },
  "generate-image/product-board": { name: "לוח מוצר", description: "חברו תמונה ← גיליון מוצר צפוף; ייחוס לצילומים עקביים." },
  "generate-image/outfit-board": { name: "לוח לבוש", description: "חברו תמונה ← גיליון מלתחה צפוף; ייחוס למראה עקבי." },
  "generate-image/scene-board": { name: "לוח סצנה", description: "חברו תמונה ← מחקר עיצוב במה ואביזרים; ייחוס לסטים עקביים." },
  "generate-image/creature-board": { name: "לוח יצור", description: "חברו תמונה חדה ← גיליון יצור צפוף; ייחוס לצילומים עקביים." },
  "generate-image/vehicle-board": { name: "לוח רכב", description: "חברו תמונה ← גיליון רכב צפוף; ייחוס לצילומים עקביים." },
  "generate-image/food-board": { name: "לוח מאכל", description: "חברו תמונה ← גיליון מנה צפוף; ייחוס לצילומי אוכל עקביים." },
  "generate-image/mascot-board": { name: "לוח קמע", description: "חברו תמונת קמע ← גיליון דמות מותג עם יישומים; ייחוס לקמע עקבי." },
  "generate-image/pet-board": { name: "לוח חיית מחמד", description: "חברו תמונה חדה ← גיליון חיית מחמד צפוף; ייחוס לצילומים עקביים." },

  // ── Cast & Consistency ──
  "generate-image/character-reference-grid": { name: "רשת ייחוס לדמות", description: "חברו תמונה ← רשת זהות נקייה מ־4 זוויות (ללא קישוטים) — עוגן העקביות החזק ביותר." },
  "generate-image/cast-mega-grid": { name: "רשת שחקנים מלאה", description: "חברו 2–4 ייחוסי דמות ← גיליון שחקנים מתויג; אחר כך אזכרו אותם בשם בסצנות." },
  "generate-image/cast-scene": { name: "סצנת שחקנים (לפי שם)", description: "חברו רשת שחקנים ← ביימו סצנה תוך אזכור השמות; בלי לתאר מחדש את המראה." },

  // ── Edit by Name ──
  "generate-image/label-elements": { name: "תיוג רכיבים", description: "שלב 1 · חברו תמונה ← אותה תמונה עם מספר על כל רכיב שניתן לשנות." },
  "generate-image/edit-by-name": { name: "עריכה לפי שם", description: "שלב 2 · חברו את הגיליון המתויג ← ערכו רכיבים לפי שם; התוויות מוסרות מהתוצאה." },

  // ── Photography & Cinematic ──
  "generate-image/cinematic-portrait": { name: "דיוקן קולנועי", description: "מראה דיוקן אפלולי עם עומק שדה רדוד." },
  "generate-image/cinematic-still": { name: "פריים קולנועי", description: "סצנה באיכות סרט, תאורה דרמטית." },
  "generate-image/cinematic-widescreen": { name: "מסך רחב קולנועי (21:9)", description: "פריים אנמורפי אפי 2.39:1." },
  "generate-image/studio-portrait": { name: "דיוקן סטודיו", description: "תקריב סטודיו ב־85 מ״מ בתאורה רכה." },
  "generate-image/corporate-headshot": { name: "תמונת פרופיל עסקית", description: "תקריב מקצועי ונקי." },
  "generate-image/golden-hour-portrait": { name: "דיוקן בשעת הזהב", description: "דיוקן חוץ באור אחורי חמים." },
  "generate-image/bw-portrait": { name: "דיוקן שחור־לבן", description: "מונוכרום עריכתי בניגודיות גבוהה." },
  "generate-image/macro-shot": { name: "תקריב מאקרו", description: "פירוט קיצוני, מיקוד מוערם." },
  "generate-image/food-photography": { name: "צילום אוכל", description: "צילום מפתה בזווית 45°." },
  "generate-image/food-flatlay": { name: "אוכל מלמעלה", description: "מערך אוכל מסוגנן במבט־על." },
  "generate-image/aerial-drone": { name: "צילום אווירי / רחפן", description: "צילום אווירי מלמעלה בשעת הזהב." },
  "generate-image/landscape-vista": { name: "נוף פנורמי (21:9)", description: "נוף דרמטי ורחב במיוחד." },

  // ── Characters ──
  "generate-image/character-turnaround": { name: "גיליון דמות · סבב (3 מבטים)", description: "חזית / צד / גב, בתנוחת T." },
  "generate-image/character-action-4": { name: "גיליון דמות · תנוחות פעולה ×4", description: "ארבע תנוחות גוף מלא דינמיות." },
  "generate-image/character-expressions-6": { name: "גיליון דמות · הבעות ×6", description: "6 רגשות, שתי שורות של שלוש." },
  "generate-image/character-expressions-16": { name: "גיליון דמות · רשת הבעות ×16", description: "רשת רגשות 4×4, פנים אחד." },
  "generate-image/character-outfits": { name: "גיליון דמות · וריאציות לבוש", description: "אותה דמות, 4 מערכות לבוש." },
  "generate-image/character-turnaround-labeled": { name: "גיליון דמות · עם תוויות", description: "סבב + תוויות + טבלת גובה." },
  "generate-image/character-chibi": { name: "גיליון דמות · צ׳יבי", description: "תנוחות מוקטנות וחמודות." },
  "generate-image/character-portrait": { name: "דיוקן דמות", description: "דיוקן ראשי אחד ומלא הבעה." },
  "generate-image/character-fullbody-hero": { name: "דמות בגוף מלא", description: "צילום גוף מלא דינמי." },
  "generate-image/creature-design": { name: "גיליון עיצוב יצור", description: "יצור קונספט, ריבוי זוויות." },
  "generate-image/avatar-pfp": { name: "אווטאר / תמונת פרופיל", description: "ממורכז, בולט, רקע נקי." },

  // ── Product & Commerce ──
  "generate-image/product-shot": { name: "צילום מוצר (רקע לבן)", description: "צילום מוצר נקי למסחר על רקע לבן." },
  "generate-image/product-lifestyle": { name: "מוצר בשימוש", description: "מוצר בפעולה, סגנון עריכתי." },
  "generate-image/product-flatlay": { name: "מוצר מלמעלה", description: "סידור מסוגנן במבט־על." },
  "generate-image/packaging-mockup": { name: "הדמיית אריזה", description: "רינדור קופסה / בקבוק / שקית." },
  "generate-image/device-mockup": { name: "הדמיית מכשיר / מסך", description: "טלפון או מחשב נייד מציגים מסך." },
  "generate-image/beauty-hero": { name: "מוצר טיפוח – צילום ראשי", description: "צילום ראשי יוקרתי למוצר טיפוח." },

  // ── Branding & Logos ──
  "generate-image/logo-wordmark": { name: "לוגו · שם מותג", description: "שם מותג טיפוגרפי נקי." },
  "generate-image/logo-emblem": { name: "לוגו · סמל / תג", description: "סמל בתוך תג עגול." },
  "generate-image/logo-mascot": { name: "לוגו · קמע", description: "לוגו עם דמות קמע ידידותית." },
  "generate-image/app-icon": { name: "אייקון אפליקציה", description: "סמל בריבוע מעוגל." },
  "generate-image/monogram": { name: "מונוגרמה", description: "סימן ראשי תיבות אלגנטי." },

  // ── Marketing & Social ──
  "generate-image/youtube-thumbnail": { name: "תמונה ממוזערת ליוטיוב", description: "בולט, חד, טקסט גדול." },
  "generate-image/instagram-post": { name: "פוסט לאינסטגרם (1:1)", description: "גרפיקה חברתית ריבועית ממותגת." },
  "generate-image/story-vertical": { name: "סטורי / ריל (9:16)", description: "פרומו אנכי במסך מלא." },
  "generate-image/ad-creative": { name: "קריאייטיב לפרסומת", description: "כותרת + ויזואל ראשי, מקום לקריאה לפעולה." },
  "generate-image/quote-card": { name: "כרטיס ציטוט", description: "גרפיקת ציטוט טיפוגרפית." },
  "generate-image/web-banner": { name: "באנר / כותרת לאתר", description: "כותרת אתר רחבה עם טקסט." },

  // ── Print & Posters ──
  "generate-image/movie-poster": { name: "פוסטר סרט", description: "אמנות מפתח קולנועית, כותרת וסלוגן." },
  "generate-image/event-poster": { name: "פוסטר אירוע", description: "פלייר אירוע גרפי ובולט." },
  "generate-image/book-cover": { name: "כריכת ספר", description: "כריכה לפי ז'אנר, כותרת ומחבר." },
  "generate-image/tshirt-design": { name: "עיצוב לחולצה / הדפסה", description: "גרפיקה מבודדת מוכנה להדפסה." },
  "generate-image/sticker-diecut": { name: "מדבקה בחיתוך מדויק", description: "מדבקה מבריקה עם מסגרת לבנה." },
  "generate-image/album-cover": { name: "עטיפת אלבום", description: "אמנות עטיפה ריבועית מוכוונת אווירה." },

  // ── Illustration & Art Styles ──
  "generate-image/anime-scene": { name: "סצנת אנימה", description: "מראה אנימה בהצללת סלים." },
  "generate-image/comic-panel": { name: "פאנל קומיקס", description: "פאנל בדיו עם פעולה." },
  "generate-image/manga-bw": { name: "פאנל מנגה (שחור־לבן)", description: "שחור־לבן עם רשתות גוון." },
  "generate-image/watercolor": { name: "צבעי מים", description: "שכבות שקופות ורכות." },
  "generate-image/oil-painting": { name: "ציור שמן", description: "משיחות מכחול קלאסיות על בד." },
  "generate-image/flat-vector-illustration": { name: "איור וקטורי שטוח", description: "אמנות שטוחה מודרנית בסגנון תוכנה." },
  "generate-image/isometric-illustration": { name: "איור איזומטרי", description: "סצנה אקסונומטרית ב־3/4." },
  "generate-image/pixel-art": { name: "סצנת פיקסל ארט", description: "רשת פיקסלים רטרו ברזולוציה נמוכה." },
  "generate-image/pixar-3d": { name: "אנימציית תלת־ממד", description: "מראה דמות ממוחשבת ומלוטשת." },
  "generate-image/line-art-coloring": { name: "דף צביעה (קווי מתאר)", description: "קווי מתאר נקיים בשחור־לבן, ללא הצללה." },
  "generate-image/tattoo-flash": { name: "סקיצת קעקוע", description: "קווים בולטים, מבודד." },
  "generate-image/concept-art-env": { name: "אמנות קונספט (סביבה)", description: "אמנות ציורית לקדם־הפקה." },

  // ── Handmade & Stop-Motion ──
  "generate-image/claymation-scene": { name: "סצנת פלסטלינה", description: "מראה סטופ־מושן מפלסטלינה, כולל טביעות אצבע." },
  "generate-image/needle-felt": { name: "לבד מחט", description: "מיניאטורה פרוותית מצמר מולבד." },
  "generate-image/sock-puppet": { name: "בובת גרב", description: "דמות גרב תפורה על במה." },
  "generate-image/cardboard-diorama": { name: "דיורמת קרטון", description: "סט יצירה מקרטון חתוך, נייר דבק וצבע." },
  "generate-image/embroidered-art": { name: "אמנות רקמה", description: "חוט תפור ביד על פשתן במסגרת." },
  "generate-image/faux-food-clay": { name: "אוכל מפלסטלינה", description: "מנה מפלסטלינה מסוגננת כפרסומת." },

  // ── Film & Storyboard ──
  "generate-image/storyboard-frame": { name: "פריים סטוריבורד", description: "סקיצת שוט גסה בשחור־לבן." },
  "generate-image/cinematic-keyframe": { name: "פריים מפתח קולנועי", description: "פריים מפתח מדורג כסטיל מסרט." },
  "generate-image/matte-painting": { name: "ציור רקע (21:9)", description: "סביבה אפית פותחת." },
  "generate-image/moodboard-tile": { name: "אריח לוח השראה", description: "אריח אסתטי אחיד אחד." },
  "generate-image/establishing-shot": { name: "שוט פותח (21:9)", description: "פתיח רחב שמבסס מקום." },

  // ── Architecture & Interiors ──
  "generate-image/exterior-render": { name: "אדריכלות · חוץ", description: "מבנה פוטוריאליסטי בשעת הזהב." },
  "generate-image/interior-design": { name: "אדריכלות · פנים", description: "רינדור חדר באיכות מגזין." },
  "generate-image/real-estate-hero": { name: "נדל״ן · צילום ראשי", description: "צילום מזמין ובהיר לפרסום נכס." },
  "generate-image/building-tall": { name: "גורד שחקים / מבנה גבוה", description: "מבט אנכי דרמטי כלפי מעלה." },

  // ── Icons, Game Assets & Textures ──
  "generate-image/game-icon": { name: "אייקון משחק", description: "אייקון פריט מבריק בסגנון משחקי תפקידים." },
  "generate-image/seamless-texture": { name: "מרקם רציף", description: "חומר בסגנון PBR הניתן לריצוף." },
  "generate-image/seamless-pattern": { name: "דוגמה רציפה", description: "מוטיב דקורטיבי הניתן לריצוף." },
  "generate-image/emoji-set": { name: "סט אמוג'י / תגובות", description: "וריאציות אמוג'י תלת־ממדיות מבריקות." },
  "generate-image/pixel-sprite": { name: "ספרייט פיקסלים", description: "ספרייט פיקסלים מוכן למשחק." },

  // ── Cinematic & Specialty ──
  "generate-image/silhouette": { name: "צללית", description: "נושא באור אחורי, שמיים דרמטיים." },
  "generate-image/long-exposure": { name: "חשיפה ארוכה", description: "תנועה משיית, שובלי אור." },
  "generate-image/tilt-shift": { name: "מיניאטורה (טילט־שיפט)", description: "טשטוש סלקטיבי ליצירת מראה מוקטן." },
  "generate-image/knolling": { name: "סידור בזוויות ישרות", description: "חפצים מסודרים ב־90°." },
  "generate-image/ghost-mannequin": { name: "בגד על בובה שקופה", description: "צילום ביגוד באפקט בובה בלתי נראית." },
  "generate-image/double-exposure": { name: "חשיפה כפולה", description: "צללית ממולאת בסצנה שנייה." },
  "generate-image/vaporwave": { name: "ווייפורווייב", description: "אסתטיקת ניאון פסטלית משנות ה־80." },
  "generate-image/cyberpunk-scene": { name: "סצנת סייברפאנק", description: "לילה דיסטופי מואר ניאון." },
  "generate-image/pop-art": { name: "פופ ארט", description: "גרפיקה בולטת בסגנון פופ ארט." },
  "generate-image/low-poly": { name: "לואו־פולי", description: "תלת־ממד גיאומטרי מפואט." },
  "generate-image/paper-cut": { name: "חיתוך נייר", description: "יצירת נייר חתוך בשכבות." },
  "generate-image/stained-glass": { name: "ויטראז'", description: "פסיפס זכוכית צבעונית משובצת." },

  // ── Diagrams & Infographics ──
  "generate-image/blueprint": { name: "שרטוט טכני", description: "שרטוט לבן על כחול." },
  "generate-image/infographic": { name: "אינפוגרפיקה", description: "פריסת נתונים עם אייקונים ותוויות." },
  "generate-image/ui-mockup": { name: "הדמיית ממשק / אפליקציה", description: "עיצוב מסך נקי לאפליקציה או אתר." },
  "generate-image/flowchart": { name: "תרשים זרימה", description: "תיבות, חצים ותוויות." },
  "generate-image/chart-graph": { name: "תרשים / גרף", description: "המחשת נתונים בעמודות / קו / עוגה." },
  "generate-image/timeline": { name: "ציר זמן", description: "אבני דרך לאורך ציר." },
  "generate-image/x-ray": { name: "רנטגן / שקוף", description: "מראה צילום רנטגן של מבנה פנימי." },
  "generate-image/3d-icon": { name: "אייקון תלת־ממד", description: "אייקון תלת־ממדי מבריק בודד." },
  "generate-image/floor-plan": { name: "תוכנית קומה", description: "פריסה מתויגת במבט־על." },
  "generate-image/aerial-site": { name: "מבט אווירי על מגרש", description: "מבט רחפן על המבנה והסביבה." },

  // ── Portrait Transformations ──
  "generate-image/age-progression-5": { name: "חמישה גילים", description: "אותו אדם בחמישה גילים, שורת סטודיו. דורש תמונת ייחוס." },
  "generate-image/age-progression-3": { name: "טריפטיך שלושה גילים", description: "אותו אדם בשלושה גילים (~10 / 40 / 75). דורש תמונת ייחוס." },
  "generate-image/age-progression-bw": { name: "חמישה גילים — שחור־לבן", description: "שורת גילים במונוכרום. דורש תמונת ייחוס." },
  "generate-image/decade-timeline": { name: "ציר עשורים", description: "אותו אדם משנות ה־80 ועד שנות ה־20. דורש תמונת ייחוס." },
  "generate-image/four-seasons": { name: "ארבע עונות", description: "אותו אדם באביב / קיץ / סתיו / חורף. דורש תמונת ייחוס." },
  "generate-image/times-of-day": { name: "שעות היום", description: "אותו אדם בזריחה / צהריים / שעת הזהב / לילה. דורש תמונת ייחוס." },
  "generate-image/sports-jersey-portrait": { name: "דיוקן בחולצת קבוצה", description: "אתם בחולצת קבוצה רחבה, סגנון סטודיו עריכתי. דורש תמונת ייחוס." },

  // ── Face Privacy ──
  "generate-image/faceless-3d-head": { name: "ללא פנים · ראש תלת־ממד חלק", description: "פני האנשים ← צורת ראש תלת־ממד חלקה וגנרית; כל השאר נשאר ללא שינוי." },
  "generate-image/remove-faces": { name: "הסרת פנים", description: "מחיקת פני האנשים לחלוטין; כל השאר נשאר ללא שינוי." },
  "generate-image/transparent-faces": { name: "פנים שקופות", description: "פני האנשים הופכות לשקופות; כל השאר נשאר ללא שינוי." },

  // ═══ generate-video ═══

  // ── Camera Moves ──
  "generate-video/slow-push-in": { name: "כניסה איטית", description: "דולי הדרגתי לעבר הנושא." },
  "generate-video/dolly-out": { name: "יציאת דולי (חשיפה)", description: "נסיגה לאחור שחושפת את הסצנה." },
  "generate-video/orbit-360": { name: "הקפה 360°", description: "המצלמה מקיפה את הנושא." },
  "generate-video/arc-shot": { name: "שוט קשת", description: "קשת רוחבית סוחפת." },
  "generate-video/crane-up": { name: "עליית מנוף", description: "עלייה מעל לחשיפת קנה מידה." },
  "generate-video/tracking-follow": { name: "מעקב מאחור", description: "עקיבה אחרי הנושא מאחור." },
  "generate-video/slow-pan": { name: "פאן איטי", description: "סריקה אופקית על פני הסצנה." },
  "generate-video/tilt-reveal": { name: "חשיפה בהטיה כלפי מעלה", description: "חשיפה אנכית מהבסיס לפסגה." },
  "generate-video/whip-pan": { name: "פאן מהיר", description: "מעבר מהיר ואנרגטי." },
  "generate-video/dolly-zoom": { name: "דולי זום (ורטיגו)", description: "הרקע מתעוות, הנושא קבוע." },
  "generate-video/crash-zoom": { name: "זום פתאומי", description: "כניסה חדה ואנרגטית." },

  // ── Shot Types & Angles ──
  "generate-video/establishing-wide": { name: "שוט רחב פותח", description: "שוט פתיחה עצום עם תחושת קנה מידה." },
  "generate-video/medium-shot": { name: "שוט בינוני", description: "מסגור מאוזן מהמותן ומעלה." },
  "generate-video/close-up": { name: "תקריב", description: "אינטימי, עומק שדה רדוד." },
  "generate-video/macro-detail": { name: "פרט מאקרו", description: "חשיפה בתקריב קיצוני." },
  "generate-video/low-angle-hero": { name: "זווית נמוכה הרואית", description: "מבט מלמטה — עוצמתי ומרשים." },
  "generate-video/overhead-topdown": { name: "מבט־על מלמעלה", description: "מבט ציפור עם סיבוב איטי." },
  "generate-video/fpv-drone": { name: "מעוף רחפן בגוף ראשון", description: "טיסה סוחפת בגוף ראשון." },

  // ── Cinematic & Specialty ──
  "generate-video/handheld-doc": { name: "תיעודי מצלמת יד", description: "רעידות מצלמה גולמיות וריאליסטיות." },
  "generate-video/slow-motion": { name: "הילוך איטי", description: "תנועה דרמטית בקצב פריימים גבוה." },
  "generate-video/timelapse": { name: "טיים־לאפס", description: "חלוף זמן מהיר." },
  "generate-video/hyperlapse": { name: "הייפר־לאפס", description: "טיים־לאפס נע במרחב." },
  "generate-video/bullet-time": { name: "בולט טיים", description: "רגע קפוא, המצלמה מסתובבת." },
  "generate-video/rack-focus": { name: "העברת מיקוד", description: "מעבר מיקוד בין מישורים." },
  "generate-video/slowmo-reveal": { name: "חשיפה בהילוך איטי", description: "האטה הדרגתית לרגע השיא." },
  "generate-video/match-cut": { name: "חיתוך תואם / מורף", description: "אובייקט א׳ הופך לאובייקט ב׳." },

  // ── Social & Reels ──
  "generate-video/vertical-hero": { name: "קליפ אנכי ראשי", description: "קליפ 9:16 חד ובולט." },
  "generate-video/talking-head": { name: "דיבור למצלמה", description: "יוצר מדבר למצלמה, אנכי." },
  "generate-video/product-reveal-vertical": { name: "חשיפת מוצר (אנכי)", description: "הצגת מוצר ב־9:16." },
  "generate-video/trend-quickcut": { name: "חיתוך מהיר טרנדי", description: "קליפ אנכי אנרגטי." },
  "generate-video/pov-vertical": { name: "הליכה בגוף ראשון (אנכי)", description: "ריל סוחף בגוף ראשון." },
  "generate-video/fashion-walk": { name: "הליכת אופנה", description: "צעד על מסלול, בד בתנועה." },

  // ── Product & Ads ──
  "generate-video/product-hero": { name: "מוצר – צילום ראשי", description: "תקריב פרסומת קולנועי במצלמת יד." },
  "generate-video/product-spin": { name: "סיבוב מוצר 360", description: "לולאת סטודיו מסתובבת ונקייה." },
  "generate-video/liquid-splash": { name: "התזת נוזל", description: "התזה פרסומית בהילוך איטי." },
  "generate-video/unboxing": { name: "פתיחת אריזה", description: "חשיפה קולנועית של החבילה." },
  "generate-video/lifestyle-ad": { name: "פרסומת אורח חיים", description: "מוצר בשימוש, שאפתני." },
  "generate-video/before-after": { name: "חשיפת לפני / אחרי", description: "מעבר ניגוב בין שני מצבים." },

  // ── Motion Graphics & Logo ──
  "generate-video/logo-sting": { name: "סטינגר לוגו", description: "חשיפת מותג קצרה וחדה." },
  "generate-video/title-reveal": { name: "חשיפת כותרת", description: "חשיפת טקסט קולנועית." },
  "generate-video/particle-bg": { name: "רקע חלקיקים", description: "שכבה מופשטת נסחפת." },
  "generate-video/loop-background": { name: "רקע בלולאה", description: "רקע נע בלולאה חלקה." },
  "generate-video/kinetic-typography": { name: "טיפוגרפיה קינטית", description: "מילים נכנסות בתנועה קצבית." },

  // ── B-Roll & Nature ──
  "generate-video/clouds-timelapse": { name: "טיים־לאפס עננים", description: "שמיים נעים ודרמטיים." },
  "generate-video/water-slowmo": { name: "מים בהילוך איטי", description: "מים נוצצים בהילוך איטי." },
  "generate-video/forest-drift": { name: "שיט ביער", description: "היסחפות שלווה באור שמש." },
  "generate-video/aerial-landscape": { name: "נוף אווירי", description: "מבט רחפן סוחף." },
  "generate-video/ocean-loop": { name: "לולאת אוקיינוס", description: "גלים רגועים בלולאה חלקה." },
  "generate-video/weather-atmosphere": { name: "אווירת מזג אוויר", description: "גשם / שלג / ערפל נכנסים." },

  // ── Animation & Style ──
  "generate-video/anime-motion": { name: "תנועת אנימה", description: "סצנה מונפשת בהצללת סלים." },
  "generate-video/cartoon-3d": { name: "קריקטורה תלת־ממד", description: "תנועה שובבה בסגנון אנימציה ממוחשבת." },
  "generate-video/claymation-move": { name: "אנימציית פלסטלינה", description: "תחושת סטופ־מושן מוחשית." },
  "generate-video/watercolor-motion": { name: "צבעי מים חיים", description: "תנועה ציורית זורמת." },

  // ── Looping & Backgrounds ──
  "generate-video/subtle-motion": { name: "תנועה עדינה", description: "תנועה טבעית ומתונה (מצוין להנפשת תמונה סטטית)." },
  "generate-video/living-wallpaper": { name: "טפט חי", description: "סצנת אווירה בלולאה." },
  "generate-video/parallax": { name: "פרלקסה (2.5D)", description: "תנועת עומק מעל תמונה סטטית." },
  "generate-video/cinemagraph": { name: "סינמגרף", description: "כמעט הכול סטטי, רכיב אחד נע." },
  "generate-video/fire-smoke-loop": { name: "אפקט אש ועשן", description: "גחלים ועשן בלולאה." },

  // ── Viral & Effects ──
  "generate-video/frozen-in-ice": { name: "קפוא בקרח", description: "הנושא קופא לגוש קרח." },
  "generate-video/superhero-transformation": { name: "התגלגלות לגיבור־על", description: "נושא רגיל ← חשיפת גיבור־על." },
  "generate-video/elevator-doors-reveal": { name: "חשיפת דלתות מעלית", description: "הדלתות נפתחות, חפצים נשפכים החוצה." },
  "generate-video/pov-skydive": { name: "צניחה בגוף ראשון", description: "נפילה חופשית בגוף ראשון מעל מקום." },
  "generate-video/underwater-pov": { name: "צלילה בגוף ראשון", description: "צלילה בגוף ראשון, קרני שמש ובועות." },

  // ── Scene Recipes ──
  "generate-video/cartoon-short-opening": { name: "סרטון מצויר · פתיחה", description: "שלב 2 · חברו לוחות דמות ומיקום ← מערכה קומית מתוסרטת." },
  "generate-video/cartoon-short-chase": { name: "סרטון מצויר · מרדף", description: "שלב 2 · חברו לוחות ← המרדף המרכזי, עם קפיצה ומעוף בהילוך איטי." },
  "generate-video/cartoon-short-resolution": { name: "סרטון מצויר · סיום", description: "שלב 2 · חברו לוחות ← סיום מחמם לב של חלוקת הפרס עם שלט סיום." },
  "generate-video/two-character-dialogue": { name: "דיאלוג בין שתי דמויות", description: "שלב 2 · חברו לוחות דמות ← חילופי שתי שורות עם סנכרון שפתיים ורגע מוחזק." },
  "generate-video/disaster-reveal": { name: "חשיפת אסון", description: "שלב 2 · חברו לוחות ← אסון ברקע שלא הבחינו בו, הדף, והפנייה האיטית." },
  "generate-video/chase-scene": { name: "סצנת מרדף", description: "שלב 2 · חברו לוחות ← מרדף בשלוש פעימות עם מכשול קומי וכמעט־תפיסה." },
  "generate-video/viral-meteor-scene": { name: "סצנת מטאור ויראלית", description: "שלב 2 · חברו שני לוחות דמות ← הסרטון הקצר ריב־מטאור־צונאמי־חיבוק." },

  // ── Seedance Director ──
  "generate-video/seedance-calm-scene": { name: "תקריב סצנה שלווה", description: "רגע שקט היפר־ריאליסטי עם שמע סביבתי רב־שכבתי." },
  "generate-video/seedance-multi-shot-story": { name: "סיפור קצר רב־שוטים", description: "סטוריבורד בשלושה שוטים עם דיאלוג ושמע לכל שוט." },
  "generate-video/seedance-continuous-take": { name: "שוט רציף אחד", description: "שוט בגוף ראשון אחד ורציף לאורך מסלול כרונולוגי." },
  "generate-video/seedance-action-beat": { name: "פעימת אקשן (מרדף)", description: "פעימת פארקור בשני שוטים — מהלך אחד לכל שוט." },
  "generate-video/seedance-food-macro": { name: "פרסומת מאקרו לאוכל", description: "צילום אוכל מאקרו מתלהט עם שמע עשיר." },
  "generate-video/seedance-film-noir": { name: "סצנת פילם נואר", description: "תאורת מקור יחיד בניגודיות חדה, אווירה מעיקה." },
  "generate-video/seedance-asmr-foley": { name: "תקריב צלילים מרגיעים", description: "צלילי טריגר בגוף ראשון, ללא מוזיקה — אפקטים בלבד." },
  "generate-video/seedance-silhouette-crowd": { name: "קהל צלליות אפי", description: "קהל באור אחורי בקנה מידה גדול — צלליות מסתירות מורכבות." },
  "generate-video/seedance-speed-ramp-duel": { name: "דו־קרב בהאטה הדרגתית", description: "התנגשות אמנויות לחימה עם האטה קיצונית." },
  "generate-video/seedance-creature-feature": { name: "סרט יצורים", description: "יצור מיתי מעוגן באנטומיה של חיה אמיתית." },
  "generate-video/seedance-vertical-dance-reel": { name: "ריל ריקוד אנכי", description: "עריכת ריקוד 9:16 מונעת מוזיקה עם אנרגיית פאן מהיר." },

  // ═══ voice (TTS / voice design / voice changer) ═══
  "text-to-speech/narrator-calm": { name: "קריין רגוע", description: "קריינות אחידה ומדודה." },
  "text-to-speech/audiobook": { name: "ספר מוקלט", description: "חמים, יציב, מעט איטי יותר." },
  "text-to-speech/documentary": { name: "סרט תיעודי", description: "מסירה מדודה עם כובד ראש." },
  "text-to-speech/news-anchor": { name: "קריין חדשות", description: "ניטרלי, סמכותי, בקצב אחיד." },
  "text-to-speech/explainer": { name: "הסברה / הדרכה", description: "ברור, ידידותי, בקצב בינוני." },
  "text-to-speech/commercial": { name: "קריאת פרסומת", description: "אנרגטי, משכנע, חד." },
  "text-to-speech/hype": { name: "אנרגיה גבוהה", description: "מהיר, נלהב, דינמי." },
  "text-to-speech/podcast-host": { name: "מנחה פודקאסט", description: "טבעי, קליל, שיחתי." },
  "text-to-speech/character": { name: "דמות / מספר סיפורים", description: "בעל הבעה, טווח דרמטי." },
  "text-to-speech/meditation": { name: "הרפיה", description: "איטי מאוד, רך ומרגיע." },
  "voice-design/trailer-narrator": { name: "קריין טריילרים", description: "עמוק, דרמטי, סמכותי." },
  "voice-design/noir-detective": { name: "בלש נואר", description: "צרוד, מעושן, מהורהר." },
  "voice-design/meditation-guide": { name: "מנחה הרפיה", description: "רגוע, רך, נשימתי." },
  "voice-design/hype-announcer": { name: "כרוז אנרגטי", description: "מהיר, נלהב, חד." },
  "voice-design/friendly-assistant": { name: "עוזר ידידותי", description: "בהיר, ברור ונגיש." },
  "voice-design/corporate-ivr": { name: "מענה קולי עסקי", description: "ניטרלי, מוקפד, מקצועי." },
  "voice-design/audiobook-female": { name: "ספר מוקלט נשי חם", description: "מרגיע, ברור, אינטימי." },
  "voice-design/old-wizard": { name: "קוסם זקן", description: "צרוד, חכם, תיאטרלי." },
  "voice-changer/faithful": { name: "נאמן למקור", description: "משמר את המסירה המקורית." },
  "voice-changer/clean-stable": { name: "נקי ויציב", description: "חלק, אחיד, מנוקה מרעש." },
  "voice-changer/expressive": { name: "בעל הבעה", description: "מגביר את ההבעה שבמסירה." },
  "voice-changer/studio-clean": { name: "ניקיון סטודיו", description: "מוכן לשידור, מנוקה מרעש." },

  // ═══ sfx ═══
  "text-to-audio/whoosh": { name: "מעבר שוואש", description: "שוואש מהיר ונקי." },
  "text-to-audio/impact-boom": { name: "חבטה / בום", description: "מכה קולנועית עמוקה." },
  "text-to-audio/riser": { name: "עלייה / בנייה", description: "סוויפ מתח עולה." },
  "text-to-audio/rain-ambience": { name: "אווירת גשם", description: "גשם עדין ורציף." },
  "text-to-audio/forest-ambience": { name: "אווירת יער", description: "ציפורים ורשרוש עלים." },
  "text-to-audio/fire-crackle": { name: "פצפוצי אש", description: "לולאת קמין נעימה." },
  "text-to-audio/scifi-drone": { name: "דרון מדע בדיוני", description: "זמזום סביבתי מאיים." },
  "text-to-audio/ui-click": { name: "קליק ממשק", description: "נקישת ממשק חדה." },
  "text-to-audio/notification": { name: "צליל התראה", description: "התראה בהירה ונעימה." },
  "text-to-audio/applause": { name: "מחיאות כפיים / קהל", description: "תשואות נלהבות." },
  "text-to-audio/footsteps": { name: "צעדים", description: "הליכה על רצפה קשה." },
  "text-to-audio/door": { name: "פתיחת / סגירת דלת", description: "חריקה ואז סגירה." },
  "text-to-audio/glass-break": { name: "שבירת זכוכית", description: "ניפוץ חד." },
  "text-to-audio/keyboard-typing": { name: "הקלדה", description: "נקישות מקלדת מכנית." },
  "text-to-audio/explosion": { name: "פיצוץ", description: "בום עמוק ורסיסים." },
  "text-to-audio/magic-sparkle": { name: "נצנוץ", description: "אפקט צלצול מנצנץ." },
  "text-to-audio/camera-shutter": { name: "תריס מצלמה", description: "נקישת מצלמה." },
  "text-to-audio/error-buzzer": { name: "צפצוף שגיאה", description: "צליל טעות / כישלון." },

  // ═══ video-edit ═══
  "video-to-video/anime": { name: "עיצוב מחדש לאנימה", description: "מראה אנימה דו־ממדי בהצללת סלים." },
  "video-to-video/claymation": { name: "פלסטלינה", description: "סטופ־מושן מוחשי מפלסטלינה." },
  "video-to-video/cyberpunk-neon": { name: "ניאון סייברפאנק", description: "מראה עיר ניאון רטובה מגשם." },
  "video-to-video/oil-painting": { name: "ציור שמן", description: "משיחות מכחול ציוריות בתנועה." },
  "video-to-video/pixar-3d": { name: "אנימציית תלת־ממד", description: "מראה סרט ממוחשב מלוטש." },
  "video-to-video/watercolor": { name: "צבעי מים", description: "שכבות זורמות על נייר." },
  "add-captions/clean-subtitles": { name: "כתוביות נקיות", description: "כתוביות קלאסיות בתחתית." },
  "add-captions/tiktok-bold": { name: "בולט וממורכז", description: "מילה־מילה גדול ובמרכז." },
  "add-captions/karaoke": { name: "הדגשת קריוקי", description: "המילים מתמלאות תוך כדי דיבור." },
  "add-captions/word-pop": { name: "קפיצת מילים", description: "כל מילה קופצת פנימה." },
  "add-captions/bouncy": { name: "כתוביות קופצניות", description: "מילים מקפצות באנרגיה." },
  "add-captions/word-highlight": { name: "הדגשת מילה", description: "המילה הפעילה מודגשת." },
  "add-captions/top-banner": { name: "רצועה עליונה", description: "כתוביות לאורך החלק העליון." },
  "combine-videos/seamless-join": { name: "חיבור חלק (שוט אחד)", description: "חיבור ללא קפיצה להארכת סצנה או לקליפים עם פריים פתיחה וסיום." },
  "combine-videos/hard-cut": { name: "חיתוך חד", description: "מעבר מיידי, ללא מיזוג. הכי מהיר." },
  "combine-videos/crossfade": { name: "מעבר צלב", description: "מעבר רך בין קליפים." },
  "combine-videos/dissolve": { name: "המסה", description: "מיזוג אורגני וגרגירי לרגעי זיכרון." },
  "combine-videos/fade-through-black": { name: "מעבר דרך שחור", description: "התעמעמות לשחור בין סצנות." },

  // ═══ switchx ═══
  "switchx/relight-subject": { name: "תאורה מחדש לנושא", description: "מיסוך אוטומטי של הנושא ותאורה מחדש לפי ייחוס." },
  "switchx/swap-background": { name: "החלפת רקע", description: "שמירת הנושא, החלפת הרקע ותאורה מתאימה." },
  "switchx/restyle-scene": { name: "עיצוב מחדש לכל הסצנה", description: "ללא מסכה — עיצוב מחדש של כל הפריים לפי ייחוס או פרומפט." },
  "switchx/masked-composite": { name: "הרכבה עם מסכה", description: "שליטה מדויקת דרך מסכת פריים אחד (חברו רכיב יצירת מסכה)." },
  "switchx/frame-accurate-matte": { name: "מאט מדויק לפריים", description: "שליטה מדויקת בכל פריים דרך סרטון מאט אלפא." },

  // ═══ motion-graphics ═══
  "motion-graphics/lower-third": { name: "כיתוב תחתון", description: "כיתוב תחתון מונפש עם שם, תפקיד וצבע הדגשה." },
  "motion-graphics/title-card": { name: "כרטיס כותרת", description: "כותרת וכותרת משנה ממורכזות בכניסת הגדלה." },
  "motion-graphics/kinetic-typography": { name: "טיפוגרפיה קינטית", description: "שלוש מילים נכנסות בתנועה מדורגת." },
  "motion-graphics/quote-card": { name: "כרטיס ציטוט", description: "ציטוט אלגנטי עם ייחוס וקו הדגשה נמשך." },
  "motion-graphics/end-card-cta": { name: "כרטיס סיום (קריאה לפעולה)", description: "כרטיס סיום עם כותרת וכפתור פועם." },
  "motion-graphics/logo-sting": { name: "סטינגר לוגו", description: "חשיפת מותג חדה עם ציפייה וחריגה." },
  "motion-graphics/channel-intro": { name: "פתיח ערוץ", description: "פתיחה אנרגטית עם שם, סלוגן וצורות." },
  "motion-graphics/countdown": { name: "ספירה לאחור", description: "ספירה של 5 שניות מ־5 עד 1 עם קשת נסחפת." },
  "motion-graphics/subscribe-reminder": { name: "תזכורת הרשמה", description: "כפתור הרשמה שקופץ ופועם." },
  "motion-graphics/like-follow-bug": { name: "סמל לייק ומעקב", description: "סמל פינתי עם לב קופץ וכינוי ניתן לעריכה." },
  "motion-graphics/sale-badge": { name: "תג מבצע", description: "תג קידום ריבועי שנחתם בפיצוץ קרניים." },
  "motion-graphics/story-highlight": { name: "כותרת סטורי", description: "כרטיס כותרת אנכי עם כותרת וטקסט משנה." },
  "motion-graphics/loader-spinner": { name: "מחוון טעינה", description: "מחוון טעינה בלולאה חלקה לשכבות ממשק." },
  "motion-graphics/success-check": { name: "סימן הצלחה", description: "וי שנמשך בתוך טבעת קופצת." },
  "motion-graphics/error-cross": { name: "סימן שגיאה", description: "איקס שנמשך בתוך טבעת רוטטת." },
  "motion-graphics/progress-bar": { name: "סרגל התקדמות", description: "סרגל אופקי שמתמלא עם תווית ניתנת לעריכה." },
  "motion-graphics/notification-pop": { name: "קפיצת התראה", description: "כרטיס התראה שנכנס בהחלקה עם כותרת וגוף." },
  "motion-graphics/confetti-burst": { name: "פיצוץ קונפטי", description: "שכבת קונפטי חגיגית בארבעה צבעים." },
  "motion-graphics/sparkle-shimmer": { name: "ניצוצות מנצנצים", description: "נצנוצים בלולאה לשכבת עיטור." },
  "motion-graphics/speed-lines": { name: "קווי מהירות", description: "קווי מהירות בסגנון אנימה חולפים בפריים." },
  "motion-graphics/gradient-blob-loop": { name: "לולאת כתמי מעבר", description: "כתמי מעבר צבע מתמזגים לאט לרקע בלולאה." },
  "motion-graphics/geometric-pattern-loop": { name: "לולאת דוגמה גיאומטרית", description: "צורות גיאומטריות מרוצפות בלולאה חלקה." },

  // ═══ lottie-overlay ═══
  "lottie-overlay/connected-custom": { name: "שכבת גרפיקה מחוברת", description: "מיקום הגרפיקה המחוברת — מיקום, זמן התחלה, גודל ומצב ניגון הם משתנים." },
  "lottie-overlay/connected-full-canvas": { name: "גרפיקה במסך מלא", description: "מתיחת הגרפיקה על כל הפריים — לכיתובים תחתונים, כותרות ושכבות מלאות." },
  "lottie-overlay/connected-intro": { name: "סטינגר פתיחה", description: "פתיחת הסרטון בגרפיקה המחוברת במסך מלא, ואז יציאה מהדרך." },
  "lottie-overlay/connected-outro": { name: "סטינגר סיום", description: "סגירת הסרטון בגרפיקה המחוברת, מתוזמנת לסיים בפריים האחרון." },
  "lottie-overlay/connected-corner-bug": { name: "סמל פינתי (לולאה)", description: "הגרפיקה המחוברת כסימן מים קטן בלולאה בפינה." },
  "lottie-overlay/connected-reaction-pop": { name: "קפיצת תגובה", description: "הקפצת הגרפיקה המחוברת ברגע מסוים, בגודל של מדבקת תגובה." },
  "lottie-overlay/celebration-moment": { name: "רגע חגיגה", description: "פיצוץ קונפטי ברגע מפתח עם זנב נצנוצים קצר." },
  "lottie-overlay/grand-finale": { name: "סיום מרהיב", description: "זיקוקים וקונפטי שנבנים לאורך השניות האחרונות." },
  "lottie-overlay/ambient-particles": { name: "חלקיקי אווירה", description: "חלקיקים רכים על כל הפריים לאורך הסרטון; הצילום נשאר במרכז." },
  "lottie-overlay/heart-reaction": { name: "תגובת לב", description: "לב פועם ליד הפינה ברגע מסוים." },
  "lottie-overlay/hype-combo": { name: "שילוב התלהבות", description: "אגודל למעלה יחד עם אמוג׳י אש ברגע מפתח." },
  "lottie-overlay/point-it-out": { name: "הצבעה על פרט", description: "חץ מונפש שמכוון לנקודה למשך כמה שניות." },
  "lottie-overlay/success-beat": { name: "רגע הצלחה", description: "וי קופץ לסימון הישג או שלב שהושלם." },

  // ═══ music ═══
  "generate-music/lofi-study": { name: "ביט לימודים רגוע", description: "ביט מתון לריכוז." },
  "generate-music/podcast-intro": { name: "פתיח פודקאסט", description: "פתיחה קצרה ואנרגטית." },
  "generate-music/cinematic-trailer": { name: "טריילר קולנועי", description: "בנייה תזמורתית אפית." },
  "generate-music/corporate-upbeat": { name: "עסקי אופטימי", description: "רקע בהיר ומעורר מוטיבציה." },
  "generate-music/vlog-background": { name: "רקע לוולוג", description: "נעים ולא חודרני." },
  "generate-music/ambient-loop": { name: "לולאת אווירה", description: "מרחב צלילי רגוע ומתפתח." },
  "generate-music/edm-drop": { name: "דרופ אלקטרוני", description: "בנייה ודרופ בסגנון פסטיבל." },
  "generate-music/game-loop": { name: "לולאת משחק", description: "לולאה קליטה והרפתקנית." },
  "generate-music/score-uplifting": { name: "מרומם", description: "פסקול מלא תקווה ובנייה." },
  "generate-music/score-emotional": { name: "רגשי", description: "פסנתר עדין ונוגע." },
  "generate-music/score-tense": { name: "מתוח / מותחן", description: "רקע פועם ומותח." },
  "generate-music/score-epic": { name: "אפי / הרואי", description: "מנצח ורב עוצמה." },
  "generate-music/score-happy": { name: "שמח / שובב", description: "עליז וקליל." },
  "generate-music/score-dark": { name: "אפל / מהורהר", description: "אווירה מאיימת." },
  "generate-music/score-romantic": { name: "לירי", description: "חמים ומרגש." },
  "generate-music/ambient-cinematic": { name: "אווירה קולנועית", description: "רקע אינסטרומנטלי אטמוספרי." },
  "generate-music/genre-lofi": { name: "לו־פיי היפ־הופ", description: "ביט ג׳אזי ורגוע." },
  "generate-music/genre-edm": { name: "אלקטרוני / האוס", description: "אנרגיית מועדון בקצב אחיד." },
  "generate-music/genre-rock": { name: "רוק", description: "גיטרות חשמליות דוחפות." },
  "generate-music/genre-jazz": { name: "ג׳אז רך", description: "סקסופון ומברשות של לילה." },
  "generate-music/genre-orchestral": { name: "תזמורתי", description: "הרכב קולנועי מפואר." },
  "generate-music/genre-synthwave": { name: "סינת׳ווייב / רטרו", description: "נוסטלגיית ניאון משנות ה־80." },
  "generate-music/genre-funk": { name: "פאנק / סול", description: "גרוב קצבי ומתנדנד." },
  "generate-music/trailer-riser": { name: "עליית טריילר", description: "מכת מתח עולה טהורה." },
  "generate-music/calm-corporate": { name: "עסקי רגוע / טכנולוגי", description: "רקע רך ומקצועי." },
  "generate-music/holiday": { name: "חגיגי", description: "חמימות של עונה חגיגית." },
  "generate-music/kids": { name: "לילדים", description: "שובב ופשוט." },
  "generate-music/meditation-spa": { name: "הרפיה / ספא", description: "קערות שירה מרפאות." },
  "generate-music/workout": { name: "אימון / חדר כושר", description: "מוטיבציה באנרגיה גבוהה." },
  "generate-music/trap": { name: "ביט טראפ", description: "808 רועמים, אפל." },
  "generate-music/dnb": { name: "דראם אנד בייס", description: "ברייקביטים מהירים, בס עמוק." },
  "generate-music/afrobeats": { name: "אפרוביטס", description: "גרוב חמים ומסונקף." },
  "generate-music/country": { name: "קאנטרי / אמריקנה", description: "אקוסטי ומרגש." },
  "generate-music/phonk": { name: "פאנק (Phonk)", description: "פאנק אפל לרילס." },
  "generate-music/reggae": { name: "רגאיי / דאב", description: "גרוב איי רגוע." },

  "suno-generate/lofi-study": { name: "לו־פיי ללימודים", description: "ביט מתון לריכוז." },
  "suno-generate/podcast-intro": { name: "פתיח פודקאסט", description: "פתיחה קצרה ובטוחה." },
  "suno-generate/cinematic-trailer": { name: "טריילר קולנועי", description: "בנייה תזמורתית אפית." },
  "suno-generate/corporate-upbeat": { name: "עסקי אופטימי", description: "בהיר ומעורר מוטיבציה." },
  "suno-generate/vlog-background": { name: "רקע לוולוג", description: "רקע אקוסטי נעים." },
  "suno-generate/ambient-loop": { name: "לולאת אווירה", description: "פדים מדיטטיביים רגועים." },
  "suno-generate/edm-drop": { name: "דרופ אלקטרוני", description: "בנייה ודרופ בסגנון פסטיבל." },
  "suno-generate/game-chiptune": { name: "צ׳יפטיון למשחק", description: "לולאת 8־ביט שובבה." },
  "suno-generate/genre-lofi": { name: "לו־פיי היפ־הופ", description: "גרוב מאובק ורגוע." },
  "suno-generate/genre-house": { name: "אלקטרוני / האוס", description: "אנרגיית מועדון בקצב אחיד." },
  "suno-generate/genre-rock": { name: "רוק", description: "גיטרות דוחפות והמנוניות." },
  "suno-generate/genre-jazz": { name: "ג׳אז רך", description: "תחכום של שעת לילה." },
  "suno-generate/genre-ambient": { name: "אווירה", description: "מרווח ושליו." },
  "suno-generate/genre-orchestral": { name: "תזמורתי", description: "הרכב קולנועי מפואר." },
  "suno-generate/genre-synthwave": { name: "סינת׳ווייב / רטרו", description: "נוסטלגיית ניאון משנות ה־80." },
  "suno-generate/genre-funk": { name: "פאנק / סול", description: "קצבי ומתנדנד." },
  "suno-generate/song-pop": { name: "שיר פופ", description: "פופ קולי קליט — הוסיפו מילים." },
  "suno-generate/song-rap": { name: "ראפ / היפ־הופ", description: "בתים חזקים — הוסיפו שורות." },
  "suno-generate/song-ballad": { name: "בלדה רגשית", description: "שירה מרגשת — הוסיפו מילים." },
  "suno-generate/song-rock": { name: "המנון רוק (קולי)", description: "פזמון מתנשא — הוסיפו מילים." },
  "suno-generate/song-acoustic": { name: "אקוסטי – יוצר ומבצע", description: "חמים ואינטימי — הוסיפו מילים." },
  "suno-generate/trailer-riser": { name: "עליית טריילר", description: "מכת מתח עולה טהורה." },
  "suno-generate/calm-corporate": { name: "עסקי רגוע / טכנולוגי", description: "רקע רך ומקצועי." },
  "suno-generate/holiday": { name: "חגיגי", description: "חמימות של עונה חגיגית." },
  "suno-generate/kids": { name: "לילדים", description: "שובב ופשוט." },
  "suno-generate/meditation-spa": { name: "הרפיה / ספא", description: "קערות שירה מרפאות." },
  "suno-generate/workout": { name: "אימון / חדר כושר", description: "מוטיבציה באנרגיה גבוהה." },
  "suno-generate/trap": { name: "ביט טראפ", description: "808 רועמים, אפל." },
  "suno-generate/dnb": { name: "דראם אנד בייס", description: "ברייקביטים מהירים, בס עמוק." },
  "suno-generate/afrobeats": { name: "אפרוביטס", description: "גרוב חמים ומסונקף." },
  "suno-generate/country": { name: "קאנטרי / אמריקנה", description: "אקוסטי ומרגש." },
  "suno-generate/phonk": { name: "פאנק (Phonk)", description: "פאנק אפל לרילס." },
  "suno-generate/reggae": { name: "רגאיי / דאב", description: "גרוב איי רגוע." },
  "suno-generate/song-rnb": { name: "אר אנד בי / סול (קולי)", description: "שירה חלקה ונשמתית — הוסיפו מילים." },
  "suno-generate/song-kpop": { name: "קיי־פופ (קולי)", description: "פזמון מלוטש — הוסיפו מילים." },

  // ═══ text (LLM chat / script / image-to-text) ═══
  "llm-chat/concise-assistant": { name: "עוזר תמציתי", description: "תשובות קצרות וישירות." },
  "llm-chat/brainstorm": { name: "סיעור מוחות / רעיונות", description: "10 רעיונות מגוונים." },
  "llm-chat/copywriter": { name: "קופירייטר / כותרות", description: "קופי שיווקי חד." },
  "llm-chat/social-caption": { name: "כיתוב לרשתות + תגיות", description: "כיתוב ואחריו תגיות." },
  "llm-chat/seo-metadata": { name: "מטא־נתוני קידום", description: "כותרת, תיאור ומילות מפתח." },
  "llm-chat/rewrite-tone": { name: "כתיבה מחדש / שינוי טון", description: "עיצוב מחדש של הטקסט תוך שמירת המשמעות." },
  "llm-chat/script-writer": { name: "כתיבת תסריט / סטוריבורד", description: "תסריט וידאו שוט אחר שוט." },
  "llm-chat/prompt-enhancer": { name: "שיפור פרומפט", description: "רעיון ← פרומפט תמונה עשיר." },
  "llm-chat/translator": { name: "מתרגם", description: "תרגום תוך שמירה על הטון." },
  "llm-chat/summarizer": { name: "מסכם", description: "סיכום ב־3–5 נקודות." },
  "llm-chat/qa-context": { name: "שאלות ותשובות על ההקשר", description: "תשובות מבוססות מקור בלבד." },
  "llm-chat/json-extractor": { name: "מחלץ JSON", description: "מחזיר JSON תקני בלבד." },
  "llm-chat/classifier": { name: "מסווג / סנטימנט", description: "מחזיר תווית אחת." },

  "generate-script/yt-short": { name: "סרטון קצר / וו פתיחה", description: "חד, פותח בוו, כ־30 שניות." },
  "generate-script/explainer": { name: "הסברה (מדריך)", description: "הדרכה ברורה בשמונה שלבים." },
  "generate-script/ad-spot": { name: "פרסומת", description: "ספוט משכנע של 30 שניות." },
  "generate-script/product-demo": { name: "קריינות הדגמת מוצר", description: "סקירת יכולות בביטחון." },
  "generate-script/listicle": { name: "רשימה (5 המובילים)", description: "ספירה לאחור קצבית." },
  "generate-script/ugc-ad": { name: "פרסומת אישית", description: "המלצה על מוצר בסגנון צילום עצמי." },
  "generate-script/podcast-outline": { name: "מתווה פודקאסט", description: "פעימות פרק בסגנון שיחה." },
  "generate-script/trailer-narration": { name: "קריינות טריילר", description: "פעימות קריינות דרמטיות." },
  "generate-script/story-beats": { name: "פעימות סיפור", description: "קשת נרטיבית רגשית." },

  "image-to-text/alt-text": { name: "טקסט חלופי", description: "נגיש, עד 125 תווים." },
  "image-to-text/seo-caption": { name: "כיתוב לקידום", description: "כיתוב ומילות מפתח." },
  "image-to-text/social-caption": { name: "כיתוב לרשתות", description: "כיתוב ותגיות." },
  "image-to-text/ocr": { name: "חילוץ טקסט (OCR)", description: "מחזיר רק את הטקסט הנראה." },
  "image-to-text/tags": { name: "תגיות / מילות מפתח", description: "תגיות מופרדות בפסיקים." },
  "image-to-text/product-desc": { name: "תיאור מוצר", description: "קופי מסחרי מתוך תמונה." },
  "image-to-text/scene-description": { name: "תיאור מפורט", description: "תיאור פרוזה חי." },
  "image-to-text/reverse-prompt": { name: "פרומפט הפוך", description: "תמונה ← פרומפט ליצירת תמונה." },

  // ═══ shared-image (registered under BOTH generate-image/ and modify-image/) ═══
  "generate-image/cartoon-person-real-world": { name: "דמות מצוירת בעולם אמיתי", description: "הנושא ← קריקטורה תלת־ממדית, השאר נשאר ריאליסטי." },
  "generate-image/caricature-real-photo": { name: "קריקטורה על תמונה אמיתית", description: "ראש מצויר מוגזם על סצנה אמיתית." },
  "generate-image/anime-person-real-bg": { name: "דמות אנימה על רקע אמיתי", description: "הנושא ← אנימה דו־ממדית, סביבה אמיתית." },
  "generate-image/real-person-cartoon-world": { name: "אדם אמיתי בעולם מצויר", description: "הפוך — נושא אמיתי, עולם מסוגנן." },
  "generate-image/claymation-figure-real-set": { name: "דמות פלסטלינה בסט אמיתי", description: "הנושא ← דמות מפלסטלינה, סביבה אמיתית." },
  "generate-image/background-remove": { name: "הסרת רקע", description: "חיתוך הנושא על רקע לבן." },
  "generate-image/background-replace": { name: "החלפת רקע", description: "החלפה לסצנה חדשה." },
  "generate-image/colorize": { name: "צביעת תמונה בשחור־לבן", description: "צבע טבעי מגווני אפור." },
  "generate-image/restore-photo": { name: "שחזור תמונה ישנה", description: "תיקון שריטות, הפחתת רעש וחידוד." },
  "generate-image/relight": { name: "תאורה מחדש לסצנה", description: "תאורה חדשה, אותו נושא." },
  "generate-image/restyle-whole": { name: "עיצוב מחדש (כל התמונה)", description: "החלת סגנון אמנותי על הכול." },
  "generate-image/doodle-overlay": { name: "שרבוטים על התמונה", description: "שרבוטי טוש מצוירים ביד מעל — התמונה נשארת נקייה." },
  "generate-image/doodle-overlay-expressive": { name: "שרבוטים · חופשי", description: "שרבוטים חופשיים יותר — המודל מאלתר." },

  "modify-image/cartoon-person-real-world": { name: "דמות מצוירת בעולם אמיתי", description: "הנושא ← קריקטורה תלת־ממדית, השאר נשאר ריאליסטי." },
  "modify-image/caricature-real-photo": { name: "קריקטורה על תמונה אמיתית", description: "ראש מצויר מוגזם על סצנה אמיתית." },
  "modify-image/anime-person-real-bg": { name: "דמות אנימה על רקע אמיתי", description: "הנושא ← אנימה דו־ממדית, סביבה אמיתית." },
  "modify-image/real-person-cartoon-world": { name: "אדם אמיתי בעולם מצויר", description: "הפוך — נושא אמיתי, עולם מסוגנן." },
  "modify-image/claymation-figure-real-set": { name: "דמות פלסטלינה בסט אמיתי", description: "הנושא ← דמות מפלסטלינה, סביבה אמיתית." },
  "modify-image/background-remove": { name: "הסרת רקע", description: "חיתוך הנושא על רקע לבן." },
  "modify-image/background-replace": { name: "החלפת רקע", description: "החלפה לסצנה חדשה." },
  "modify-image/colorize": { name: "צביעת תמונה בשחור־לבן", description: "צבע טבעי מגווני אפור." },
  "modify-image/restore-photo": { name: "שחזור תמונה ישנה", description: "תיקון שריטות, הפחתת רעש וחידוד." },
  "modify-image/relight": { name: "תאורה מחדש לסצנה", description: "תאורה חדשה, אותו נושא." },
  "modify-image/restyle-whole": { name: "עיצוב מחדש (כל התמונה)", description: "החלת סגנון אמנותי על הכול." },
  "modify-image/doodle-overlay": { name: "שרבוטים על התמונה", description: "שרבוטי טוש מצוירים ביד מעל — התמונה נשארת נקייה." },
  "modify-image/doodle-overlay-expressive": { name: "שרבוטים · חופשי", description: "שרבוטים חופשיים יותר — המודל מאלתר." },
}
