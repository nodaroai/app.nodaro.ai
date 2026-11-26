import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "זמן אמת", description: "מהירות ניגון רגילה" },
  "slow-motion": { label: "הילוך איטי", description: "האטה מתונה" },
  "super-slow-mo": { label: "הילוך איטי במיוחד", description: "צילום איטי במיוחד" },
  "time-lapse": { label: "Time-lapse", description: "זמן דחוס, מעבר מהיר" },
  "hyper-lapse": { label: "Hyper-lapse", description: "Time-lapse בתנועה" },
  "speed-ramp": { label: "Speed Ramp", description: "שינוי מהירות דינמי באמצע השוט" },

  // Freeze
  "full-freeze": { label: "הקפאת פריים מלאה", description: "כל התנועה קפואה" },
  "bullet-time": { label: "Bullet Time", description: "סובייקט קפוא, מצלמה מקיפה" },
  "frozen-subject": { label: "סובייקט קפוא", description: "סובייקט קפוא, עולם נע" },
  "moving-subject": { label: "סובייקט נע", description: "סובייקט נע, עולם קפוא" },

  // Direction
  "forward": { label: "קדימה", description: "ניגון קדימה רגיל" },
  "reverse": { label: "הרצה לאחור", description: "הזמן רץ לאחור" },
  "loop-boomerang": { label: "לופ / בומרנג", description: "קדימה ואז לאחור" },

  // Shutter
  "long-exposure": { label: "חשיפה ארוכה", description: "שובלי תנועה ופסי אור" },
  "crisp-shutter": { label: "תריס מהיר", description: "תנועה חדה, ללא טשטוש" },
  "motion-blur": { label: "טשטוש תנועה", description: "טשטוש כיווני בולט" },
  "stutter-strobe": { label: "קיטוע / סטרובו", description: "תנועה קופצנית בסגנון סטרובוסקופ" },
  "stop-motion": { label: "סטופ־מושן", description: "תנועה מקוטעת, פריים אחר פריים" },
}

export default map
