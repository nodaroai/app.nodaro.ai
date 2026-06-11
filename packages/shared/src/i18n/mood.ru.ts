import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Positive --------------------
  "happy": { label: "Счастливый", description: "Тёплое, улыбчивое счастье" },
  "joyful": { label: "Радостный", description: "Сияющая, безудержная радость" },
  "serene": { label: "Безмятежный", description: "Спокойное мирное удовлетворение" },
  "playful": { label: "Игривый", description: "Озорная, игривая энергия" },
  "confident": { label: "Уверенный", description: "Самоуверенный, уверенный" },
  "loving": { label: "Любящий", description: "Нежный, ласковый" },
  "amused": { label: "Развеселённый", description: "Слегка развеселённый, ухмылка" },
  "smirking": { label: "Ухмыляющийся", description: "Самодовольное, надменное веселье" },
  "eccentric": { label: "Эксцентричный", description: "Странный, нетрадиционный" },
  "hopeful": { label: "Полный надежды", description: "С блеском в глазах, оптимистичный" },

  // -------------------- Negative --------------------
  "sad": { label: "Грустный", description: "Тихая грусть, опустивший взгляд" },
  "angry": { label: "Сердитый", description: "Явный гнев, напряжение" },
  "afraid": { label: "Испуганный", description: "Напуганный, с расширенными глазами" },
  "anxious": { label: "Тревожный", description: "Нервный, обеспокоенный" },
  "melancholy": { label: "Меланхоличный", description: "Тоскливая печаль" },
  "devastated": { label: "Опустошённый", description: "Раздавленное горе" },
  "grieving": { label: "Скорбящий", description: "Глубокое горе, утрата" },
  "caught-off-guard": { label: "Застигнутый врасплох", description: "Испуганный посреди реакции" },
  "aloof": { label: "Отстранённый", description: "Замкнутый, незаинтересованный" },
  "vulnerable": { label: "Уязвимый", description: "Обнажённый, беззащитный" },
  "coy": { label: "Кокетливый", description: "Робкий, опустивший глаза" },
  "bored": { label: "Скучающий", description: "Незаинтересованный, безучастный" },
  "embarrassed": { label: "Смущённый", description: "Покрасневший, отводящий взгляд" },
  "disgusted": { label: "Отвращённый", description: "С отвращением, отшатывающийся" },
  "bewildered": { label: "Озадаченный", description: "Растерянный, потерянный" },

  // -------------------- Neutral / Contemplative --------------------
  "thoughtful": { label: "Задумчивый", description: "Глубоко в мыслях" },
  "stoic": { label: "Стоический", description: "Бесстрастный, нечитаемый" },
  "calm": { label: "Спокойный", description: "Сосредоточенный, нереактивный" },
  "curious": { label: "Любопытный", description: "Заинтригованный, настороженный" },
  "mysterious": { label: "Загадочный", description: "Непостижимый, загадочный" },
  "dazed": { label: "Ошеломлённый", description: "Мечтательный, наполовину присутствующий" },
  "sleepy": { label: "Сонный", description: "Дремотный, с тяжёлыми веками" },
  "unbothered": { label: "Невозмутимый", description: "Спокойное самообладание" },

  // -------------------- Intense / Dramatic --------------------
  "fierce": { label: "Свирепый", description: "Свирепый, повелевающий" },
  "determined": { label: "Решительный", description: "Решительный, сосредоточенная воля" },
  "passionate": { label: "Страстный", description: "Горящая страсть" },
  "brooding": { label: "Угрюмый", description: "Тёмная, угрюмая меланхолия" },
  "seductive": { label: "Соблазнительный", description: "Манящий, соблазнительный" },
  "defiant": { label: "Дерзкий", description: "Дерзкий, непреклонный" },
  "sultry": { label: "Знойный", description: "Тлеющий, с тяжёлыми веками" },
  "smoldering": { label: "Тлеющий", description: "Сжатая, медленно горящая интенсивность" },
  "sinister": { label: "Зловещий", description: "Тёмный, злобный, угрожающий" },
  "wiccan-mystical": { label: "Викканский / Мистический", description: "Тихо потусторонний, оккультный" },
  "lazy-shy": { label: "Ленивая стеснительность", description: "Дремотный, мягкий, наполовину застенчивый" },
  "awe": { label: "Благоговение", description: "Чудо, благоговейный" },
  "shocked": { label: "Шокированный", description: "Удивлённый, рот открыт" },
  "flirty": { label: "Кокетливый", description: "Игривое заигрывание, задержавшаяся улыбка, продолжительный зрительный контакт" },
  "suspicious": { label: "Подозрительный", description: "Настороженное недоверие, прищуренные глаза, косой взгляд" },
  "resigned": { label: "Смирившийся", description: "Тихое принятие неприятной ситуации" },
  "conflicted": { label: "Раздираемый", description: "Видимая внутренняя борьба, нахмуренные брови" },
  "relieved": { label: "Облегчение", description: "Напряжение сменяется покоем" },
}

export default map
