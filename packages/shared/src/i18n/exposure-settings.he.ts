import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "aperture-f1-2": { description: "DOF דק כתער, בוקה חולמני" },
  "aperture-f1-4": { description: "בידוד אגרסיבי של הסובייקט" },
  "aperture-f1-8": { description: "הפרדת פורטרט קלאסית" },
  "aperture-f2-8": { description: "סובייקט חד, רקע רך" },
  "aperture-f4": { description: "DOF יומיומי מאוזן" },
  "aperture-f5-6": { description: "חד לאורך הסובייקט" },
  "aperture-f8": { description: "חדות נקודה מתוקה" },
  "aperture-f11": { description: "DOF נופי עמוק" },
  "aperture-f16": { description: "Hyperfocal, כוכבי שמש" },

  "shutter-1-30": { label: "1/30 (טשטוש יד)", description: "רמז של תנועה של מצלמת יד" },
  "shutter-1-60": { description: "מהירות תריס יומיומית סטנדרטית" },
  "shutter-1-200": { description: "חד על רוב הסובייקטים" },
  "shutter-1-500": { description: "חד על אקשן מהיר" },
  "shutter-1-1000": { label: "1/1000 (הקפאת אקשן)", description: "ספורט/חיות בר קפואים" },
  "shutter-long-1s": { label: "חשיפה ארוכה (1s)", description: "פסים ושבילי תנועה" },

  "iso-100": { label: "ISO 100 (נקי)", description: "רעש מינימלי, גרגירים דקים" },
  "iso-400": { description: "טקסטורה קלה, ISO יומיומי" },
  "iso-800": { description: "גרגירים נראים אך נעימים" },
  "iso-1600": { label: "ISO 1600 (גרגירים נראים)", description: "טקסטורת אור נמוך אדיטוריאלית" },
  "iso-3200": { label: "ISO 3200 (גרגירים כבדים)", description: "מורחק, מראה דוקומנטרי גס" },
}

export default map
