import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Swords
  "katana": { label: "كاتانا", description: "كاتانا يابانية بشفرة منحنية برفق ذات حد واحد ومقبض ملفوف بجلد سمك الراي وحارس Tsuba قرصي ولمسة مرآة مصقولة" },
  "longsword": { label: "سيف طويل", description: "سيف Longsword من العصور الوسطى مزدوج الحد بشفرة مستقيمة متضائلة وحارس متصالب ومقبض ملفوف بالجلد ومقبض كروي" },
  "broadsword": { label: "Broadsword", description: "سيف Broadsword ثقيل بشفرة عريضة مستقيمة مزدوجة الحد وحارس قبضة سلتي ومقبض متين ملفوف بالجلد" },
  "rapier": { label: "Rapier", description: "سيف Rapier نحيل بشفرة طعن طويلة ضيقة وحارس قبضة منحن مزخرف ومقبض كروي" },
  "saber": { label: "Saber", description: "سيف Saber للفرسان بشفرة منحنية ذات حد واحد وحارس قوس مفاصل نحاسي ومقبض جلدي مضلع" },
  "scimitar": { label: "سيف Scimitar", description: "سيف Scimitar منحن بشفرة عريضة ذات حد واحد وحارس متصالب مزخرف ومقبض معدني مدور" },
  "claymore": { label: "Claymore", description: "سيف Claymore اسكتلندي ضخم ثنائي اليدين بشفرة طويلة مستقيمة وحارس متصالب مائل للأمام ومقبض كبير ملفوف بالجلد" },
  "cutlass": { label: "Cutlass", description: "سيف Cutlass للقراصنة بشفرة قصيرة منحنية ذات حد واحد وحارس يد نحاسي بشكل كأس ومقبض خشبي بال" },
  "wakizashi": { label: "Wakizashi", description: "شفرة Wakizashi يابانية قصيرة مرافقة بحد منحن برفق و Tsuba صغيرة ومقبض ملفوف بجلد سمك الراي" },
  "falchion": { label: "Falchion", description: "سيف Falchion ثقيل ذو حد واحد بشفرة متضائلة كالساطور وحارس متصالب بسيط ومقبض جلدي مثبت بمسامير" },

  // Daggers & Knives
  "dagger": { label: "خنجر", description: "خنجر كلاسيكي مزدوج الحد بشفرة مدببة ضيقة وحارس متصالب ومقبض ملفوف بالجلد" },
  "bowie-knife": { label: "سكين Bowie", description: "سكين Bowie كبيرة بشفرة Clip-point وحارس نحاسي ومقبض من غسالات جلدية متراكمة وحارس متصالب" },
  "kukri": { label: "Kukri", description: "Kukri نيبالية بشفرة عريضة منحنية للأمام ومقبض خشبي وانحناء داخلي مميز" },
  "stiletto": { label: "Stiletto", description: "Stiletto نحيل بشفرة مثلثة طويلة رفيعة كالإبرة وحارس متصالب أدنى ومقبض متضائل" },
  "dirk": { label: "Dirk", description: "Dirk اسكتلندي بشفرة طويلة مستقيمة ذات حد واحد ومقبض بعقدة سلتية متشابكة ومقبض مزخرف" },
  "tanto": { label: "Tanto", description: "خنجر Tanto ياباني بطرف Chisel زاوي و Tsuba صغيرة ومقبض ملفوف بجلد سمك الراي" },
  "switchblade": { label: "Switchblade", description: "Switchblade جيب بشفرة قابلة للطي بزنبرك وألواح جانبية من اللؤلؤ أو الراتنج وزر إطلاق مصقول" },
  "trench-knife": { label: "سكين الخنادق", description: "سكين خنادق عسكرية بشفرة نحيلة مزدوجة الحد وحارس يد نحاسي بقبضة معدنية يلتف حول المقبض" },

  // Axes
  "battle-axe": { label: "فأس قتال", description: "فأس قتال ثقيلة ثنائية اليدين بحد قطع منحن عريض وملف Bearded ومقبض خشبي طويل مربوط بأشرطة حديدية" },
  "tomahawk": { label: "Tomahawk", description: "Tomahawk للرمي خفيف برأس حديدي صغير أحادي الحد ومقبض خشبي مستقيم ولف جلدي قرب المقبض" },
  "hatchet": { label: "بلطة صغيرة", description: "بلطة صغيرة مدمجة بمقبض خشبي قصير ورأس فولاذي صغير أحادي الحد ولمسة مطروقة" },
  "halberd": { label: "Halberd", description: "Halberd بعمود طويل يجمع بين شفرة فأس وطرف رمح طاعن وخطاف خلفي على عمود خشبي طويل" },
  "greataxe": { label: "Greataxe", description: "Greataxe ضخمة برأس هلالي مزدوج الجوانب وأشرطة حديدية للتعزيز ومقبض ثقيل طويل يتطلب يدين" },
  "bearded-axe": { label: "فأس Bearded", description: "فأس Bearded من الفايكنغ بحد شفرة سفلي ممدود ورأس حديدي ضيق ومقبض خشبي طويل ملفوف بالجلد" },

  // Polearms
  "spear": { label: "رمح", description: "رمح بسيط برأس رمح حديدي بشكل ورقة مربوط بعمود خشبي طويل مستقيم وغطاء صغير في القاعدة" },
  "lance": { label: "Lance", description: "Lance للمبارزة بعمود خشبي طويل وطرف فولاذي مخروطي وحارس يد متسع يحمي المقبض" },
  "pike": { label: "Pike", description: "Pike طويل جدا برأس رمح مثلث صغير مثبت على عمود خشبي شاهق بضعفي ارتفاع رجل" },
  "glaive": { label: "Glaive", description: "Glaive بعمود طويل بشفرة منحنية ذات حد واحد مثبتة على عمود خشبي تتضاءل إلى حارس متصالب صغير" },
  "trident": { label: "Trident", description: "Trident بثلاث شعب بأسنان شائكة حادة وعمود مركزي وعمود خشبي طويل" },
  "naginata": { label: "Naginata", description: "Naginata يابانية بشفرة منحنية ذات حد واحد مثبتة على عمود خشبي طويل ملمع بلفات حريرية" },

  // Bows & Crossbows
  "longbow": { label: "Longbow", description: "Longbow إنجليزي طويل بقطعة واحدة من خشب الطقسوس ووتر كتاني مشمع ومقبض ملفوف بالجلد" },
  "recurve-bow": { label: "قوس Recurve", description: "قوس Recurve تقليدي بأطراف تنحني بعيدا عن الرامي وقاعدة ملفوفة بالجلد ووتر مشدود" },
  "compound-bow": { label: "قوس Compound", description: "قوس Compound حديث بكامات ألمنيوم وعجلات بكرة في كل طرف ومسند سهم من ألياف الكربون ومصفوفة دبابيس تصويب" },
  "crossbow": { label: "Crossbow", description: "Crossbow من العصور الوسطى بمؤخرة خشبية أفقية و Prod فولاذي ووتر مشدود وآلية زناد تحت السكة" },
  "short-bow": { label: "قوس قصير", description: "قوس Short Bow خشبي مدمج بصورة ظلية منحنية بسيطة ووتر مشمع ومقبض جلدي في المنتصف" },

  // Blunt & Impact
  "mace": { label: "صولجان", description: "صولجان Mace من العصور الوسطى برأس متوج ثقيل بحواف حديدية بارزة على عمود حديدي قصير" },
  "war-hammer": { label: "مطرقة حرب", description: "مطرقة حرب طويلة المقبض برأس حديدي ثقيل بوجه ضرب مسطح من جانب وشوكة منحنية من الجانب الآخر" },
  "club": { label: "هراوة", description: "هراوة خشبية بسيطة برأس سميك معقود وعمود متضائل ومقبض جلدي بال قرب القاعدة" },
  "morning-star": { label: "Morning Star", description: "Morning Star بعمود خشبي تعلوه كرة حديدية كبيرة مغطاة بأشواك طويلة في كل اتجاه" },
  "flail": { label: "Flail", description: "Flail عسكري بكرة حديدية مسننة متصلة بسلسلة قصيرة بمقبض خشبي بغطاء حديدي" },
  "nunchaku": { label: "Nunchaku", description: "Nunchaku للفنون القتالية بهراوتين خشبيتين مصقولتين متصلتين بطول قصير من الحبل المضفور أو السلسلة" },

  // Throwing
  "shuriken": { label: "Shuriken", description: "نجمة رمي معدنية بنقاط حادة كالموسى تشع من محور مركزي ولمسة فولاذية مسودة" },
  "throwing-knife": { label: "سكين رمي", description: "سكين رمي متوازنة بشفرة مزدوجة الحد بشكل ورقة ومقبض بسيط ولمسة فولاذية مصقولة" },
  "boomerang": { label: "Boomerang", description: "Boomerang خشبي منحن بانحناء كوع وأنماط قبلية مرسومة وصورة ظلية انسيابية ناعمة" },
  "javelin": { label: "Javelin", description: "Javelin خفيف للرمي بطرف فولاذي نحيل وعمود خشبي متضائل ولف مقبض جلدي قرب نقطة التوازن" },
  "bolas": { label: "Bolas", description: "ثلاث كرات حجرية أو حديدية موزونة مربوطة معا بحبال جلدية مضفورة تلتقي عند عقدة مركزية" },

  // Modern Firearms
  "pistol": { label: "مسدس", description: "مسدس شبه آلي حديث بإطار بوليمر أسود غير لامع وغلاف مضلع وحارس زناد وقاعدة مخزن منبسطة" },
  "revolver": { label: "Revolver", description: "Revolver ست طلقات بأسطوانة دوارة وفوهة طويلة ومطرقة مرفوعة للخلف ومقبض خشبي محزز" },
  "assault-rifle": { label: "بندقية هجومية", description: "بندقية هجومية عسكرية بفوهة طويلة وكتف قابل للطي ومنظار بصري على السكة ومخزن منحن قابل للفصل" },
  "shotgun": { label: "شوزن", description: "بندقية شوزن Pump-action بفوهة عريضة الفجوة وغطاء أمامي تكتيكي ومخزن أنبوبي تحته وكتف خشبي أو صناعي" },
  "smg": { label: "رشاش SMG", description: "رشاش SMG مدمج بفوهة قصيرة ومخزن مثبت من الجانب وكتف سلكي قابل للطي ومقبض أمامي مدمج" },
  "sniper-rifle": { label: "بندقية قنص", description: "بندقية قنص Bolt-action بفوهة طويلة ومنظار عالي التكبير وأرجل Bipod وكتف بوليمر مريح" },
  "machine-gun": { label: "رشاش", description: "رشاش ثقيل يغذى بحزام بفوهة طويلة بزعانف وأرجل Bipod ومقبض حمل وحزام ذخيرة يغذى من الجانب" },

  // Historical Firearms
  "musket": { label: "Musket", description: "Musket Flintlock طويل بفوهة حديدية ملساء ومخزن من الجوز ولوازم نحاسية وحربة مثبتة قرب الفوهة" },
  "flintlock-pistol": { label: "مسدس Flintlock", description: "مسدس Flintlock مزخرف بمقبض خشبي منحن ولوازم نحاسية محفورة ومطرقة Flint وفوهة طويلة واحدة" },
  "blunderbuss": { label: "Blunderbuss", description: "Blunderbuss Flintlock قصير بفوهة متسعة ولوازم نحاسية على مخزن خشبي قوي وحضور من حقبة القراصنة" },
  "dueling-pistol": { label: "مسدس مبارزة", description: "مسدس مبارزة أنيق بفوهة ثمانية الأضلاع نحيلة وآلية قفل محفورة بدقة ومقبض جوز مصقول" },

  // Explosives & Siege
  "grenade": { label: "قنبلة يدوية", description: "قنبلة يدوية شظوية حديدية بنسيج كالأناناس بذراع ملعقة مثبت بدبوس أمان مسحوب" },
  "stick-grenade": { label: "قنبلة عصا", description: "قنبلة عصا أسطوانية برأس حربي حديدي مثبت فوق مقبض خشبي طويل وفتيل سحب في القاعدة" },
  "dynamite": { label: "ديناميت", description: "حزمة من عصي الديناميت الحمراء ملفوفة بخيوط ومتصلة بفتيل طويل يطقطق بطرف مشتعل" },
  "bomb": { label: "قنبلة كرتونية", description: "قنبلة كرتونية كروية سوداء بفتيل ملتف يصعد منه دخان وقشرة حديدية كروية لامعة" },
  "rocket-launcher": { label: "قاذف صواريخ", description: "قاذف صواريخ يطلق من الكتف بأنبوب طويل ومقبض أمامي ومخروط عادم خلفي ومنظار تصويب بصري" },
  "cannon": { label: "مدفع", description: "مدفع يحشى من الفوهة من الحديد المصبوب مثبت على عربة خشبية بعجلات بفوهة طويلة ملساء ومنفذ يدخن" },
  "catapult": { label: "Catapult", description: "Catapult حصار خشبي بذراع رمي طويل مرفوع للخلف ووزن ثقل أو حزمة التواء وسلة محملة بحجر" },
  "trebuchet": { label: "Trebuchet", description: "Trebuchet طويل من العصور الوسطى بوزن ثقل ضخم وذراع رمي طويل ومقلاع مضفور وإطار خشبي ثقيل" },

  // Sci-Fi
  "laser-pistol": { label: "مسدس ليزر", description: "مسدس ليزر Sci-Fi مدمج بملفات طاقة نيون متوهجة وجسم معدني محزز وفوهة باعث قصيرة" },
  "plasma-rifle": { label: "بندقية بلازما", description: "بندقية بلازما مستقبلية بخلايا طاقة زرقاء متوهجة وأغطية فوهة بفتحات تهوية ومنظار هولوغرافي" },
  "lightsaber": { label: "Lightsaber", description: "سيف ليزر بمقبض معدني محزز يطلق شفرة طويلة متوهجة من طاقة مشبعة بهالة بلازما ضبابية" },
  "blaster": { label: "Blaster", description: "مسدس Blaster مستقبلي ريترو بجسم ضخم وحجرة طاقة متوهجة وفتحات تبريد ومنظار مثبت في الأعلى" },
  "phaser": { label: "Phaser", description: "Phaser Sci-Fi أنيق بمقبض منحن بسيط وطرف باعث متوهج ولوحة ناعمة تتحكم في الشدة" },
  "rail-gun": { label: "Rail Gun", description: "Rail Gun كهرومغناطيسي ثقيل بسكك معدنية متوازية ومكثفات ضخمة على طول الجسم وحجرة قذيفة متوهجة" },
  "emp-grenade": { label: "قنبلة EMP", description: "قنبلة كهرومغناطيسية كروية بملفات مكشوفة وأضواء مؤشر زرقاء متوهجة وقرص تسليح هولوغرافي" },

  // Fantasy / Magical
  "enchanted-sword": { label: "سيف مسحور", description: "سيف مسحور بشفرة محفورة بالرونات متوهجة وحارس متصالب مرصع بالذهب وحجر كريم مضمن في المقبض" },
  "magic-staff": { label: "عصا سحرية", description: "عصا ساحر طويلة معقودة بعمود خشبي ملتو ينتهي بتاج من الفروع يحمل بلورة متوهجة" },
  "runed-dagger": { label: "خنجر Runed", description: "خنجر سحري بشفرة منقوشة برونات متوهجة ومقبض من العظم وطاقة مظلمة تتلوى على طول الحد" },
  "wizard-wand": { label: "عصا ساحر", description: "عصا خشبية نحيلة بدوائر محززة ومقبض جلدي وشرارات سحر صغيرة تتسرب من الطرف المدبب" },
  "war-horn": { label: "بوق حرب", description: "بوق حرب منحن ضخم مربوط بالجلد وأشرطة فضية بفم في طرف وفتحة هدير متسعة في الطرف الآخر" },
  "sorcerer-orb": { label: "كرة الساحر", description: "كرة بلورية للساحر محمولة في حامل مخلب فضي ملتو مع ضباب غامض ملتو معلق داخل الكرة الزجاجية" },
}

export default map
