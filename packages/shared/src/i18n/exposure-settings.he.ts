import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "aperture-f1-2": { description: "עומק שדה רדוד מאוד, בוקה חלומי" },
  "aperture-f1-4": { description: "בידוד אגרסיבי של הסובייקט" },
  "aperture-f1-8": { description: "הפרדת פורטרט קלאסית" },
  "aperture-f2-8": { description: "סובייקט חד, רקע רך" },
  "aperture-f4": { description: "עומק שדה מאוזן ליומיום" },
  "aperture-f5-6": { description: "חד לאורך הסובייקט" },
  "aperture-f8": { description: "חדות אופטימלית (sweet spot)" },
  "aperture-f11": { description: "עומק שדה רב, כמו בצילומי נוף" },
  "aperture-f16": { description: "מרחק היפרפוקלי, שמש בצורת כוכב" },

  "shutter-1-30": { label: "1/30 (טשטוש יד)", description: "רמז קל לרעידת מצלמה ביד" },
  "shutter-1-60": { description: "מהירות תריס יומיומית סטנדרטית" },
  "shutter-1-200": { description: "חד על רוב הסובייקטים" },
  "shutter-1-500": { description: "חד על אקשן מהיר" },
  "shutter-1-1000": { label: "1/1000 (הקפאת אקשן)", description: "ספורט/חיות בר קפואים" },
  "shutter-long-1s": { label: "חשיפה ארוכה (1s)", description: "פסי אור ושובלי תנועה" },

  "iso-100": { label: "ISO 100 (נקי)", description: "רעש מינימלי, גרגירים דקים" },
  "iso-400": { description: "טקסטורה קלה, ISO יומיומי" },
  "iso-800": { description: "גרגירים נראים אך נעימים" },
  "iso-1600": { label: "ISO 1600 (גרגירים נראים)", description: "טקסטורה אדיטוריאלית בתאורה חלשה" },
  "iso-3200": { label: "ISO 3200 (גרגירים כבדים)", description: "פיתוח push, תחושה דוקומנטרית מחוספסת" },
}

export default map
