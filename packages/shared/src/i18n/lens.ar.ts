import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { label: "عريضة جدا (14mm)", description: "زاوية عريضة جدا، منظور مبالغ فيه" },
  "wide-24mm": { label: "عريضة (24mm)", description: "حقل رؤية واسع، بيئي" },
  "standard-35mm": { label: "قياسية (35mm)", description: "منظور طبيعي، إحساس وثائقي" },
  "normal-50mm": { label: "عادية (50mm)", description: "الأقرب لإدراك العين البشرية" },
  "portrait-85mm": { label: "بورتريه (85mm)", description: "ضغط مغر، بوكيه كريمي" },
  "telephoto-135mm": { label: "تيليفوتو (135mm)", description: "عمق مضغوط، موضوع معزول" },
  "super-telephoto-400mm": { label: "تيليفوتو فائقة (400mm)", description: "ضغط شديد، موضوع بعيد" },
  "fisheye": { label: "عين السمكة", description: "تشويه نصف كروي 180°" },
  "anamorphic": { label: "Anamorphic", description: "سينمائية عريضة، بوكيه بيضوي" },
  "macro": { label: "ماكرو", description: "تقريب فائق لتفاصيل صغيرة" },
  "tilt-shift": { label: "Tilt-shift", description: "تركيز انتقائي، تأثير مصغر" },
  "shallow-dof": { label: "عمق ميدان رفيع", description: "تركيز رفيع كالموس، بوكيه حالم" },
  "canon-k35": { description: "سينمائية قديمة، بشرة دافئة لطيفة" },
  "cooke-s4": { description: "مظهر Cooke — بشرة كريمية رسامية" },
  "helios-44": { description: "بوكيه دوامة سوفيتي قديم" },
  "petzval": { description: "دوامة قديمة جدا، تلاشي درامي" },
  "probe": { label: "عدسة المسبار", description: "ماكرو أنبوبي — عبر الفتحات والمساحات الضيقة" },
  "cctv": { label: "كاميرا مراقبة", description: "مظهر لقطات كاميرات المراقبة" },
}

export default map
