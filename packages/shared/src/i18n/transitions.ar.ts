import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Standard ──
  "auto": { label: "تلقائي", description: "يختار النموذج الانتقال المناسب" },
  "none": { label: "بلا انتقال / قطع مباشر", description: "تبديل فوري بدون انتقال" },
  "cross-dissolve": { label: "تلاشٍ متقاطع", description: "مزج تدريجي بين اللقطتين" },
  "fade-to-black": { label: "تلاشٍ إلى الأسود", description: "تظلم تدريجي ثم تظهر اللقطة التالية" },
  "fade-to-white": { label: "تلاشٍ إلى الأبيض", description: "توهج حتى الأبيض ثم تظهر اللقطة" },
  "match-cut": { label: "قطع متطابق", description: "تطابق الشكل أو الحركة بين اللقطتين" },
  "smash-cut": { label: "قطع مفاجئ", description: "قطع مفاجئ صارخ بين لقطتين متباينتين" },
  "iris": { label: "قطع قزحي", description: "دائرة تنغلق ثم تنفتح على اللقطة الجديدة" },
  "wipe": { label: "مسح خطي", description: "خط يجتاح الإطار ليكشف اللقطة الجديدة" },
  "roll-transition": { label: "دوران", description: "الإطار يدور 90-180 درجة للانتقال" },
  "seamless-match": { label: "تطابق سلس", description: "قطع خفي يُموَّه بتطابق الحركة واللون" },

  // ── Time ──
  "fast-forward-day-night": { label: "تسريع (نهار ← ليل)", description: "مرور الزمن من النهار إلى الليل في نفس المشهد" },
  "fast-forward-night-day": { label: "تسريع (ليل ← فجر)", description: "مرور الزمن من الليل إلى الفجر في نفس المشهد" },
  "seasonal-shift": { label: "تحول الفصول", description: "نفس المشهد عبر الفصول الأربعة" },
  "aging": { label: "تقدم العمر", description: "الشخص يشيخ أمام الكاميرا" },
  "rewind": { label: "ترجيع", description: "الزمن يعود للخلف، الحركة تُعاد عكسياً" },
  "freeze-frame-jump": { label: "تجميد وقفز", description: "الحركة تتوقف ثم تقفز لحظة أخرى" },
  "weather-shift": { label: "تحول الطقس", description: "نفس المشهد في طقس مختلف" },
  "flashback": { label: "استرجاع", description: "انتقال ذاكرة إلى لحظة ماضية" },

  // ── Element ──
  "dissolve-to-mist": { label: "ذوبان في الضباب", description: "الشخص يتحول لضباب يتلاشى ثم يعود" },
  "water-splash": { label: "رشة ماء", description: "الشخص يتحول لماء يتطاير ثم يتشكّل" },
  "sand-scatter": { label: "تناثر رمل", description: "الشخص يتفتت رملاً وتعصف به الريح" },
  "fire-burnup": { label: "احتراق", description: "الشخص يحترق جمراً ثم يتجمع من جديد" },
  "smoke-puff": { label: "نفخة دخان", description: "الشخص يختفي في دخان ثم يعود" },
  "magic-sparkles": { label: "بريق سحري", description: "تفتت إلى جسيمات متوهجة ثم إعادة تشكّل" },
  "lightning-flash": { label: "ضربة برق", description: "صاعقة تضيء الإطار ويتبدّل المشهد" },
  "ink-splash": { label: "رشة حبر", description: "حبر يغطي الإطار ثم ينكشف المشهد الجديد" },
  "sand-storm": { label: "عاصفة رملية", description: "عاصفة تبتلع الإطار ويتغير المشهد خلفها" },
  "paint-splash": { label: "رشة طلاء", description: "طلاء يغطي الإطار ثم يكشف المشهد الجديد" },
  "aurora-sweep": { label: "شفق قطبي", description: "ستارة شفق تجتاح الإطار وتكشف المشهد الجديد" },
  "sakura-petals": { label: "عاصفة زهر الكرز", description: "وابل من بتلات الكرز يغطي الإطار" },
  "garden-bloom": { label: "تفتح الحديقة", description: "أزهار تتفتح وتفتح الستار على المشهد الجديد" },
  "powder-burst": { label: "انفجار مسحوق ملون", description: "سحابة بهار ملونة تنتشر وتكشف المشهد الجديد" },

  // ── Morph ──
  "liquid-morph": { label: "تحول سائل", description: "الموضوع يذوب ويعيد تشكّله كموضوع جديد" },
  "pixelate-reform": { label: "بكسلة وإعادة بناء", description: "بكسلة تتناثر ثم تتجمع كموضوع جديد" },
  "shatter-glass": { label: "تحطم وإعادة بناء", description: "الموضوع يتكسر كالزجاج ثم يتجمع" },
  "origami-fold": { label: "طي أوريغامي", description: "الموضوع يتطوى كورق ثم يكشف الموضوع الجديد" },
  "vortex-swirl": { label: "دوامة", description: "الموضوع يلتف في دوامة ثم ينفك كموضوع جديد" },
  "dream-ripple": { label: "تموج حلم", description: "موجة دائرية تعبر الإطار تكشف المشهد الجديد" },
  "wireframe-morph": { label: "تحول شبكي", description: "الموضوع يتحول إطاراً هندسياً ثم يعيد تشكّله" },
  "polygon-shatter": { label: "تشتت مضلعات", description: "الموضوع يتشظى مضلعات منخفضة ثم يتجمع" },
  "melt-down": { label: "ذوبان وإعادة بناء", description: "الموضوع يذوب كالشمع ثم يصعد من جديد" },

  // ── Portal ──
  "zoom-into-eye": { label: "تكبير في العين", description: "الكاميرا تقترب من البؤبؤ وتدخل عالماً داخله" },
  "zoom-into-mirror": { label: "تكبير في المرآة", description: "الكاميرا تخترق المرآة لعالم الانعكاس" },
  "zoom-into-screen": { label: "تكبير في الشاشة", description: "الكاميرا تخترق شاشة التلفاز أو الهاتف" },
  "zoom-into-book": { label: "تكبير في الكتاب", description: "الكاميرا تدخل إلى رسم في كتاب" },
  "walk-through-door": { label: "المرور عبر باب", description: "الكاميرا تعبر الباب إلى مشهد جديد" },
  "fall-into-hole": { label: "السقوط في فتحة", description: "الكاميرا تسقط في فتحة وتظهر في مشهد جديد" },
  "pull-out-reveal": { label: "سحب للكشف", description: "يكشف أن المشهد كان داخل صورة أو إطار" },
  "zoom-into-mouth": { label: "تكبير في الفم", description: "الكاميرا تدخل الفم لتظهر في عالم جديد" },
  "push-through-glass": { label: "اختراق الزجاج", description: "الكاميرا تخترق لوح زجاج لعالم آخر" },
  "soul-jump": { label: "قفزة الروح", description: "روح شفافة تخرج وتدخل جسداً جديداً" },

  // ── Physics ──
  "explosion-blast": { label: "موجة انفجار", description: "انفجار يجتاح الإطار ويكشف المشهد الجديد" },
  "shockwave": { label: "موجة صدمة", description: "موجة صدمة تشوّه الإطار ويتبدل المشهد" },
  "punch-into-camera": { label: "لكمة للكاميرا", description: "قبضة تضرب العدسة ويتغير المشهد" },
  "debris-shower": { label: "وابل حطام", description: "حطام يعبر الإطار ويتكشف المشهد خلفه" },
  "gravity-flip": { label: "انعكاس الجاذبية", description: "الجاذبية تنعكس والكاميرا تدور 180 درجة" },
  "building-explosion": { label: "انفجار مبنى", description: "منشأة تنفجر والمشهد يُكشف خلف الدخان" },
  "vehicle-explosion": { label: "انفجار مركبة", description: "مركبة تنفجر واللهب يغطي الإطار ثم يُكشف المشهد" },
  "jump-match": { label: "قفزة متطابقة", description: "الشخص يقفز وعند الهبوط يكون في مشهد جديد" },
  "hand-swipe": { label: "مسح اليد", description: "يد تمر أمام العدسة ويتغير المشهد" },

  // ── Light ──
  "white-flash": { label: "وميض أبيض", description: "الإطار يتوهج أبيض ثم يظهر المشهد الجديد" },
  "lens-flare-swipe": { label: "انعكاس العدسة", description: "وهج عدسة أنامورفي يجتاح الإطار" },
  "light-streak": { label: "شعاع ضوء", description: "شعاع ضوء يخترق الإطار ويكشف المشهد الجديد" },
  "color-invert": { label: "وميض عكس الألوان", description: "الألوان تنعكس لحظة والمشهد يتبدل" },
  "sun-glare": { label: "وهج الشمس", description: "وهج شمسي يغمر العدسة ثم يُكشف المشهد" },
  "lens-crack": { label: "تشقق العدسة", description: "العدسة تتشقق والمشهد الجديد يظهر خلفها" },
  "dirty-lens-wipe": { label: "مسح العدسة الملوثة", description: "العدسة يُنظّفها مسح ويكشف المشهد الجديد" },
  "eye-light-burst": { label: "شعاع عين مضيء", description: "شعاع ساطع من عيني الشخص يغطي الإطار" },

  // ── Glitch ──
  "digital-glitch": { label: "خلل رقمي", description: "تشويه رقمي: فصل RGB وتمزق سطور وداتاموش" },
  "vhs-rewind": { label: "ترجيع VHS", description: "تشويه تتبع VHS وإرجاع شريط" },
  "datamosh": { label: "داتاموش", description: "نزيف معاملات الحركة بين اللقطتين" },
  "channel-flip": { label: "تقليب القناة", description: "تشويش تلفزيوني وتقليب القنوات" },
  "hologram-flicker": { label: "وميض هولوجرام", description: "وميض هولوجرام يجسّد المشهد الجديد" },
  "display-wipe": { label: "مسح الشاشة", description: "المشهد يُضغط في شاشة صغيرة ثم تتوسع" },
  "double-exposure": { label: "تعريض مزدوج", description: "لقطتان شفافتان تتراكبان ثم تتلاشى الأولى" },
}

export default map
