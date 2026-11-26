import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto": { label: "אוטומטי", description: "המודל בוחר את המעבר המתאים" },
  "none": { label: "ללא מעבר / חיתוך ישיר", description: "מעבר מיידי ללא אפקט" },
  "cross-dissolve": { label: "דיסולב מוצלב", description: "מיזוג הדרגתי בין שני השוטים" },
  "fade-to-black": { label: "דהייה לשחור", description: "חשיכה הדרגתית ואז הסצנה הבאה" },
  "fade-to-white": { label: "דהייה ללבן", description: "הבהרה עד לבן ואז הסצנה הבאה" },
  "snap-to-black": { label: "חיתוך לשחור", description: "חיתוך מיידי לשחור מלא לרגע, ואז השוט הבא" },
  "match-cut": { label: "חיתוך התאמה", description: "התאמת צורה או תנועה בין השוטים" },
  "smash-cut": { label: "חיתוך חד", description: "חיתוך חד ומפתיע בין שוטים מנוגדים" },
  "iris": { label: "איריס", description: "עיגול נסגר ונפתח על הסצנה החדשה" },
  "wipe": { label: "ווייפ", description: "קו סורק את הפריים וחושף את השוט הבא" },
  "roll-transition": { label: "סיבוב", description: "הפריים מסתובב 90-180 מעלות, והשוט הבא מופיע ישר" },
  "seamless-match": { label: "התאמה חלקה", description: "חיתוך נסתר בתנועה וצבע תואמים" },
  "whip-pan": { label: "פאן מהיר", description: "המצלמה מסתובבת הצידה במהירות לכדי טשטוש, והשוט הבא ממשיך באותו כיוון" },
  "jump-cut": { label: "ג׳אמפ קאט", description: "אותו קאדר, הזמן מדלג קדימה" },

  // ── Time ──
  "fast-forward-day-night": { label: "הרצה מהירה (יום ← לילה)", description: "מעבר זמן מהיום ללילה באותה סצנה" },
  "fast-forward-night-day": { label: "הרצה מהירה (לילה ← יום)", description: "מעבר זמן מהלילה לשחר באותה סצנה" },
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
  "aurora-sweep": { label: "וילון זוהר קוטבי", description: "וילון זוהר קוטבי עובר ומגלה את הסצנה החדשה" },
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
  "wireframe-morph": { label: "מורף רשת קווים", description: "הדמות מתפרקת לרשת גיאומטרית ומתגבשת מחדש" },
  "polygon-shatter": { label: "התנפצות לפוליגונים", description: "הדמות מתפצלת לרסיסים גיאומטריים ומתגבשת" },
  "melt-down": { label: "הימסות ובנייה מחדש", description: "הדמות נמסה כשעווה ועולה מחדש" },

  // ── Portal ──
  "zoom-into-eye": { label: "זום לתוך עין", description: "המצלמה חודרת לאישון ומגלה בתוכו עולם חדש" },
  "zoom-into-mirror": { label: "זום לתוך מראה", description: "המצלמה עוברת דרך המראה לעולם ההשתקפות" },
  "zoom-into-screen": { label: "זום לתוך מסך", description: "המצלמה חודרת למסך טלוויזיה או טלפון" },
  "zoom-into-book": { label: "זום לתוך ספר", description: "המצלמה נכנסת לאיור בספר" },
  "walk-through-door": { label: "מעבר דרך דלת", description: "המצלמה עוברת בדלת לסצנה חדשה" },
  "fall-into-hole": { label: "נפילה לחור", description: "המצלמה נופלת לחור ומגיחה לסצנה חדשה" },
  "pull-out-reveal": { label: "משיכה לאחור וחשיפה", description: "חושף שהסצנה הייתה בתוך תמונה או מסגרת" },
  "zoom-into-mouth": { label: "זום לתוך פה", description: "המצלמה נכנסת לפה ומגיחה לעולם חדש" },
  "push-through-glass": { label: "חדירה דרך זכוכית", description: "המצלמה חודרת דרך לוח זכוכית אל עולם אחר" },
  "soul-jump": { label: "קפיצת נשמה", description: "נשמה שקופה עוזבת גוף אחד ונכנסת לאחר" },
  "mask-transition": { label: "מעבר מסכה", description: "עצם בחזית מכסה את הפריים והמצלמה חוצה את החושך אל הסצנה החדשה" },
  "zoom-through": { label: "זום אל תוך פרט", description: "המצלמה מגדילה פרט אחד עד שהסצנה החדשה נפרשת בתוכו" },

  // ── Physics ──
  "explosion-blast": { label: "גל פיצוץ", description: "פיצוץ סורק את הפריים וחושף את הסצנה החדשה" },
  "shockwave": { label: "גל הדף", description: "גל הדף מעוות את הפריים והסצנה משתנה" },
  "punch-into-camera": { label: "אגרוף למצלמה", description: "אגרוף פוגע בעדשה והסצנה משתנה" },
  "debris-shower": { label: "מטר שברים", description: "שברים חולפים על פני המצלמה והסצנה מתחלפת מאחוריהם" },
  "gravity-flip": { label: "היפוך כבידה", description: "הכבידה מתהפכת והמצלמה מסתובבת 180 מעלות" },
  "building-explosion": { label: "פיצוץ מבנה", description: "מבנה מתפוצץ והסצנה נחשפת מבעד לעשן" },
  "vehicle-explosion": { label: "פיצוץ רכב", description: "רכב מתפוצץ, להבות מכסות את הפריים, והסצנה מתחלפת" },
  "jump-match": { label: "חיתוך על קפיצה", description: "הדמות קופצת ונוחתת בסצנה חדשה" },
  "hand-swipe": { label: "העברת יד", description: "יד עוברת מול העדשה והסצנה משתנה" },
  "action-relay": { label: "חיתוך על תנועה", description: "הדמות יוצאת מהפריים בתנועה וממשיכה אותה בסצנה החדשה" },

  // ── Light ──
  "white-flash": { label: "הבזק לבן", description: "הפריים מוצף בלבן ואז מגיחה הסצנה החדשה" },
  "lens-flare-swipe": { label: "החזר עדשה חולף", description: "החזר עדשה אנמורפי חוצה את הפריים" },
  "light-streak": { label: "פס אור", description: "פס אור חוצה את הפריים וחושף את הסצנה" },
  "color-invert": { label: "היפוך צבעים", description: "הצבעים מתהפכים לרגע והסצנה משתנה" },
  "sun-glare": { label: "בוהק שמש", description: "בוהק שמש מציף את העדשה ואז הסצנה נחשפת" },
  "lens-crack": { label: "סדק בעדשה", description: "העדשה מסתדקת והסצנה החדשה נראית דרכה" },
  "dirty-lens-wipe": { label: "ניגוב עדשה מלוכלכת", description: "ניגוב מנקה את העדשה וחושף את הסצנה החדשה" },
  "eye-light-burst": { label: "פרץ אור מהעיניים", description: "קרן אור עזה מעיני הדמות מציפה את הפריים בלבן" },

  // ── Glitch ──
  "digital-glitch": { label: "גליץ' דיגיטלי", description: "שיבוש דיגיטלי: פיצול RGB, קווי סריקה ודאטאמוש" },
  "vhs-rewind": { label: "הרצת VHS לאחור", description: "עיוות טראקינג של קלטת VHS בהרצה לאחור" },
  "datamosh": { label: "דאטאמוש", description: "וקטורי תנועה מחלחלים בין הסצנות" },
  "channel-flip": { label: "החלפת ערוץ", description: "החלפת ערוץ בטלוויזיה עם רעש סטטי" },
  "hologram-flicker": { label: "הבהוב הולוגרמה", description: "הבהוב הולוגרמה מגלה את הסצנה החדשה" },
  "display-wipe": { label: "מעבר דרך מסך", description: "הסצנה מתכווצת לתוך מסך ומשם מתרחבת לסצנה החדשה" },
  "double-exposure": { label: "חשיפה כפולה", description: "שתי סצנות שקופות חופפות ואז הראשונה דוהה" },
}

export default map
