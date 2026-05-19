import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto": { label: "تلقائي", description: "يختار النموذج التأثير المناسب" },
  "none": { label: "لا شيء", description: "بدون تأثير على الشخصية" },
  "werewolf": { label: "مستذئب", description: "يتحول إلى مستذئب" },
  "vampire": { label: "مصاص دماء", description: "يتحول إلى مصاص دماء" },
  "cyborg": { label: "كشف السايبورغ", description: "الجلد ينفتح ليكشف التحسينات الإلكترونية" },
  "ghost-form": { label: "شكل الشبح", description: "الجسم يصبح شفافاً وأثيرياً" },
  "statue-stone": { label: "تحجر", description: "الجسم يتحول إلى تمثال حجري" },
  "liquid-metal": { label: "معدن سائل", description: "يتحول إلى معدن كروم سائل (بأسلوب T-1000)" },
  "animalization": { label: "تحول حيواني", description: "يتحول إلى حيوان" },
  "gorilla-form": { label: "شكل الغوريلا", description: "يتحول إلى غوريلا ضخمة" },
  "mystification": { label: "تحول سحري", description: "هالة سحرية تحيط وتحول الشخصية" },
  "gas-form": { label: "تحول غازي", description: "الجسم يتبدد إلى غيمة من الغاز" },
  "diamond-skin": { label: "جلد الماس", description: "الجسم يتبلور إلى وجوه ماسية" },
  "agent-reveal": { label: "كشف العميل", description: "بدلة ونظارات تظهر على الشخصية" },

  // ── Power ──
  "fire-breathe": { label: "تنفس النار", description: "يتنفس نفاثة مستمرة من اللهب" },
  "ice-breathe": { label: "تنفس الجليد", description: "يتنفس تيار هواء جليدي متجمد" },
  "air-bending": { label: "تحريك الهواء", description: "يتحكم في دوامة مرئية من الرياح" },
  "water-bending": { label: "تحريك الماء", description: "يتحكم في شريط من الماء بالإيماءات" },
  "earth-bending": { label: "تحريك الأرض", description: "يرفع ألواحاً حجرية من الأرض" },
  "lightning-hands": { label: "أقواس كهربائية", description: "أقواس كهربائية تتفجر من يديه" },
  "levitation": { label: "تحليق", description: "يرتفع عن الأرض، الجسم رأسي أو أفقي" },
  "telekinesis": { label: "الحركة عن بُعد", description: "الأجسام القريبة تطفو وتدور حوله" },
  "invisibility": { label: "الاختفاء", description: "الجسم يتلاشى إلى شفافية" },
  "hero-flight": { label: "طيران البطل", description: "ينطلق إلى السماء بوضعية الطيران البطولية" },
  "super-speed": { label: "سرعة فائقة", description: "يتحرك بسرعة خارقة مع ظلال متعددة" },
  "soul-departure": { label: "خروج الروح", description: "روح شفافة تخرج من جسده" },

  // ── Body-Mod ──
  "wings-grow": { label: "نمو الأجنحة", description: "أجنحة تنبثق وتنتشر من الظهر" },
  "horns-grow": { label: "بروز القرون", description: "قرون تخرج من الرأس" },
  "tail-emerge": { label: "ظهور الذيل", description: "ذيل يمتد من قاعدة العمود الفقري" },
  "tentacles-emerge": { label: "ظهور المجسات", description: "مجسات تلتوي وتخرج من الظهر أو الجسد" },
  "extra-eyes": { label: "فتح عيون إضافية", description: "عيون إضافية تفتح عبر الوجه والجسم" },
  "head-explode": { label: "انفجار الرأس", description: "الرأس ينفجر بجسيمات مجردة (مناسب للعموم)" },
  "head-off": { label: "نزع الرأس", description: "الرأس ينفصل ويطفو (مصمم وغير دموي)" },
  "spiders-from-mouth": { label: "عناكب من الفم", description: "عناكب تزحف من الفم المفتوح (رعب)" },
  "skin-surge": { label: "تموج الجلد", description: "الجلد يتموج وكأن شيئاً يتحرك تحته" },

  // ── Face-Expression ──
  "horror-face": { label: "وجه الرعب", description: "الوجه يتشوه في تعبير مرعب" },
  "oni-mask": { label: "قناع الأوني", description: "قناع شيطاني أحمر وذهبي يظهر على الوجه" },
  "glowing-eyes": { label: "عيون متوهجة", description: "العينان تشتعلان بضوء داخلي" },
  "floral-eyes": { label: "عيون زهرية", description: "أزهار تتفتح من محاجر العينين" },
  "bloom-mouth": { label: "فم مزهر", description: "أزهار تتفتح من الفم المفتوح" },
  "x-ray": { label: "كشف بالأشعة السينية", description: "الجسم يكشف هيكله العظمي بأسلوب الأشعة السينية" },
  "agent-snap": { label: "ارتداء النظارات", description: "نظارات شمسية تظهر على عيني الشخصية" },
  "visor-x": { label: "قناع سايبر", description: "قناع إلكتروني مستقبلي يتجسد على الوجه" },

  // ── Aura-Ambient ──
  "paparazzi": { label: "ومضات المصورين", description: "ومضات كاميرات تنطلق حول الشخصية" },
  "money-rain": { label: "مطر الأموال", description: "أوراق نقدية تمطر حول الشخصية" },
  "color-rain": { label: "مطر ملون", description: "قطرات مطر ملونة حول الشخصية" },
  "saint-glow": { label: "هالة القديس", description: "هالة ذهبية وضوء إلهي يشعان حول الشخصية" },
  "fire-aura": { label: "هالة نارية", description: "ألسنة لهب تلتف حول جسد الشخصية" },
  "frost-aura": { label: "هالة جليدية", description: "صقيع وجليد يشعان من الشخصية" },
  "shadow-aura": { label: "هالة الظلام", description: "خيوط ظل داكنة تلتف حول الشخصية" },
  "electricity-aura": { label: "هالة كهربائية", description: "أقواس كهربائية كملفات تيسلا تحيط بالشخصية" },
  "sparkles-around": { label: "بريق سحري", description: "بريق سحري وجسيمات تدور حول الشخصية" },
  "fairies-around": { label: "جنيات حول الشخصية", description: "جنيات متوهجة صغيرة ترفرف حول الشخصية" },
  "objects-orbit": { label: "أجسام تدور في مدار", description: "أجسام صغيرة تطفو وتدور حول الشخصية" },
  "petals-around": { label: "بتلات حول الشخصية", description: "بتلات زهر الكرز تتساقط حول الشخصية" },
  "glow-trace": { label: "أثر ضوئي", description: "مسارات مضيئة تتبع حركة الشخصية" },
  "tattoo-animation": { label: "أنيميشن الوشم", description: "الوشوم تتوهج وتتحرك على الجلد" },
}

export default map
