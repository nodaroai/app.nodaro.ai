import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "35mm-film": { label: "فيلم 35mm", description: "حبيبات سينما كلاسيكية" },
  "16mm-film": { label: "فيلم 16mm", description: "حبيبات إنديه / وثائقية" },
  "super-8": { label: "Super 8", description: "مظهر فيلم 8mm منزلي قديم" },
  "imax-70mm": { label: "IMAX 70mm", description: "وضوح نقي بصيغة كبيرة" },
  "anamorphic-scope": { label: "Anamorphic Scope", description: "مظهر سينما عريض 2.39:1" },

  "arri-alexa": { label: "Arri Alexa", description: "سينما رقمية متميزة" },
  "dslr": { label: "DSLR", description: "مظهر فيديو DSLR واضح" },
  "mirrorless-a7iii": { description: "كاميرا Mirrorless هجينة حديثة" },
  "canon-r5": { description: "Mirrorless تحريرية فاخرة بدقة عالية" },
  "hasselblad-medium-format": { description: "صيغة متوسطة تحريرية" },
  "leica-m-rangefinder": { description: "Rangefinder كلاسيكية 35mm" },
  "voigtlander": { description: "طابع Rangefinder بوتيكي" },
  "fuji-xt4": { description: "ألوان Fuji المحاكية للفيلم" },

  "drone-aerial": { label: "درون (جوي)", description: "تصوير جوي علوي مثبت بـ Gimbal" },
  "gopro-action-cam": { label: "GoPro كاميرا حركة", description: "كاميرا حركة بعدسة عين السمكة العريضة" },

  "webcam-facetime": { label: "ويب كام / FaceTime", description: "مكالمة فيديو منخفضة الدقة" },
  "vhs": { label: "VHS", description: "تشويش الشريط + خطوط مسح" },
  "camcorder": { label: "كاميرا فيديو منزلية", description: "فيديو استهلاكي تسعينياتي" },
  "polaroid": { label: "Polaroid", description: "نغمات فيلم فوري" },
  "fuji-instax": { description: "فيلم فوري حديث" },
  "disposable-camera": { label: "كاميرا للاستخدام الواحد", description: "فيلم تسعينيات / ألفينيات للاستخدام الواحد" },
  "toy-camera-holga": { label: "كاميرا لعبة (Holga)", description: "Holga / Lomo بعدسة بلاستيكية بسيطة" },
  "tintype-wet-plate": { label: "Tintype / Wet Plate", description: "كولوديون لوحة رطبة قديم" },
  "daguerreotype": { label: "داجيروتايب", description: "عملية لوحة فضية من 1840" },
  "security-cam": { label: "كاميرا أمنية (CCTV)", description: "CCTV عين سمكة + ختم وقت" },
  "bw-film": { label: "فيلم أبيض وأسود", description: "مخزون فيلم أبيض وأسود" },
  "iphone": { label: "iPhone", description: "مظهر كاميرا هاتف حديثة" },
}

export default map
