import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto": { label: "אוטומטי", description: "המודל בוחר את האפקט המתאים" },
  "none": { label: "כלום", description: "ללא אפקט על הדמות" },
  "werewolf": { label: "אדם-זאב", description: "מתגלגל לאדם-זאב" },
  "vampire": { label: "ערפד", description: "מתגלגל לערפד" },
  "cyborg": { label: "חשיפת קיבורג", description: "העור נפתח וחושף מכניקה קיברנטית" },
  "ghost-form": { label: "צורת רוח", description: "הגוף הופך שקוף ואתרי" },
  "statue-stone": { label: "הפיכה לאבן", description: "הגוף מתאבן לפסל אבן" },
  "liquid-metal": { label: "מתכת נוזלית", description: "הופך למתכת כרום נוזלית (סגנון T-1000)" },
  "animalization": { label: "הפיכה לחיה", description: "מתגלגל לחיה" },
  "gorilla-form": { label: "צורת גורילה", description: "מתגלגל לגורילה מסיבית" },
  "mystification": { label: "שינוי מאגי", description: "הילה קסומה עוטפת ומשנה את הדמות" },
  "gas-form": { label: "התפזרות לגז", description: "הגוף מתמוסס לענן גז" },
  "diamond-skin": { label: "עור יהלום", description: "הגוף מתגבש לפאות יהלום" },
  "agent-reveal": { label: "חשיפת סוכן", description: "חליפה ומשקפי שמש מגיחים על הדמות" },

  // ── Power ──
  "fire-breathe": { label: "נשיפת אש", description: "פולט סילון אש מתמשך" },
  "ice-breathe": { label: "נשיפת קרח", description: "פולט זרם אוויר קפוא" },
  "air-bending": { label: "כיפוף אוויר", description: "שולט במערבולת רוח נראית" },
  "water-bending": { label: "כיפוף מים", description: "מניפולציה על סרט של מים בתנועות" },
  "earth-bending": { label: "כיפוף אדמה", description: "מרים לוחות אבן מהאדמה" },
  "lightning-hands": { label: "ברקים מהידיים", description: "קשתות חשמליות פורצות מהידיים" },
  "levitation": { label: "ריחוף", description: "מתרומם מהאדמה, הגוף אנכי או אופקי" },
  "telekinesis": { label: "טלקינזיה", description: "חפצים קרובים צפים ומקיפים את הדמות" },
  "invisibility": { label: "אי-נראות", description: "הגוף הופך שקוף ובלתי נראה" },
  "hero-flight": { label: "טיסת גיבור", description: "מתנתק לשמיים בתנוחת טיסת גיבור" },
  "super-speed": { label: "מהירות-על", description: "מתנועע במהירות-על עם צלליות מרובות" },
  "soul-departure": { label: "יציאת נשמה", description: "נשמה שקופה עולה מהגוף" },

  // ── Body-Mod ──
  "wings-grow": { label: "גידול כנפיים", description: "כנפיים צומחות ומתפרשות מהגב" },
  "horns-grow": { label: "צמיחת קרניים", description: "קרניים בולטות מהראש" },
  "tail-emerge": { label: "הופעת זנב", description: "זנב מתארך מבסיס עמוד השדרה" },
  "tentacles-emerge": { label: "הופעת זרועות", description: "זרועות מתפתלות יוצאות מהגב" },
  "extra-eyes": { label: "פקיחת עיניים נוספות", description: "עיניים נוספות נפתחות ברחבי הפנים והגוף" },
  "head-explode": { label: "התפוצצות ראש", description: "הראש מתפוצץ לחלקיקים מופשטים (PG-13)" },
  "head-off": { label: "הסרת ראש", description: "הראש מתנתק וצף (סטייליזד, ללא דם)" },
  "spiders-from-mouth": { label: "עכבישים מהפה", description: "עכבישים זוחלים מהפה הפתוח (אימה)" },
  "skin-surge": { label: "גל בעור", description: "העור מתנדנד כאילו משהו זז מתחתיו" },

  // ── Face-Expression ──
  "horror-face": { label: "פרצוף אימה", description: "הפנים מתעוותות בהבעת אימה" },
  "oni-mask": { label: "מסכת אוני", description: "מסכת שד אדומה-זהובה מגיחה על הפנים" },
  "glowing-eyes": { label: "עיניים זוהרות", description: "העיניים מאירות בזוהר פנימי" },
  "floral-eyes": { label: "עיניים פרחוניות", description: "פרחים צומחים מחורי העיניים" },
  "bloom-mouth": { label: "פה פורח", description: "פרחים פורחים מהפה הפתוח" },
  "x-ray": { label: "חשיפת רנטגן", description: "הגוף הופך שקוף וחושף שלד" },
  "agent-snap": { label: "הצמדת משקפי שמש", description: "משקפי שמש מגיחים על עיני הדמות" },
  "visor-x": { label: "ויזור סייבר", description: "ויזור קיברנטי עתידני מתגבש על הפנים" },

  // ── Aura-Ambient ──
  "paparazzi": { label: "הבזקי פפראצי", description: "הבזקי מצלמה מתפרצים סביב הדמות" },
  "money-rain": { label: "גשם כסף", description: "שטרות כסף גשמים סביב הדמות" },
  "color-rain": { label: "גשם צבעוני", description: "טיפות גשם עזות צבע מסביב לדמות" },
  "saint-glow": { label: "זוהר קדוש", description: "הילה זהובה ואור שמימי מקיפים את הדמות" },
  "fire-aura": { label: "הילת אש", description: "להבות מלקקות את גוף הדמות" },
  "frost-aura": { label: "הילת כפור", description: "כפור וקרח מוקרנים מהדמות" },
  "shadow-aura": { label: "הילת צל", description: "גידולי צל אפלים מתפתלים סביב הדמות" },
  "electricity-aura": { label: "הילה חשמלית", description: "קשתות חשמל כמגדל טסלה סביב הדמות" },
  "sparkles-around": { label: "ניצוצות קסם", description: "ניצוצות וחלקיקי כוכבים מקיפים את הדמות" },
  "fairies-around": { label: "פיות סביב הדמות", description: "פיות זוהרות קטנות מרפרפות סביב הדמות" },
  "objects-orbit": { label: "עצמים במסלול", description: "עצמים קטנים צפים ומקיפים את הדמות" },
  "petals-around": { label: "עלי כותרת סביב הדמות", description: "עלי כותרת ורדי דובדבן מתרחפים סביב הדמות" },
  "glow-trace": { label: "שובל זוהר", description: "שבילי אור עוקבים אחרי תנועת הדמות" },
  "tattoo-animation": { label: "הנפשת קעקועים", description: "הקעקועים מאירים ומתנועעים על העור" },
}

export default map
