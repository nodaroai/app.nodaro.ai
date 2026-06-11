import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { description: "Сверхширокий угол, преувеличенная перспектива" },
  "wide-24mm": { description: "Широкое поле обзора, окружение в кадре" },
  "standard-35mm": { description: "Естественная перспектива, документальное ощущение" },
  "normal-50mm": { description: "Ближе всего к восприятию человеческого глаза" },
  "portrait-85mm": { description: "Льстивое сжатие, кремовое боке" },
  "telephoto-135mm": { description: "Сжатая глубина, изолированный объект" },
  "super-telephoto-400mm": { description: "Экстремальное сжатие, отдалённый объект" },
  "fisheye": { label: "Рыбий глаз", description: "Полусферическое 180° искажение" },
  "anamorphic": { label: "Анаморфный", description: "Кинематографический широкоэкранный, овальное боке" },
  "macro": { label: "Макро", description: "Сверхкрупный план мелкой детали" },
  "tilt-shift": { label: "Тилт-шифт", description: "Селективный фокус, эффект миниатюры" },
  "shallow-dof": { label: "Малая ГРИП", description: "Бритвенно тонкий фокус, мечтательное боке" },
  // Lens series — keep label English
  "canon-k35": { description: "Винтажный кинематографический, тёплая мягкая кожа" },
  "cooke-s4": { description: "The Cooke look — кремовая живописная кожа" },
  "helios-44": { description: "Винтажное советское закрученное боке" },
  "petzval": { description: "Сверхвинтажный завиток, драматичный спад резкости" },
  "probe": { label: "Линза-зонд", description: "Трубчатый макро — сквозь отверстия и узкие щели" },
  "cctv": { label: "Камера наблюдения", description: "Вид записи с камеры видеонаблюдения" },
}

export default map
