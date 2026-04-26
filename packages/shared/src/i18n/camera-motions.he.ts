import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "auto": { label: "אוטומטי", description: "תן למודל לבחור תנועת מצלמה מתאימה" },
  "static": { label: "סטטי", description: "מצלמה קבועה, ללא תנועה" },
  "handheld": { label: "מצלמת יד", description: "רעידת יד טבעית" },
  "steadicam": { label: "Steadicam", description: "צילום הליכה חלק ומיוצב" },

  "pan-left": { label: "Pan שמאלה", description: "סובב מצלמה אופקית שמאלה" },
  "pan-right": { label: "Pan ימינה", description: "סובב מצלמה אופקית ימינה" },
  "whip-pan-left": { label: "Whip Pan שמאלה", description: "Whip Pan מהיר שמאלה עם טשטוש תנועה" },
  "whip-pan-right": { label: "Whip Pan ימינה", description: "Whip Pan מהיר ימינה עם טשטוש תנועה" },

  "tilt-up": { label: "Tilt למעלה", description: "הטה מצלמה כלפי מעלה" },
  "tilt-down": { label: "Tilt למטה", description: "הטה מצלמה כלפי מטה" },

  "zoom-in": { label: "Zoom In", description: "Zoom של עדשה לכיוון הסובייקט" },
  "zoom-out": { label: "Zoom Out", description: "Zoom של עדשה הרחק מהסובייקט" },
  "crash-zoom-in": { label: "Crash Zoom In", description: "Zoom in מהיר בסגנון whip" },
  "crash-zoom-out": { label: "Crash Zoom Out", description: "Zoom out מהיר בסגנון whip" },

  "dolly-in": { label: "Dolly In", description: "דחף מצלמה לעבר הסובייקט (פרלקסה)" },
  "dolly-out": { label: "Dolly Out", description: "משוך מצלמה הרחק (פרלקסה)" },
  "dolly-zoom": { label: "Dolly Zoom", description: "אפקט ורטיגו: dolly מנוגד ל-zoom" },
  "push-in": { label: "Push In", description: "דחיפה איטית עדינה לעבר הסובייקט" },
  "pull-out": { label: "Pull Out", description: "משיכה איטית עדינה מהסובייקט" },
  "breathing": { label: "מצלמה נושמת", description: "תנודה עדינה ורציפה של push-in / pull-out, תחושת handheld אורגנית" },
  "push-pull": { label: "Push-Pull / נדנוד", description: "המצלמה נעה לעבר הסובייקט וחזרה אחורה, גישה והתרחקות מתנדנדות" },
  "creep-in": { label: "Creep-In", description: "Push-in איטי באופן בלתי מורגש, בונה אימה או מתח" },
  "creep-out": { label: "Creep-Out", description: "Pull-out איטי באופן בלתי מורגש, מבודד את הסובייקט במרחב" },

  "truck-left": { label: "Truck שמאלה", description: "החלק את גוף המצלמה לרוחב שמאלה" },
  "truck-right": { label: "Truck ימינה", description: "החלק את גוף המצלמה לרוחב ימינה" },

  "pedestal-up": { label: "Pedestal למעלה", description: "הרם את גוף המצלמה אנכית" },
  "pedestal-down": { label: "Pedestal למטה", description: "הורד את גוף המצלמה אנכית" },

  "roll-left": { label: "Roll שמאלה", description: "סובב מצלמה נגד כיוון השעון" },
  "roll-right": { label: "Roll ימינה", description: "סובב מצלמה עם כיוון השעון" },
  "dutch-angle": { label: "Dutch Angle", description: "פריים מוטה סטטי ליצירת מתח" },

  "orbit-left": { label: "Orbit שמאלה", description: "מעגל שלם סביב הסובייקט שמאלה" },
  "orbit-right": { label: "Orbit ימינה", description: "מעגל שלם סביב הסובייקט ימינה" },
  "spin-360": { label: "סיבוב מלא 360°", description: "המצלמה מסתובבת 360 מעלות מלאות סביב צירה" },
  "orbit-360": { label: "Orbit מלא 360°", description: "המצלמה מתארת קשת מלאה של 360 מעלות סביב הסובייקט" },
  "arc-left": { label: "Arc שמאלה", description: "קשת חלקית סביב הסובייקט שמאלה" },
  "arc-right": { label: "Arc ימינה", description: "קשת חלקית סביב הסובייקט ימינה" },

  "crane-up": { label: "Crane למעלה", description: "עליית crane סוחפת חושפת סצנה" },
  "crane-down": { label: "Crane למטה", description: "ירידת crane סוחפת" },
  "boom-up": { label: "Boom למעלה", description: "עליית זרוע boom" },
  "boom-down": { label: "Boom למטה", description: "ירידת זרוע boom" },

  "tracking-shot": { label: "Tracking Shot", description: "מצלמה עוקבת אחרי סובייקט נע לצדו" },
  "follow": { label: "מעקב", description: "עקוב אחר סובייקט מאחור" },
  "lead": { label: "הובלה", description: "נוע לפני סובייקט מתקדם" },
  "drone-follow": { label: "מעקב רחפן", description: "מעקב רחפן מורם אחרי הסובייקט" },
  "dolly-track": { label: "Dolly Track", description: "Dolly על מסילה מקבילה לצד הסובייקט" },
  "gimbal-walk": { label: "הליכה עם Gimbal", description: "צילום הליכה חלק על gimbal תלת-צירי, תנועה קדימה יציבה ומרחפת" },
  "ronin-glide": { label: "Ronin Glide", description: "תנועת החלקה איטית על gimbal Ronin / Movi, ריחוף קולנועי ללא רעידות" },
  "serpentine": { label: "מסלול נחשי", description: "המצלמה מתפתלת בין מכשולים בעקומות S, מסלול קדימה מתעקל" },

  "pov": { label: "POV", description: "נקודת מבט גוף ראשון" },
  "over-the-shoulder": { label: "מעל הכתף", description: "מסגר מעבר לכתף של דמות" },
  "birds-eye": { label: "מבט ציפור", description: "מבט עליון ישיר מלמעלה" },
  "worms-eye": { label: "מבט תולעת", description: "זווית נמוכה קיצונית הצופה למעלה" },
  "aerial": { label: "אווירי", description: "צילום מסגנון רחפן בגובה רב" },
  "helicopter": { label: "מסוק", description: "צילום אווירי רחב סוחף בגובה רב" },
  "fly-over": { label: "מעבר טיסה", description: "מעבר אווירי נמוך ומהיר מעל הסצנה" },
  "flythrough": { label: "מעוף-דרך", description: "מצלמה טסה דרך החלל" },
  "reveal": { label: "חשיפה", description: "חשוף בהדרגה סצנה רחבה יותר" },
  "snorricam": { label: "Snorricam", description: "מצלמה מורכבת על הגוף (סובייקט נעול לפריים)" },
  "rack-focus": { label: "Rack Focus", description: "משוך פוקוס בין קדמה לרקע" },

  "handheld-vlog": { label: "Vlog יד", description: "מצלמת יד קז'ואל בסגנון vlog" },
  "pov-walk": { label: "POV הליכה", description: "POV הליכה בגוף ראשון" },
  "velocity-edit": { label: "Velocity Edit", description: "קצב Speed-ramp של TikTok" },
  "match-cut-zoom": { label: "Match Cut Zoom", description: "Zoom בקצב לחיתוכים" },
  "screen-tap": { label: "Screen Tap", description: "מעבר עם נקישת אצבע על המסך" },
  "phone-flip": { label: "היפוך טלפון", description: "היפוך מצלמה קדמית/אחורית" },
}

export default map
