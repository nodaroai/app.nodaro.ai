import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "auto": { label: "אוטומטי", description: "המודל בוחר תנועת מצלמה מתאימה" },
  "static": { label: "סטטי", description: "מצלמה קבועה, ללא תנועה" },
  "handheld": { label: "מצלמת יד", description: "רעידת יד טבעית" },
  "steadicam": { label: "Steadicam", description: "צילום הליכה חלק ומיוצב" },

  "pan-left": { label: "Pan שמאלה", description: "סיבוב המצלמה אופקית שמאלה" },
  "pan-right": { label: "Pan ימינה", description: "סיבוב המצלמה אופקית ימינה" },
  "whip-pan-left": { label: "Whip Pan שמאלה", description: "Whip Pan מהיר שמאלה עם טשטוש תנועה" },
  "whip-pan-right": { label: "Whip Pan ימינה", description: "Whip Pan מהיר ימינה עם טשטוש תנועה" },

  "tilt-up": { label: "Tilt למעלה", description: "הטיית המצלמה כלפי מעלה" },
  "tilt-down": { label: "Tilt למטה", description: "הטיית המצלמה כלפי מטה" },

  "zoom-in": { label: "Zoom In", description: "זום אופטי לעבר הסובייקט" },
  "zoom-out": { label: "Zoom Out", description: "זום אופטי הרחק מהסובייקט" },
  "crash-zoom-in": { label: "Crash Zoom In", description: "Zoom in מהיר בסגנון whip" },
  "crash-zoom-out": { label: "Crash Zoom Out", description: "Zoom out מהיר בסגנון whip" },

  "dolly-in": { label: "Dolly In", description: "דחיפת המצלמה לעבר הסובייקט (פרלקסה)" },
  "dolly-out": { label: "Dolly Out", description: "משיכת המצלמה לאחור (פרלקסה)" },
  "dolly-zoom": { label: "Dolly Zoom", description: "אפקט ורטיגו: ה־dolly נע נגד כיוון הזום" },
  "push-in": { label: "Push In", description: "דחיפה מהירה ונמרצת לעבר הסובייקט" },
  "pull-out": { label: "Pull Out", description: "משיכה מהירה ונמרצת מהסובייקט" },
  "breathing": { label: "מצלמה נושמת", description: "תנודה עדינה ורציפה של push-in / pull-out, תחושת handheld אורגנית" },
  "push-pull": { label: "Push-Pull / נדנוד", description: "המצלמה מתקרבת לסובייקט ומתרחקת ממנו בתנועת נדנוד" },
  "creep-in": { label: "Creep-In", description: "Push-in איטי, כמעט בלתי מורגש, שבונה אימה או מתח" },
  "creep-out": { label: "Creep-Out", description: "Pull-out איטי, כמעט בלתי מורגש, שמבודד את הסובייקט במרחב" },

  "truck-left": { label: "Truck שמאלה", description: "החלקת גוף המצלמה לרוחב שמאלה" },
  "truck-right": { label: "Truck ימינה", description: "החלקת גוף המצלמה לרוחב ימינה" },

  "pedestal-up": { label: "Pedestal למעלה", description: "הרמת גוף המצלמה אנכית" },
  "pedestal-down": { label: "Pedestal למטה", description: "הורדת גוף המצלמה אנכית" },

  "roll-left": { label: "Roll שמאלה", description: "סיבוב המצלמה נגד כיוון השעון" },
  "roll-right": { label: "Roll ימינה", description: "סיבוב המצלמה עם כיוון השעון" },
  "dutch-angle": { label: "זווית הולנדית", description: "פריים מוטה סטטי ליצירת מתח" },

  "orbit-left": { label: "Orbit שמאלה", description: "הקפה חלקית רחבה סביב הסובייקט שמאלה" },
  "orbit-right": { label: "Orbit ימינה", description: "הקפה חלקית רחבה סביב הסובייקט ימינה" },
  "spin-360": { label: "סיבוב מלא 360°", description: "המצלמה מסתובבת 360 מעלות מלאות סביב צירה" },
  "orbit-360": { label: "Orbit מלא 360°", description: "המצלמה מתארת קשת מלאה של 360 מעלות סביב הסובייקט" },
  "arc-left": { label: "Arc שמאלה", description: "קשת חלקית סביב הסובייקט שמאלה" },
  "arc-right": { label: "Arc ימינה", description: "קשת חלקית סביב הסובייקט ימינה" },

  "crane-up": { label: "Crane למעלה", description: "עליית crane סוחפת שחושפת את הסצנה" },
  "crane-down": { label: "Crane למטה", description: "ירידת crane סוחפת" },
  "boom-up": { label: "Boom למעלה", description: "עליית זרוע boom" },
  "boom-down": { label: "Boom למטה", description: "ירידת זרוע boom" },

  "tracking-shot": { label: "Tracking Shot", description: "המצלמה נעה לצד סובייקט בתנועה ועוקבת אחריו" },
  "follow": { label: "מעקב", description: "מעקב אחר הסובייקט מאחור" },
  "lead": { label: "הובלה", description: "המצלמה נעה לפני הסובייקט בזמן שהוא מתקדם" },
  "drone-follow": { label: "מעקב רחפן", description: "רחפן עוקב אחרי הסובייקט מגובה" },
  "dolly-track": { label: "Dolly Track", description: "Dolly על מסילה מקבילה לצד הסובייקט" },
  "gimbal-walk": { label: "הליכה עם Gimbal", description: "צילום הליכה חלק על gimbal תלת־צירי, תנועה קדימה יציבה ומרחפת" },
  "ronin-glide": { label: "Ronin Glide", description: "תנועת החלקה איטית על gimbal Ronin / Movi, ריחוף קולנועי ללא רעידות" },
  "serpentine": { label: "מסלול מתפתל", description: "המצלמה מתפתלת בין מכשולים בעיקולי S תוך כדי תנועה קדימה" },

  "pov": { label: "POV", description: "נקודת מבט גוף ראשון" },
  "over-the-shoulder": { label: "מעבר לכתף", description: "צילום מעבר לכתף של דמות" },
  "birds-eye": { label: "מבט ממעוף הציפור", description: "מבט ישר מלמעלה למטה" },
  "worms-eye": { label: "זווית צפרדע", description: "זווית נמוכה במיוחד, מבט כלפי מעלה" },
  "aerial": { label: "אווירי", description: "צילום בגובה רב בסגנון רחפן" },
  "helicopter": { label: "מסוק", description: "צילום אווירי רחב וסוחף מגובה רב" },
  "fly-over": { label: "טיסה מעל הסצנה", description: "מעבר אווירי נמוך ומהיר מעל הסצנה" },
  "flythrough": { label: "טיסה דרך המרחב", description: "המצלמה טסה ועוברת דרך המרחב" },
  "reveal": { label: "חשיפה", description: "חשיפה הדרגתית של סצנה רחבה יותר" },
  "snorricam": { label: "Snorricam", description: "מצלמה מחוברת לגוף (הסובייקט נעול בפריים)" },
  "rack-focus": { label: "Rack Focus", description: "משיכת פוקוס בין החזית לרקע" },

  "handheld-vlog": { label: "Vlog במצלמת יד", description: "מצלמת יד קז׳ואל בסגנון vlog" },
  "pov-walk": { label: "הליכה ב־POV", description: "הליכה מנקודת מבט של גוף ראשון" },
  "velocity-edit": { label: "Velocity Edit", description: "קצב Speed-ramp של TikTok" },
  "match-cut-zoom": { label: "Match Cut Zoom", description: "Zoom מהיר עם חיתוך חד לצורה תואמת" },
  "screen-tap": { label: "נקישה על המסך", description: "מעבר עם נקישת אצבע על המסך" },
  "phone-flip": { label: "היפוך טלפון", description: "היפוך מצלמה קדמית/אחורית" },
  // Location-studio extension (PR #2505 follow-up)
  "gentle-drift": { label: "סחיפה עדינה", description: "תנועת ריחוף איטית ואווירתית" },
  "parallax": { label: "פרלקסה", description: "תנועה צידית עם הפרדת עומק בין חזית לרקע" },
}

export default map
