import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft":        { label: "柔和暗角",       description: "轻微的四角压暗" },
  "vignette-heavy":       { label: "重暗角",         description: "强烈的黑色四角" },
  "dodge-and-burn":       { label: "Dodge & Burn 加深减淡", description: "雕塑感高光与阴影" },
  "film-grain-fine":      { label: "细腻胶片颗粒",   description: "微妙的 35mm 风格颗粒" },
  "film-grain-heavy":     { label: "重胶片颗粒",     description: "粗糙的推感颗粒" },
  "halation-glow":        { label: "光晕泛红",       description: "Cinestill 风的红色光晕" },
  "bloom-glow":           { label: "梦幻泛光",       description: "浪漫的高光柔光" },
  "chromatic-aberration": { label: "色差",           description: "边缘的红 / 青色色差" },
  "light-leak":           { label: "漏光",           description: "穿过画面的暖色光条" },
  "film-burn":            { label: "胶片灼烧",       description: "复古 Super-8 角落爆光" },
  "scratched-emulsion":   { label: "划痕乳剂",       description: "做旧胶片划痕加灰尘" },
  "color-fringe":         { label: "色彩边缘",       description: "高对比边缘的微妙色散" },
  "soft-focus-diffusion": { label: "柔焦扩散",       description: "梦幻雾感高光" },
  "contrast-boost":       { label: "对比增强",       description: "压黑阴影、推高高光" },
  "sharpening":           { label: "强力锐化",       description: "强烈的边缘锐化处理" },
  "clarity-boost":        { label: "清晰度提升",     description: "中间调清晰度增强,提升局部对比" },
  "dehaze":               { label: "去雾",           description: "去除大气雾感,消除柔化" },
  "lift-gamma-gain":      { label: "Lift-Gamma-Gain 调色", description: "三向色轮调色" },
}

export default map
