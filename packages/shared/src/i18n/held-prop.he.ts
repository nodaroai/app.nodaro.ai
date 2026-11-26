import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "smartphone": { label: "סמארטפון", description: "טלפון מודרני ביד" },
  "smartphone-raised": { label: "טלפון מורם", description: "טלפון מורם באמצע צילום" },
  "polaroid-camera": { label: "מצלמת Polaroid", description: "מצלמה מיידית וינטג'" },
  "vintage-camera": { label: "מצלמה וינטג'", description: "מצלמת פילם ישנה עם רצועה" },
  "dslr-camera": { label: "מצלמת DSLR", description: "מצלמת DSLR או מירורלס מודרנית" },
  "video-camera": { label: "מצלמת וידאו", description: "מצלמת וידאו על הכתף" },
  "microphone": { label: "מיקרופון", description: "מיקרופון יד לשירה" },
  "megaphone": { label: "מגאפון", description: "מגאפון" },
  "smartwatch": { label: "שעון חכם", description: "יד מורמת להצצה בשעון" },

  "coffee-cup": { label: "כוס קפה", description: "כוס קפה קרמית" },
  "takeaway-coffee": { label: "קפה לקחת", description: "כוס נייר של קפה לקחת" },
  "wine-glass": { label: "כוס יין", description: "כוס יין אדום עם רגל" },
  "champagne-flute": { label: "כוס שמפניה", description: "כוס שמפניה גבוהה" },
  "martini-glass": { label: "כוס מרטיני", description: "כוס מרטיני קלאסית" },
  "cocktail-glass": { label: "כוס קוקטייל", description: "כוס נמוכה עם קוקטייל" },
  "beer-bottle": { label: "בקבוק בירה", description: "בקבוק בירה חום" },
  "water-bottle": { label: "בקבוק מים", description: "בקבוק מים רב־פעמי" },

  "cigarette": { label: "סיגריה", description: "סיגריה דלוקה בין האצבעות" },
  "cigar": { label: "סיגר", description: "סיגר עבה דלוק" },
  "vape-pen": { label: "וייפ", description: "וייפ דק בצורת עט" },
  "joint": { label: "ג׳וינט", description: "ג׳וינט מגולגל ביד" },

  "book": { label: "ספר", description: "ספר פתוח בכריכה קשה" },
  "magazine": { label: "מגזין", description: "מגזין מבריק מקופל" },
  "newspaper": { label: "עיתון", description: "עיתון מקופל בפורמט רחב" },
  "notebook": { label: "מחברת", description: "מחברת שורות פתוחה" },
  "pen": { label: "עט", description: "עט באמצע כתיבה" },
  "marker": { label: "טוש", description: "טוש עבה באמצע משיכה" },
  "paintbrush": { label: "מכחול", description: "מכחול טבול בצבע" },
  "chalk": { label: "גיר", description: "מקל גיר לבן" },

  "handbag": { label: "תיק יד", description: "תיק יד מעצבים" },
  "tote-bag": { label: "תיק בד", description: "תיק קנבס רך" },
  "briefcase": { label: "תיק מסמכים", description: "תיק מסמכים קשיח" },
  "umbrella": { label: "מטרייה", description: "מטרייה שחורה פתוחה" },
  "fan-folding": { label: "מניפה מתקפלת", description: "מניפה פתוחה מצוירת ביד" },

  "bouquet": { label: "זר פרחים", description: "זר פרחים מעורב" },
  "single-rose": { label: "ורד יחיד", description: "ורד יחיד עם גבעול ארוך" },
  "sunflower": { label: "חמנייה", description: "חמנייה גבוהה יחידה" },
  "leaf": { label: "עלה", description: "עלה גדול יחיד" },
  "fruit-apple": { label: "תפוח", description: "תפוח טרי יחיד" },

  "guitar": { label: "גיטרה", description: "גיטרה תלויה על הגוף" },
  "violin": { label: "כינור", description: "כינור מתחת לסנטר" },
  "saxophone": { label: "סקסופון", description: "סקסופון מורם לשפתיים" },
  "drumsticks": { label: "מקלות תופים", description: "זוג מקלות תופים מצולבים" },
  "sheet-music": { label: "תווים", description: "תווים מקופלים" },

  "small-dog": { label: "כלב קטן", description: "כלב קטן מוחזק בידיים" },
  "cat": { label: "חתול", description: "חתול שרוע על הזרוע" },
  "plush-toy": { label: "בובה רכה", description: "בובה רכה בחיבוק" },

  "katana": { label: "קטאנה", description: "חרב יפנית עם להב חד־צדדי" },
  "pointer-stick": { label: "מקל מצביע", description: "מקל מצביע טלסקופי" },
  "gavel": { label: "פטיש שופט", description: "פטיש שופט מעץ" },
  "wine-bottle": { label: "בקבוק יין", description: "בקבוק מלא עם עטיפת נייר כסף על הפקק" },
  "parasol": { label: "שמשייה", description: "שמשייה דקורטיבית בסגנון ויקטוריאני או אסייתי" },
  "locket": { label: "מדליון", description: "מדליון וינטג׳ פתוח בין האצבעות" },
  "lighter": { label: "מצית", description: "מצית כרום עם אגודל על הלהבה" },
  "lantern": { label: "עששית", description: "עששית וינטג' עם זוהר ענבר חמים" },
  "flashlight": { label: "פנס", description: "פנס מודרני עם אלומת אור חדה" },
  "compass": { label: "מצפן", description: "מצפן ימי וינטג׳ ביד" },
  "bow-and-arrow": { label: "קשת וחץ", description: "קשת דרוכה עם חץ על המיתר" },
  "shield": { label: "מגן", description: "מגן יד מימי הביניים" },

  // --- picker-gaps 2026-09-01 ---
  "work-gloves": { label: "כפפות עבודה", description: "כפפות עבודה שחוקות מעור, מוחזקות ביד" },
}

export default map
