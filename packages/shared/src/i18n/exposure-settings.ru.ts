import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ---------------------------- Aperture (technical units, keep label) ----------------------------
  "aperture-f1-2": { description: "Бритвенно тонкая ГРИП, мечтательное боке" },
  "aperture-f1-4": { description: "Агрессивное выделение объекта" },
  "aperture-f1-8": { description: "Классическое портретное разделение" },
  "aperture-f2-8": { description: "Объект резкий, фон мягкий" },
  "aperture-f4": { description: "Сбалансированная ГРИП на каждый день" },
  "aperture-f5-6": { description: "Резкость по всему объекту" },
  "aperture-f8": { description: "Резкость в идеальной точке диафрагмы" },
  "aperture-f11": { description: "Глубокая ГРИП для пейзажа" },
  "aperture-f16": { description: "Гиперфокальная, солнечные звёзды" },

  // ---------------------------- Shutter Speed (technical units, keep label) ----------------------------
  "shutter-1-30": { description: "Лёгкое смазывание при съёмке с рук" },
  "shutter-1-60": { description: "Стандартная повседневная выдержка" },
  "shutter-1-200": { description: "Резко на большинстве объектов" },
  "shutter-1-500": { description: "Резко при быстром движении" },
  "shutter-1-1000": { description: "Заморозка спорта/дикой природы" },
  "shutter-long-1s": { description: "Полосы и следы движения" },

  // ---------------------------- ISO (technical units, keep label) ----------------------------
  "iso-100": { description: "Минимум шума, тонкое зерно" },
  "iso-400": { description: "Лёгкая текстура, рабочее ISO" },
  "iso-800": { description: "Заметное, но приятное зерно" },
  "iso-1600": { description: "Редакторская текстура слабого света" },
  "iso-3200": { description: "Подтянутое, грубое документальное ощущение" },
}

export default map
