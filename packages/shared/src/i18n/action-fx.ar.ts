import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "هزة أرضية", description: "اهتزاز خفيف للأرض، أشياء معلقة تتأرجح" },
  "earthquake-major": { label: "زلزال كبير", description: "أرض تتشقق، حطام يتساقط" },
  "building-collapse": { label: "انهيار مبنى", description: "بناء يتفتت أثناء سقوطه" },
  "tsunami-wave": { label: "موجة تسونامي", description: "جدار شاهق من الماء يندفع للأمام" },
  "tornado": { label: "إعصار قمعي", description: "سحابة قمعية تلامس الأرض" },
  "hurricane": { label: "إعصار", description: "رياح عاصفة تثني الأشجار، أمطار غزيرة" },
  "blizzard-whiteout": { label: "عاصفة ثلجية مُعمية", description: "ثلوج كثيفة تمحو الرؤية" },
  "sandstorm": { label: "عاصفة رملية", description: "جدار من الغبار البرتقالي يبتلع المشهد" },
  "dust-storm-haboob": { label: "عاصفة غبار (هبوب)", description: "جبهة غبار صحراوية شاهقة" },
  "wildfire-distant": { label: "حريق غابات بعيد", description: "توهج برتقالي + دخان في الأفق" },
  "wildfire-engulfing": { label: "حريق ملتهم", description: "ألسنة لهب تقترب، تموج حراري شديد" },
  "volcanic-eruption": { label: "ثوران بركاني", description: "حمم تتدفق، عمود رماد" },
  "lava-flow": { label: "تدفق حمم", description: "نهر منصهر متوهج يزحف على الأرض" },
  "ash-rain": { label: "مطر رماد", description: "رماد رمادي مرعب يتساقط كالثلج" },
  "avalanche": { label: "انهيار جليدي", description: "جدار من الثلج ينهمر على المنحدر" },
  "hailstorm": { label: "عاصفة بَرَد", description: "حبات بَرَد كبيرة ترتد عن الأسطح" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "انفجار صغير", description: "انفجار مُحكم مع وميض مركزي" },
  "explosion-large": { label: "انفجار كبير", description: "كرة نارية بحجم مركبة مع حطام" },
  "explosion-massive": { label: "انفجار هائل", description: "كرة نارية تسوي مبانٍ مع موجة صدمة" },
  "nuclear-detonation": { label: "تفجير نووي", description: "سحابة فطرية + ومضة تضيء الأفق" },
  "fireball-airborne": { label: "كرة نار محمولة جوا", description: "كرة لهب متدحرجة في الجو" },
  "gas-explosion": { label: "انفجار غاز", description: "اندفاع لامع بأسلوب بروبان" },
  "oil-fire": { label: "حريق نفط", description: "ألسنة لهب طويلة دهنية + دخان أسود كثيف" },
  "blazing-inferno": { label: "جحيم متوهج", description: "جدار من النار يلتهم كل شيء" },
  "flame-burst": { label: "اندفاع لهب", description: "نفاثة سريعة موجهة من اللهب" },
  "ember-shower": { label: "وابل جمرات", description: "شلال من الجمرات البرتقالية المتوهجة" },
  "smoke-pillar": { label: "عمود دخان", description: "عمود عمودي طويل من الدخان الأسود" },
  "mushroom-cloud": { label: "سحابة فطرية", description: "سحابة تفجير كلاسيكية بقبة وجذع" },

  // ── Electric ──
  "lightning-bolt": { label: "صاعقة برق", description: "ضربة متفرعة عبر سماء عاصفة" },
  "lightning-strike-impact": { label: "ضربة برق", description: "صاعقة تضرب الأرض بانفجار من الضوء" },
  "lightning-storm": { label: "عاصفة برقية", description: "ضربات متعددة متزامنة" },
  "ball-lightning": { label: "برق كروي", description: "كرة متوهجة من البلازما الكهربائية تطفو في الجو" },
  "plasma-arc": { label: "قوس بلازما", description: "قوس مستمر عالي الجهد بين نقطتين" },
  "taser-sparks": { label: "شرر صاعق كهربائي", description: "تفريغ كهربائي مُحكم متطاير عند التلامس" },
  "electric-discharge": { label: "تفريغ كهربائي", description: "اندفاع طاقة متقوسة من جهاز معطل" },
  "transformer-blowout": { label: "انفجار محول كهربائي", description: "انفجار أزرق أبيض فوق عمود كهرباء" },
  "st-elmos-fire": { label: "نار القديس إلمو", description: "توهج بلازما أزرق مخيف على أطراف معدنية" },
  "static-shock-burst": { label: "صدمة كهرباء ساكنة", description: "ومضة صغيرة مرئية من كهرباء ساكنة" },

  // ── Combat ──
  "muzzle-flash": { label: "ومضة فوهة", description: "ومضة برتقالية ساطعة من فوهة بندقية" },
  "gunshot-impact": { label: "ارتطام طلقة", description: "رصاصة تصيب سطحا ببخاخ من الحطام" },
  "bullet-trail": { label: "أثر رصاصة", description: "أثر مرئي لرصاصة عبر الهواء" },
  "sword-spark": { label: "شرر سيف", description: "وابل ماكرو من الشرر بفعل احتكاك المعدن" },
  "blade-clash": { label: "اشتباك نصال", description: "نصلان يلتقيان بموجة ارتطام" },
  "ricochet-spark": { label: "شرر ارتداد", description: "رصاصة ترتد عن المعدن مع شرر" },
  "debris-field": { label: "حقل حطام", description: "شظايا متجمدة في الجو تتناثر" },
  "glass-shatter-airborne": { label: "تحطم زجاج في الجو", description: "زجاج ينفجر للخارج إلى شظايا معلقة" },
  "shockwave-ground": { label: "موجة صدمة أرضية", description: "حلقة مرئية تتسع على مستوى الأرض" },
  "sonic-boom": { label: "دوي صوتي", description: "مخروط هواء مضغوط بسرعة فوق صوتية" },
  "smoke-grenade": { label: "قنبلة دخانية", description: "دخان ملون كثيف يتفتح للخارج" },
  "flashbang": { label: "قنبلة صوتية ضوئية", description: "اندفاع أبيض مُعمي من الضوء" },
  "blood-spray": { label: "رذاذ دم", description: "قوس سينمائي من قطرات الدم" },
  "arrow-hit-spark": { label: "شرر ارتطام سهم", description: "سهم يضرب بشرر صغير عند الارتطام" },

  // ── Sci-Fi ──
  "laser-blast": { label: "إطلاق ليزر", description: "شعاع متماسك ساطع من الطاقة" },
  "energy-beam": { label: "شعاع طاقة", description: "شعاع عريض نابض من طاقة البلازما" },
  "plasma-bolt": { label: "قذيفة بلازما", description: "مقذوف متوهج يترك أثرا من البخار" },
  "force-field-shimmer": { label: "تلألؤ حقل قوة", description: "حاجز طاقة شفاف بنمط سداسي" },
  "force-field-impact": { label: "ارتطام بحقل قوة", description: "تموج مرئي حيث يصطدم المقذوف بالدرع" },
  "portal-opening": { label: "فتح بوابة", description: "دوامة طاقة تشق الفضاء" },
  "warp-distortion": { label: "تشويه حرف", description: "زمكان ينحني حول جسم" },
  "hologram-flicker": { label: "وميض هولوجرام", description: "إسقاط شفاف يتعطل" },
  "ion-storm": { label: "عاصفة أيونية", description: "حقل متطاير من جسيمات مشحونة على خلفية كونية" },
  "antimatter-flash": { label: "ومضة مضاد المادة", description: "اندفاع طاقة بيضاء يمزق الواقع" },

  // ── Magic ──
  "fireball-spell": { label: "تعويذة كرة نار", description: "كرة نار دوارة مُلقاة باليد" },
  "magic-aura": { label: "هالة سحرية", description: "هالة طاقة متوهجة حول شخصية" },
  "summoning-glyph": { label: "حرف استدعاء", description: "دائرة سحرية متوهجة على الأرض" },
  "lightning-magic": { label: "سحر برق", description: "سحر كهربائي يتقوس من يدي الساحر" },
  "ice-shard-burst": { label: "اندفاع شظايا ثلجية", description: "شظايا بلورية تتطاير للخارج" },
  "energy-rune": { label: "رمز طاقة", description: "رمز سحري متوهج معلق في الهواء" },
  "portal-magic": { label: "بوابة سحرية", description: "مدخل غامض دوار في الفضاء" },
  "healing-glow": { label: "توهج شفاء", description: "ضوء ذهبي دافئ ينبعث من الساحر" },
  "dark-vortex": { label: "دوامة مظلمة", description: "فراغ دوار أسود بنفسجي مشؤوم" },
  "light-explosion": { label: "انفجار ضوء", description: "اندفاع من إشعاع أبيض ذهبي خالص" },
}

export default map
