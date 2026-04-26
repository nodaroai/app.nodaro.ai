import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Palette
  "warm":            { label: "暖色调",           description: "暖橙红色调" },
  "cool":            { label: "冷色调",           description: "冷蓝青色调" },
  "teal-orange":     { label: "青橙互补",         description: "好莱坞互补色调色" },
  "split-toning":    { label: "分离色调",         description: "冷阴影、暖高光" },
  "selective-color": { label: "局部色彩",         description: "黑白配单一强调色" },
  "faded-matte":     { label: "褪色哑光",         description: "提亮黑、低对比的奶白调" },
  "log-flat":        { label: "Log 平片",         description: "S-Log/V-Log 中性预调色" },
  "desaturated":     { label: "低饱和度",         description: "低饱和、柔和" },
  "monochrome-bw":   { label: "黑白单色",         description: "纯黑白" },
  "sepia":           { label: "深褐色调",         description: "复古的棕色调" },
  "pastel":          { label: "粉彩色",           description: "柔和低对比的粉彩" },
  "high-contrast":   { label: "高对比",           description: "强对比、深黑" },
  "vibrant":         { label: "鲜艳",             description: "高度饱和的色彩" },

  // Film emulation — keep famous film stock names in English
  "kodak-portra":    { description: "柔和肤色,细腻颗粒" },
  "kodak-ektar":     { description: "高饱和,细腻颗粒" },
  "kodak-vision3":   { description: "电影动态画面胶片" },
  "fuji-pro-400h":   { description: "粉彩绿与天空感" },
  "cinestill-800t":  { description: "钨光胶片带红色光晕" },
  "bleach-bypass":   { label: "漂白工艺",         description: "高对比、低饱和度" },
  "technicolor":     { description: "鲜艳的复古 Technicolor 三色" },
  "two-strip-technicolor":{ description: "1920–30 年代红蓝双色 Technicolor" },
  "eastman-color":   { description: "1950 / 60 年代褪色暖调胶片" },
  "hand-tinted":     { label: "手工上色",         description: "黑白上手绘色彩" },
  "agfa-orwo":       { description: "东欧冷绿色调" },
  "day-for-night":   { label: "日转夜",           description: "白天调色为夜景" },
  "cross-processed": { label: "交叉冲印",         description: "交叉冲印带来的色彩偏移" },

  "kodachrome-64":   { description: "饱和的红色与琥珀色高光,复古《国家地理》式的暖意" },
  "ektachrome-100":  { description: "干净冷调的蓝色,反转片般的清晰度" },
  "kodak-tri-x-400": { description: "推感冲洗的颗粒黑白街拍,粗砺的 35mm 质感" },
  "aerochrome":      { description: "超现实的粉品红植被,假色风光胶片" },
  "fuji-instax":     { description: "柔和粉彩中间调,方画幅即时胶片" },
  "cinestill-50d":   { description: "日光电影胶片,克制的蓝色,王家卫式的氛围" },
  "expired-film":    { label: "过期胶片",       description: "色彩偏移、过曝品红与漏光" },

  // Social-preset
  "instagram-warm":     { description: "Valencia 风格的暖色滤镜" },
  "tiktok-saturated":   { description: "明亮饱和的社交媒体色板" },
  "youtube-vlog-flat":  { description: "干净的 vlog 平调色" },
  "iphone-hdr":         { description: "计算式 HDR 的视觉" },
  "y2k-saturated":      { description: "千禧年初期数码饱和感" },
  "mtv-90s-vhs":        { description: "高饱和的 90 年代 VHS 色度" },
  "polaroid-faded":     { description: "洋红偏色的褪色宝丽来" },
  "lifestyle-warm-magazine":{ description: "现代杂志暖色调编辑大片" },
}

export default map
