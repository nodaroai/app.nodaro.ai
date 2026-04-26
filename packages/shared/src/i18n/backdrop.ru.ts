import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Solid / Seamless --------------------
  "white-seamless": { label: "Белый бесшовный", description: "Чистая белая студийная бумага" },
  "black-seamless": { label: "Чёрный бесшовный", description: "Чисто чёрный студийный фон" },
  "grey-seamless": { label: "Серый бесшовный", description: "Нейтральная средне-серая студийная бумага" },
  "ivory-seamless": { label: "Слоновая кость", description: "Тёплый цвет слоновой кости, не совсем белый" },
  "deep-red": { label: "Тёмно-красный", description: "Насыщенная тёмно-красная стена" },
  "royal-blue": { label: "Королевский синий", description: "Насыщенный королевский синий фон" },
  "emerald-green": { label: "Изумрудный", description: "Насыщенная изумрудная стена" },
  "dusty-pink": { label: "Пыльно-розовый", description: "Мягкий приглушённый розовый фон" },
  "mustard-yellow": { label: "Горчичный жёлтый", description: "Тёплый горчичный фон" },
  "teal-textured-wall": { label: "Бирюзовая текстурная стена", description: "Окрашенная бирюзовая текстурная стена" },

  // -------------------- Gradient --------------------
  "red-orange-gradient": { label: "Красно-оранжевый градиент", description: "Тёплый переход от красного к оранжевому" },
  "pink-orange-gradient": { label: "Розово-оранжевый градиент", description: "Закатный переход от розового к оранжевому" },
  "blue-emerald-gradient": { label: "Сине-изумрудный градиент", description: "Прохладный переход от синего к изумрудному" },
  "sunset-gradient": { label: "Закатный градиент", description: "Многоцветный закатный переход" },
  "two-tone-split": { label: "Двухцветное разделение", description: "Стена, разделённая пополам по цвету" },

  // -------------------- Textured --------------------
  "brick-wall": { label: "Кирпичная стена", description: "Открытая красно-кирпичная стена" },
  "concrete-wall": { label: "Бетонная стена", description: "Сырая бетонная поверхность" },
  "plastered-wall": { label: "Оштукатуренная стена", description: "Штукатурка, нанесённая шпателем вручную" },
  "peeling-paint": { label: "Облезающая краска", description: "Винтажная стена с облезающей краской" },
  "wood-paneling": { label: "Деревянная обшивка", description: "Тёплая стена с деревянной обшивкой" },

  // -------------------- Fabric / Drape --------------------
  "muslin-drape": { label: "Муслин", description: "Пёстрый расписанный вручную муслин" },
  "velvet-drape": { label: "Бархатная драпировка", description: "Тяжёлая бархатная драпировка как фон" },
  "satin-drape": { label: "Атласная драпировка", description: "Глянцевая атласная драпировка" },
  "canvas-painted": { label: "Расписанный холст", description: "Живописный холст как фон" },

  // -------------------- Effect / Lighting --------------------
  "bokeh-blur": { label: "Боке-размытие", description: "Расфокусированное поле с боке" },
  "neon-bokeh": { label: "Неоновое боке", description: "Насыщенное неоновое боке-размытие" },
  "halo-glow": { label: "Сияющий ореол", description: "Светящийся круговой ореол за головой" },
  "light-leak": { label: "Световая засветка", description: "Полоса засветки от блика объектива" },
  "vignette-dark": { label: "Тёмная виньетка", description: "Тяжёлая тёмная виньетка по краям" },

  // -------------------- Reflective --------------------
  "mirror-floor": { label: "Зеркальный пол", description: "Отражающая зеркальная поверхность" },
  "polished-floor": { label: "Полированный пол", description: "Глянцевое отражение полированного пола" },
}

export default map
