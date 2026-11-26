import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Standing
  "standing-upright": { label: "עמידה זקופה", description: "תנוחת עמידה רגועה" },
  "confident-stance": { label: "עמידה בטוחה", description: "רגליים פשוקות, כתפיים לאחור" },
  "hands-on-hips": { label: "ידיים על המותניים", description: "ידיים על המותניים" },
  "arms-crossed": { label: "זרועות משוכלות", description: "זרועות משוכלות על החזה" },
  "leaning": { label: "הישענות", description: "הישענות על משהו" },
  "hero-pose": { label: "תנוחת גיבור", description: "עמידת גיבור דרמטית" },
  "contrapposto": { label: "Contrapposto", description: "מותן מוטה, משקל על רגל אחת" },
  "leaning-against-wall": { label: "הישענות על קיר", description: "הישענות נינוחה על קיר" },
  "hands-behind-head": { label: "ידיים מאחורי הראש", description: "שתי הידיים שלובות מאחורי הראש" },
  "hands-behind-back": { label: "ידיים מאחורי הגב", description: "ידיים שלובות מאחורי הגב" },

  // Seated
  "sitting": { label: "ישיבה", description: "ישיבה טבעית" },
  "cross-legged": { label: "ישיבה מזרחית", description: "ישיבה ברגליים שלובות על הרצפה" },
  "kneeling": { label: "כריעה", description: "כריעה על הקרקע" },
  "crouching": { label: "השתופפות", description: "השתופפות נמוכה" },
  "lounging": { label: "התרווחות", description: "ישיבה נינוחה בהישענות לאחור" },
  "sitting-edge-of-bed": { label: "ישיבה על קצה המיטה", description: "ישיבה קלה על קצה המיטה" },
  "chair-arm-drape": { label: "רגליים על ידית הכיסא", description: "רגליים תלויות מעל ידית הכיסא" },
  "elbow-propped": { label: "לחי על מרפק", description: "לחי נשענת על מרפק תומך" },
  "lying-on-stomach-reading": { label: "קריאה בשכיבה על הבטן", description: "שכיבה על הבטן בהישענות על המרפקים, בזמן קריאה" },

  // Movement
  "walking": { label: "הליכה", description: "הליכה באמצע צעד" },
  "running": { label: "ריצה", description: "באמצע ריצה, בתנועה" },
  "jumping": { label: "קפיצה", description: "באוויר, באמצע קפיצה" },
  "dancing": { label: "ריקוד", description: "רגע באמצע ריקוד" },
  "climbing": { label: "טיפוס", description: "טיפוס, הידיים נאחזות למעלה" },
  "mid-fall": { label: "באמצע נפילה", description: "רגע באמצע נפילה באוויר" },
  "mid-spin": { label: "באמצע סיבוב", description: "הסתחררות, באמצע סיבוב" },
  "stretching": { label: "התמתחות", description: "מתיחה של כל הגוף, ידיים מעל הראש" },
  "reaching-up": { label: "הושטת ידיים למעלה", description: "ידיים מורמות מעל הראש" },
  "kissing": { label: "נשיקה", description: "בעיצומה של נשיקה" },
  "riding": { label: "רכיבה", description: "רכיבה על אופניים, סוס או אופנוע" },
  "driving": { label: "נהיגה", description: "מאחורי ההגה של רכב" },

  // Action
  "fighting-stance": { label: "עמדת לחימה", description: "עמידה דרוכה לקרב" },
  "reaching": { label: "הושטת יד", description: "הושטת יד החוצה" },
  "throwing": { label: "זריקה", description: "באמצע תנועת זריקה" },
  "leaping": { label: "זינוק", description: "זינוק נמרץ קדימה" },
  "dramatic-action": { label: "אקשן דרמטי", description: "תנוחת אקשן מוגזמת" },
  "biting-lip": { label: "נשיכת שפה", description: "נשיכת שפה קלה ושובבה" },
  "mid-laugh": { label: "באמצע צחוק", description: "רגע באמצע צחוק, הראש לאחור" },
  "pointing-at-camera": { label: "הצבעה על המצלמה", description: "אצבע מופנית ישר אל המצלמה" },
  "tongue-out": { label: "לשון בחוץ", description: "הוצאת לשון שובבה" },
  "thinking": { label: "הרהור", description: "יד על הסנטר, מבט מהורהר" },

  // Resting
  "lying-down": { label: "שכיבה", description: "שכיבה ישרה" },
  "sleeping": { label: "שינה", description: "עיניים עצומות, בשינה" },
  "hugging": { label: "חיבוק", description: "חיבוק עם אדם אחר" },
  "looking-away": { label: "מבט הצידה", description: "ראש מופנה, מבט הצידה" },
  "looking-up": { label: "מבט למעלה", description: "מבט אל השמיים" },
  "looking-down": { label: "מבט למטה", description: "מבט מושפל" },
  "head-over-shoulder": { label: "מבט מעבר לכתף", description: "מבט לאחור מעבר לכתף" },
  "wading-in-water": { label: "הליכה במים", description: "הליכה במים בגובה אמצע הירך" },

  // Hand Position
  "hands-in-pockets": { label: "ידיים בכיסים", description: "שתי הידיים תחובות בכיסים" },
  "hand-on-hip": { label: "יד על המותן", description: "יד אחת על המותן" },
  "hand-position-hands-on-hips": { label: "ידיים על המותניים", description: "שתי הידיים על המותניים" },
  "hand-on-chin": { label: "יד על הסנטר", description: "יד נשענת מתחת לסנטר" },
  "hand-on-collarbone": { label: "יד על עצם הבריח", description: "יד נשענת על עצם הבריח" },
  "hand-brushing-hair": { label: "העברת יד בשיער", description: "יד עוברת בשיער" },
  "finger-to-lip": { label: "אצבע על השפה", description: "קצה האצבע צמוד לשפה התחתונה" },
  "arms-wrapped-around-self": { label: "זרועות סביב הגוף", description: "חיבוק עצמי, ידיים סביב הגוף" },
  "hands-clasped": { label: "ידיים שלובות", description: "שתי הידיים שלובות לפני הגוף" },

  // Body Lean
  "leaning-back": { label: "הישענות לאחור", description: "גוף נשען מעט לאחור" },
  "leaning-forward": { label: "רכינה קדימה", description: "גוף רוכן לעבר המצלמה" },
  "body-lean-contrapposto": { label: "Contrapposto", description: "משקל על רגל אחת, מותן מוטה החוצה" },
  "arched-back": { label: "גב מקושת", description: "גב מקושת בעדינות, חזה קדימה" },
  "shoulder-rolled-forward": { label: "כתף מוטה קדימה", description: "כתף אחת מוטה קדימה" },

  // Head Tilt
  "tilted-up": { label: "מוטה למעלה", description: "ראש מוטה מעט מעלה" },
  "tilted-down": { label: "מוטה למטה", description: "ראש מוטה מעט מטה" },
  "tilted-side": { label: "מוטה הצידה", description: "ראש מוטה לעבר הכתף" },
  "tilted-back": { label: "מוטה לאחור", description: "ראש לאחור עד הסוף, גרון חשוף" },
  "chin-up": { label: "סנטר למעלה", description: "סנטר מורם, מבט מלמעלה למטה" },
  "chin-tucked": { label: "סנטר למטה", description: "סנטר אסוף לעבר החזה" },

  // Activity
  "activity-smoking": { label: "עישון", description: "עישון סיגריה" },
  "activity-drinking": { label: "שתייה", description: "שתייה מכוס או מספל" },
  "activity-eating": { label: "אכילה", description: "רגע באמצע נגיסה" },
  "activity-talking-on-phone": { label: "שיחה בטלפון", description: "טלפון צמוד לאוזן, באמצע שיחה" },
  "activity-texting": { label: "הקלדת הודעה", description: "מבט מושפל אל הטלפון, האגודלים מקלידים" },
  "activity-typing-laptop": { label: "הקלדה על לפטופ", description: "ידיים על המקלדת, מבט מרוכז במסך" },
  "activity-reading": { label: "קריאה", description: "ספר או מגזין פתוח ביד" },
  "activity-writing": { label: "כתיבה", description: "כתיבה בעט במחברת" },
  "activity-painting": { label: "ציור", description: "ציור במכחול על קנבס" },
  "activity-playing-instrument": { label: "נגינה", description: "נגינה בכלי נגינה" },
  "activity-cooking": { label: "בישול", description: "בישול על השיש או על הכיריים" },
  "activity-driving": { label: "נהיגה", description: "מאחורי ההגה, הידיים אוחזות בו" },
}

export default map
