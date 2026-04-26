import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "Мягкая виньетка", description: "Лёгкое затемнение по углам" },
  "vignette-heavy": { label: "Тяжёлая виньетка", description: "Драматичные чёрные углы" },
  "dodge-and-burn": { label: "Осветление и затемнение", description: "Скульптурные света и тени" },
  "film-grain-fine": { label: "Тонкое плёночное зерно", description: "Тонкое зерно в стиле 35мм" },
  "film-grain-heavy": { label: "Грубое плёночное зерно", description: "Грубое подтянутое зерно" },
  "halation-glow": { label: "Свечение halation", description: "Красная гало-вспышка cinestill" },
  "bloom-glow": { label: "Свечение bloom", description: "Романтичное мечтательное свечение бликов" },
  "chromatic-aberration": { label: "Хроматическая аберрация", description: "Красно-голубая бахрома по краям" },
  "light-leak": { label: "Световая засветка", description: "Тёплая полоса через кадр" },
  "film-burn": { label: "Прожог плёнки", description: "Винтажный угловой блик Super-8" },
  "scratched-emulsion": { label: "Поцарапанная эмульсия", description: "Состаренные царапины и пыль на плёнке" },
  "color-fringe": { label: "Цветная бахрома", description: "Тонкая высококонтрастная цветовая бахрома" },
  "soft-focus-diffusion": { label: "Рассеивание мягкого фокуса", description: "Мечтательное свечение на бликах" },
  "contrast-boost": { label: "Усиление контраста", description: "Раздавленные тени, поднятые света" },
  "sharpening": { label: "Сильное усиление резкости", description: "Агрессивный проход по усилению резкости краёв" },
  "clarity-boost": { label: "Усиление чёткости", description: "Усиление чёткости средних тонов, повышенный локальный контраст" },
  "dehaze": { label: "Удаление дымки", description: "Применено атмосферное удаление дымки, убирающее мягкость" },
  "lift-gamma-gain": { label: "Грейдинг lift-gamma-gain", description: "Трёхзонные колёса цветокоррекции" },
}

export default map
