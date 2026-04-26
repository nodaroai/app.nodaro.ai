import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Aperture — keep f/x.x in alphanumeric form
  "aperture-f1-2": { description: "极薄景深,梦幻散景" },
  "aperture-f1-4": { description: "强烈的主体分离" },
  "aperture-f1-8": { description: "经典人像景深分离" },
  "aperture-f2-8": { description: "主体清晰、背景柔化" },
  "aperture-f4":   { description: "均衡的日常景深" },
  "aperture-f5-6": { description: "主体上下完全清晰" },
  "aperture-f8":   { description: "甜点光圈般的锐利" },
  "aperture-f11":  { description: "深景深的风光光圈" },
  "aperture-f16":  { description: "超焦距景深与太阳星芒" },

  // Shutter
  "shutter-1-30":   { label: "1/30(手持模糊)",   description: "微妙的手持运动暗示" },
  "shutter-1-60":   { label: "1/60",              description: "标准的日常快门速度" },
  "shutter-1-200":  { label: "1/200",             description: "对大多数主体清晰" },
  "shutter-1-500":  { label: "1/500",             description: "对快速动作清晰" },
  "shutter-1-1000": { label: "1/1000(凝固动作)", description: "凝固运动 / 野生动物" },
  "shutter-long-1s":{ label: "长曝光(1 秒)",     description: "拉丝与运动轨迹" },

  // ISO
  "iso-100":  { label: "ISO 100(纯净)",      description: "极少噪点,细腻颗粒" },
  "iso-400":  { label: "ISO 400",             description: "略带肌理的日常 ISO" },
  "iso-800":  { label: "ISO 800",             description: "可见但悦目的颗粒" },
  "iso-1600": { label: "ISO 1600(明显颗粒)", description: "大片感低光肌理" },
  "iso-3200": { label: "ISO 3200(大量颗粒)", description: "推感、纪实般粗砺" },
}

export default map
