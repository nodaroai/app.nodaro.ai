import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Standing
  "standing-upright": { label: "עומד זקוף", description: "תנוחת עמידה רגועה" },
  "confident-stance": { label: "עמידה בטוחה", description: "רגליים מרוחקות, כתפיים אחורה" },
  "hands-on-hips": { label: "ידיים על המותניים", description: "ידיים על המותניים" },
  "arms-crossed": { label: "ידיים שלובות", description: "ידיים שלובות על החזה" },
  "leaning": { label: "נשען", description: "נשען על משהו" },
  "hero-pose": { label: "תנוחת גיבור", description: "עמדת גיבור דרמטית" },
  "contrapposto": { label: "Contrapposto", description: "מותן מוטה, משקל על רגל אחת" },
  "leaning-against-wall": { label: "נשען על קיר", description: "נשען בקז'ואליות על קיר" },
  "hands-behind-head": { label: "ידיים מאחורי הראש", description: "שתי הידיים שלובות מאחורי הראש" },
  "hands-behind-back": { label: "ידיים מאחורי הגב", description: "ידיים שלובות מאחורי הגב" },

  // Seated
  "sitting": { label: "יושב", description: "יושב באופן טבעי" },
  "cross-legged": { label: "ברגליים שלובות", description: "יושב ברגליים שלובות על הרצפה" },
  "kneeling": { label: "כורע", description: "כורע על הרצפה" },
  "crouching": { label: "כפוף", description: "כפוף נמוך" },
  "lounging": { label: "מתפנק", description: "ישיבה רגועה ומורכנת" },
  "sitting-edge-of-bed": { label: "יושב על קצה המיטה", description: "מטופס על קצה המיטה" },
  "chair-arm-drape": { label: "רגליים על ידית הכיסא", description: "רגליים תלויות מעל ידית הכיסא" },
  "elbow-propped": { label: "לחי על מרפק", description: "לחי נשענת על מרפק תומך" },
  "lying-on-stomach-reading": { label: "שוכב על הבטן וקורא", description: "שוכב על הבטן, נשען על המרפקים בקריאה" },

  // Movement
  "walking": { label: "הולך", description: "הליכה באמצע צעד" },
  "running": { label: "רץ", description: "באמצע ריצה, בתנועה" },
  "jumping": { label: "קופץ", description: "באוויר, באמצע קפיצה" },
  "dancing": { label: "רוקד", description: "נתפס באמצע ריקוד" },
  "climbing": { label: "מטפס", description: "מטפס, אוחז כלפי מעלה" },
  "mid-fall": { label: "באמצע נפילה", description: "נתפס באמצע נפילה באוויר" },
  "mid-spin": { label: "באמצע סיבוב", description: "מסתובב, באמצע סיבוב" },
  "stretching": { label: "מתמתח", description: "מתיחת גוף מלא, ידיים מעל הראש" },
  "reaching-up": { label: "מושיט מעלה", description: "ידיים מורמות מעל הראש" },
  "kissing": { label: "מתנשק", description: "נעול בנשיקה" },
  "riding": { label: "רוכב", description: "רוכב על אופניים, סוס או אופנוע" },
  "driving": { label: "נוהג", description: "מאחורי ההגה של רכב" },

  // Action
  "fighting-stance": { label: "עמדת לחימה", description: "עמדה מוכנה לקרב" },
  "reaching": { label: "מושיט יד", description: "מושיט יד החוצה" },
  "throwing": { label: "זורק", description: "באמצע תנועת זריקה" },
  "leaping": { label: "מזנק", description: "מזנק קדימה באופן דינמי" },
  "dramatic-action": { label: "אקשן דרמטי", description: "תנוחת אקשן מוגזמת" },
  "biting-lip": { label: "נושך שפה", description: "נשיכת שפה שובבה קלה" },
  "mid-laugh": { label: "באמצע צחוק", description: "נתפס באמצע צחוק, ראש לאחור" },
  "pointing-at-camera": { label: "מצביע למצלמה", description: "מצביע ישירות למצלמה" },
  "tongue-out": { label: "לשון בחוץ", description: "הוצאת לשון שובבה" },
  "thinking": { label: "חושב", description: "יד על הסנטר, מהורהר" },

  // Resting
  "lying-down": { label: "שוכב", description: "שוכב שטוח" },
  "sleeping": { label: "ישן", description: "עיניים עצומות, ישן" },
  "hugging": { label: "מחבק", description: "מחבק אחר" },
  "looking-away": { label: "מסתכל הצידה", description: "ראש מופנה, מסתכל הצידה" },
  "looking-up": { label: "מסתכל למעלה", description: "מביט בשמיים" },
  "looking-down": { label: "מסתכל למטה", description: "עיניים מורדות" },
  "head-over-shoulder": { label: "ראש מעל הכתף", description: "מסתכל לאחור מעל הכתף" },
  "wading-in-water": { label: "צועד במים", description: "צועד בעומק אמצע ירך במים" },

  // Hand Position
  "hands-in-pockets": { label: "ידיים בכיסים", description: "שתי הידיים מוטמנות בכיסים" },
  "hand-on-hip": { label: "יד על המותן", description: "יד אחת על המותן" },
  "hand-position-hands-on-hips": { label: "ידיים על המותניים", description: "שתי הידיים על המותניים" },
  "hand-on-chin": { label: "יד על הסנטר", description: "יד נשענת על הסנטר" },
  "hand-on-collarbone": { label: "יד על עצם הבריח", description: "יד נשענת על עצם הבריח" },
  "hand-brushing-hair": { label: "יד מסרקת שיער", description: "יד עוברת בשיער" },
  "finger-to-lip": { label: "אצבע על השפה", description: "קצה אצבע נלחץ על השפה התחתונה" },
  "arms-wrapped-around-self": { label: "ידיים סביב עצמך", description: "חיבוק עצמי, ידיים סביב הגוף" },
  "hands-clasped": { label: "ידיים שלובות", description: "שתי הידיים שלובות בחזית" },

  // Body Lean
  "leaning-back": { label: "נשען לאחור", description: "גוף נשען מעט לאחור" },
  "leaning-forward": { label: "נשען קדימה", description: "גוף נשען לעבר המצלמה" },
  "body-lean-contrapposto": { label: "Contrapposto", description: "משקל על רגל אחת, מותן דחוף החוצה" },
  "arched-back": { label: "גב מקושת", description: "גב מקושת בעדינות, חזה קדימה" },
  "shoulder-rolled-forward": { label: "כתף מגולגלת קדימה", description: "כתף אחת מגולגלת קדימה" },

  // Head Tilt
  "tilted-up": { label: "מוטה למעלה", description: "ראש מוטה מעט מעלה" },
  "tilted-down": { label: "מוטה למטה", description: "ראש מוטה מעט מטה" },
  "tilted-side": { label: "מוטה הצידה", description: "ראש מוטה לעבר הכתף" },
  "tilted-back": { label: "מוטה לאחור", description: "ראש מלא לאחור, גרון חשוף" },
  "chin-up": { label: "סנטר למעלה", description: "סנטר מורם, מסתכל מטה במורד האף" },
  "chin-tucked": { label: "סנטר למטה", description: "סנטר מקופל לעבר החזה" },

  // Activity
  "activity-smoking": { label: "מעשן", description: "מחזיק ומעשן סיגריה" },
  "activity-drinking": { label: "שותה", description: "שותה מכוס או מספל" },
  "activity-eating": { label: "אוכל", description: "נתפס באמצע נגיסה" },
  "activity-talking-on-phone": { label: "מדבר בטלפון", description: "טלפון צמוד לאוזן, מדבר" },
  "activity-texting": { label: "מסמס", description: "מסתכל למטה בטלפון, אגודלים מקלידים" },
  "activity-typing-laptop": { label: "מקליד על לפטופ", description: "ידיים על מקלדת, מתמקד במסך" },
  "activity-reading": { label: "קורא", description: "מחזיק ספר או מגזין פתוח" },
  "activity-writing": { label: "כותב", description: "כותב במחברת עם עט" },
  "activity-painting": { label: "מצייר", description: "מצייר על קנבס עם מכחול" },
  "activity-playing-instrument": { label: "מנגן בכלי", description: "מנגן בכלי נגינה" },
  "activity-cooking": { label: "מבשל", description: "מבשל על דלפק או כיריים במטבח" },
  "activity-driving": { label: "נוהג", description: "מאחורי ההגה, ידיים אוחזות" },
}

export default map
