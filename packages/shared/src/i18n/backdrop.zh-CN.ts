import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Solid / Seamless --------------------
  "white-seamless":     { label: "白色无缝背景纸",   description: "干净的白色摄影棚背景纸" },
  "black-seamless":     { label: "黑色无缝背景纸",   description: "纯黑色摄影棚背景" },
  "grey-seamless":      { label: "灰色无缝背景纸",   description: "中性的中灰色棚拍纸" },
  "ivory-seamless":     { label: "象牙色无缝背景",   description: "暖象牙色微泛白的背景" },
  "deep-red":           { label: "深红色",           description: "饱和的深红色墙面" },
  "royal-blue":         { label: "宝蓝色",           description: "饱和的宝蓝色背景" },
  "emerald-green":      { label: "翠绿色",           description: "饱和的翠绿色墙面" },
  "dusty-pink":         { label: "雾粉色",           description: "柔和的低饱和粉色背景" },
  "mustard-yellow":     { label: "芥末黄",           description: "暖芥末黄色背景" },
  "teal-textured-wall": { label: "青绿色纹理墙",     description: "刷漆的青绿色纹理墙" },

  // -------------------- Gradient --------------------
  "red-orange-gradient":   { label: "红橙渐变",         description: "暖色红到橙的渐变扫色" },
  "pink-orange-gradient":  { label: "粉橙渐变",         description: "日落感粉到橙的扫色" },
  "blue-emerald-gradient": { label: "蓝翠绿渐变",       description: "冷色蓝到翠绿的扫色" },
  "sunset-gradient":       { label: "日落渐变",         description: "多色日落色调扫色" },
  "two-tone-split":        { label: "双色拼接",         description: "对半分色的撞色墙" },

  // -------------------- Textured --------------------
  "brick-wall":      { label: "砖墙",       description: "裸露的红砖墙" },
  "concrete-wall":   { label: "水泥墙",     description: "原始水泥表面" },
  "plastered-wall":  { label: "灰泥墙",     description: "手抹的灰泥肌理" },
  "peeling-paint":   { label: "斑驳漆面",   description: "复古剥落漆面墙" },
  "wood-paneling":   { label: "木饰面",     description: "暖色木饰面墙" },

  // -------------------- Fabric / Drape --------------------
  "muslin-drape":  { label: "棉布背景",     description: "斑驳手绘棉布背景" },
  "velvet-drape":  { label: "天鹅绒帷幕",   description: "厚重的天鹅绒帷幕背景" },
  "satin-drape":   { label: "缎面帷幕",     description: "光泽顺滑的缎面帷幕" },
  "canvas-painted":{ label: "手绘画布",     description: "绘画感的画布背景" },

  // -------------------- Effect / Lighting --------------------
  "bokeh-blur":  { label: "散景模糊",   description: "失焦的散景光斑场" },
  "neon-bokeh":  { label: "霓虹散景",   description: "饱和霓虹色散景模糊" },
  "halo-glow":   { label: "光晕",       description: "头部后方的圆形发光光晕" },
  "light-leak":  { label: "漏光",       description: "镜头光斑漏光条纹" },
  "vignette-dark":{ label: "暗角",       description: "深色暗角包围画面" },

  // -------------------- Reflective --------------------
  "mirror-floor":  { label: "镜面地板",   description: "反射式镜面地面" },
  "polished-floor":{ label: "抛光地板",   description: "高光抛光地板的微反射" },
}

export default map
