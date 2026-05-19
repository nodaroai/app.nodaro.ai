import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto": { label: "אוטומטי", description: "המודל בוחר את המעבר המתאים" },
  "none": { label: "ללא מעבר / חיתוך ישיר", description: "מעבר מיידי ללא אפקט" },
  "cross-dissolve": { label: "דיסולב הצלבה", description: "מיזוג הדרגתי בין שתי הסצנות" },
  "fade-to-black": { label: "דהייה לשחור", description: "חשיכה הדרגתית ואז הסצנה הבאה" },
  "fade-to-white": { label: "דהייה ללבן", description: "הבהרה עד לבן ואז הסצנה הבאה" },
  "match-cut": { label: "חיתוך התאמה", description: "התאמת צורה או תנועה בין הסצנות" },
  "smash-cut": { label: "חיתוך חד", description: "חיתוך מפתיע בין סצנות מנוגדות" },
  "iris": { label: "אירוס", description: "עיגול נסגר ונפתח על הסצנה החדשה" },
  "wipe": { label: "מחיקה", description: "קו סורק את הפריים וחושף את הסצנה" },
  "roll-transition": { label: "סיבוב", description: "הפריים מסתובב 90-180 מעלות" },
  "seamless-match": { label: "התאמה חלקה", description: "חיתוך נסתר בתנועה וצבע תואמים" },

  // ── Time ──
  "fast-forward-day-night": { label: "הרצה מהירה (יום ← לילה)", description: "מעבר זמן מהיום ללילה באותה סצנה" },
  "fast-forward-night-day": { label: "הרצה מהירה (לילה ← שחר)", description: "מעבר זמן מהלילה לשחר באותה סצנה" },
  "seasonal-shift": { label: "מעבר עונות", description: "אותה סצנה לאורך ארבע העונות" },
  "aging": { label: "הזדקנות", description: "הדמות מזדקנת מול המצלמה" },
  "rewind": { label: "הרצה לאחור", description: "הזמן מתהפך והתנועה נסוגה" },
  "freeze-frame-jump": { label: "הקפאה וקפיצה", description: "הפריים קופא ואז קופץ לרגע אחר" },
  "weather-shift": { label: "שינוי מזג האוויר", description: "אותה סצנה במזג אוויר שונה" },
  "flashback": { label: "פלאשבק", description: "מעבר זיכרון לרגע מהעבר" },

  // ── Element ──
  "dissolve-to-mist": { label: "התמוססות לערפל", description: "הדמות מתמוססת לערפל ומתגבשת מחדש" },
  "water-splash": { label: "ניתוז מים", description: "הדמות הופכת למים ואז מתגבשת" },
  "sand-scatter": { label: "פיזור חול", description: "הדמות מתפוררת לחול והרוח סוחפת אותה" },
  "fire-burnup": { label: "שריפה", description: "הדמות עולה בלהבות ונוצרת מחדש מגחלים" },
  "smoke-puff": { label: "ענן עשן", description: "הדמות נעלמת בענן עשן ומופיעה מחדש" },
  "magic-sparkles": { label: "ניצוצות קסם", description: "התפוררות לחלקיקים זוהרים וחזרה" },
  "lightning-flash": { label: "פגיעת ברק", description: "ברק מאיר את הפריים והסצנה משתנה" },
  "ink-splash": { label: "ניתוז דיו", description: "דיו מכסה את הפריים וחושף את הסצנה החדשה" },
  "sand-storm": { label: "סופת חול", description: "סופת חול בולעת את הפריים והסצנה משתנה" },
  "paint-splash": { label: "ניתוז צבע", description: "צבע מכסה את הפריים וחושף את הסצנה החדשה" },
  "aurora-sweep": { label: "שטף זוהר קוטבי", description: "וילון אורורה עובר ומגלה את הסצנה החדשה" },
  "sakura-petals": { label: "סערת פרחי דובדבן", description: "שטף עלי כותרת ורודים מכסה את הפריים" },
  "garden-bloom": { label: "פריחת גן", description: "פרחים פורחים ופותחים וילון לסצנה החדשה" },
  "powder-burst": { label: "התפוצצות אבקת צבע", description: "ענן צבע מתפזר וחושף את הסצנה החדשה" },

  // ── Morph ──
  "liquid-morph": { label: "מורף נוזלי", description: "הדמות נמסה ומתעצבת מחדש כדמות אחרת" },
  "pixelate-reform": { label: "פיקסולציה ובנייה מחדש", description: "פיקסלים מתפזרים ומתגבשים לדמות חדשה" },
  "shatter-glass": { label: "שבירה ובנייה מחדש", description: "הדמות מתנפצת כזכוכית ומתגבשת מחדש" },
  "origami-fold": { label: "קיפול אוריגמי", description: "הדמות מתקפלת כנייר וחושפת דמות חדשה" },
  "vortex-swirl": { label: "מערבולת", description: "הדמות נבלעת במערבולת ומתגלה כדמות חדשה" },
  "dream-ripple": { label: "גלי חלום", description: "גל מעגלי עובר ומגלה את הסצנה החדשה" },
  "wireframe-morph": { label: "מורף מסגרת תיל", description: "הדמות מתפרקת לרשת גיאומטרית ומתגבשת מחדש" },
  "polygon-shatter": { label: "התפוצצות פוליגונים", description: "הדמות מתפצלת לרסיסים גיאומטריים ומתגבשת" },
  "melt-down": { label: "הימסות ובנייה מחדש", description: "הדמות נמסה כשעווה ועולה מחדש" },

  // ── Portal ──
  "zoom-into-eye": { label: "זום לתוך עין", description: "המצלמה חודרת לאישון ועולם חדש בפנים" },
  "zoom-into-mirror": { label: "זום לתוך מראה", description: "המצלמה עוברת דרך המראה לעולם ההשתקפות" },
  "zoom-into-screen": { label: "זום לתוך מסך", description: "המצלמה חודרת למסך טלוויזיה או טלפון" },
  "zoom-into-book": { label: "זום לתוך ספר", description: "המצלמה נכנסת לאיור בספר" },
  "walk-through-door": { label: "מעבר דרך דלת", description: "המצלמה עוברת בדלת לסצנה חדשה" },
  "fall-into-hole": { label: "נפילה לחור", description: "המצלמה נופלת לחור ומגיחה לסצנה חדשה" },
  "pull-out-reveal": { label: "משיכה לאחור וחשיפה", description: "חושף שהסצנה הייתה בתוך תמונה או מסגרת" },
  "zoom-into-mouth": { label: "זום לתוך פה", description: "המצלמה נכנסת לפה ומגיחה לעולם חדש" },
  "push-through-glass": { label: "דחיפה דרך זכוכית", description: "המצלמה חודרת לוח זכוכית לעולם אחר" },
  "soul-jump": { label: "קפיצת נשמה", description: "נשמה שקופה עוזבת גוף אחד ונכנסת לאחר" },

  // ── Physics ──
  "explosion-blast": { label: "גל פיצוץ", description: "פיצוץ סורק את הפריים וחושף את הסצנה החדשה" },
  "shockwave": { label: "גל הדף", description: "גל הדף מעוות את הפריים והסצנה משתנה" },
  "punch-into-camera": { label: "אגרוף למצלמה", description: "אגרוף פוגע בעדשה והסצנה משתנה" },
  "debris-shower": { label: "מקלחת פסולת", description: "פסולת עוברת בפריים והסצנה משתנה מאחוריה" },
  "gravity-flip": { label: "היפוך כבידה", description: "הכבידה מתהפכת והמצלמה מסתובבת 180 מעלות" },
  "building-explosion": { label: "פיצוץ מבנה", description: "מבנה מתפוצץ והסצנה נחשפת מבעד לעשן" },
  "vehicle-explosion": { label: "פיצוץ רכב", description: "רכב מתפוצץ ולהבות מכסות את הפריים" },
  "jump-match": { label: "קפיצה תואמת", description: "הדמות קופצת ונוחתת בסצנה חדשה" },
  "hand-swipe": { label: "מחיקת יד", description: "יד עוברת מול העדשה והסצנה משתנה" },

  // ── Light ──
  "white-flash": { label: "הבזק לבן", description: "הפריים מתמלא לבן ואז מגיחה הסצנה החדשה" },
  "lens-flare-swipe": { label: "החזר עדשה אנמורפי", description: "החזר עדשה אנמורפי סורק את הפריים" },
  "light-streak": { label: "קו אור", description: "קרן אור חוצה את הפריים וחושפת את הסצנה" },
  "color-invert": { label: "היפוך צבעים", description: "הצבעים מתהפכים לרגע והסצנה משתנה" },
  "sun-glare": { label: "בוהק שמש", description: "בוהק שמש מציף את העדשה ואז הסצנה נחשפת" },
  "lens-crack": { label: "סדק בעדשה", description: "העדסה מסתדקת והסצנה החדשה נראית דרכה" },
  "dirty-lens-wipe": { label: "ניגוב עדשה מלוכלכת", description: "ניגוב מנקה את העדשה וחושף את הסצנה החדשה" },
  "eye-light-burst": { label: "פרץ אור מהעיניים", description: "קרן עוצמתית מעיני הדמות מציפה את הפריים" },

  // ── Glitch ──
  "digital-glitch": { label: "גליץ' דיגיטלי", description: "שיבוש דיגיטלי: פיצול RGB, קריעת שורות, דאטאמוש" },
  "vhs-rewind": { label: "הרצה לאחור VHS", description: "שיבוש טראקינג VHS ואפקט הרצת קלטת" },
  "datamosh": { label: "דאטאמוש", description: "וקטורי תנועה מוליכים בין הסצנות" },
  "channel-flip": { label: "החלפת ערוץ", description: "שטיק טלוויזיה עם רעש החלפת ערוצים" },
  "hologram-flicker": { label: "מצמוץ הולוגרמה", description: "מצמוץ הולוגרמה מגלה את הסצנה החדשה" },
  "display-wipe": { label: "מחיקת תצוגה", description: "הסצנה מתכווצת למסך קטן ואז מתרחבת" },
  "double-exposure": { label: "חשיפה כפולה", description: "שתי סצנות שקופות חופפות ואז הראשונה דוהה" },
}

export default map
