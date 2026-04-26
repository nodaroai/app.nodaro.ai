import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Film stocks (technical units & brand names — keep label English)
  "35mm-film": { description: "Классическое кинозерно" },
  "16mm-film": { description: "Инди / документальное зерно" },
  "super-8": { description: "Винтажный домашний 8-мм вид" },
  "imax-70mm": { description: "Безупречная чёткость большого формата" },
  "anamorphic-scope": { description: "Широкоэкранный кинолук 2.39:1" },
  // Modern digital — brand names kept
  "arri-alexa": { description: "Премиальная цифровая киносъёмка" },
  "dslr": { description: "Чёткий вид с зеркальной камеры" },
  "mirrorless-a7iii": { description: "Современный гибридный беззеркальный" },
  "canon-r5": { description: "Беззеркальный с высоким разрешением для модной редакции" },
  "hasselblad-medium-format": { description: "Среднеформатный для журнальных съёмок" },
  "leica-m-rangefinder": { description: "Классический 35-мм дальномер" },
  "voigtlander": { description: "Бутиковый дальномерный характер" },
  "fuji-xt4": { description: "Цвет Fuji, имитирующий плёнку" },
  // Aerial / action
  "drone-aerial": { label: "Дрон (с воздуха)", description: "Воздушная съёмка со стабилизированного подвеса сверху" },
  "gopro-action-cam": { label: "Экшн-камера GoPro", description: "Широкоугольная экшн-камера типа «рыбий глаз»" },
  // Lo-fi modern
  "webcam-facetime": { label: "Веб-камера / FaceTime", description: "Низкое разрешение видеозвонка" },
  // Vintage / lo-fi
  "vhs": { description: "Искажения плёнки и линии развёртки" },
  "camcorder": { label: "Видеокамера", description: "Потребительское видео 90-х" },
  "polaroid": { description: "Тональность мгновенной плёнки" },
  "fuji-instax": { description: "Современная мгновенная плёнка" },
  "disposable-camera": { label: "Одноразовая камера", description: "Одноразовая плёночная камера 90-х/2000-х" },
  "toy-camera-holga": { label: "Игрушечная камера (Holga)", description: "Лоу-фай Holga / Lomo с пластиковой линзой" },
  "tintype-wet-plate": { label: "Тинтайп / Мокрая пластина", description: "Винтажный коллодионный мокрый процесс" },
  "daguerreotype": { label: "Дагерротип", description: "Серебряно-зеркальный процесс 1840-х" },
  "security-cam": { label: "Камера наблюдения (CCTV)", description: "CCTV типа «рыбий глаз» с временной меткой" },
  "bw-film": { label: "Чёрно-белая плёнка", description: "Чёрно-белая плёнка" },
  "iphone": { description: "Современный вид камеры телефона" },
}

export default map
