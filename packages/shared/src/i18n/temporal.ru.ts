import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time": { label: "Реальное время", description: "Нормальная скорость воспроизведения" },
  "slow-motion": { label: "Замедленная съёмка", description: "Умеренно замедленные кадры" },
  "super-slow-mo": { label: "Сверхзамедленная съёмка", description: "Чрезвычайно замедленные кадры" },
  "time-lapse": { label: "Тайм-лапс", description: "Сжатое время, быстрое течение" },
  "hyper-lapse": { label: "Гипер-лапс", description: "Движущийся тайм-лапс" },
  "speed-ramp": { label: "Скоростной разгон", description: "Динамичное изменение скорости в кадре" },

  // Freeze
  "full-freeze": { label: "Полная стоп-кадр", description: "Всё движение заморожено" },
  "bullet-time": { label: "Bullet Time", description: "Объект заморожен, камера орбитирует" },
  "frozen-subject": { label: "Замёрший объект", description: "Объект заморожен, мир движется" },
  "moving-subject": { label: "Движущийся объект", description: "Объект движется, мир заморожен" },

  // Direction
  "forward": { label: "Вперёд", description: "Нормальное воспроизведение вперёд" },
  "reverse": { label: "Реверс / Перемотка", description: "Время воспроизводится назад" },
  "loop-boomerang": { label: "Цикл / Бумеранг", description: "Вперёд, затем назад" },

  // Shutter
  "long-exposure": { label: "Длинная выдержка", description: "Следы движения и полосы" },
  "crisp-shutter": { label: "Чёткая выдержка", description: "Резкое движение, без размытия" },
  "motion-blur": { label: "Моушн-блюр", description: "Выраженное направленное размытие" },
  "stutter-strobe": { label: "Стробоскоп", description: "Прерывистое стробо-движение" },
  "stop-motion": { label: "Стоп-моушн", description: "Покадровое движение шагами" },
}

export default map
