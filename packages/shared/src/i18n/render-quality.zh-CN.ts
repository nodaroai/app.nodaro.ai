import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Engines — keep brand names in English
  "unreal-engine-5":  { description: "实时路径追踪的 UE5 渲染感" },
  "blender-cycles":   { description: "Cycles 无偏路径追踪" },
  "octane-render":    { description: "GPU 光谱路径追踪" },
  "redshift":         { description: "生产级 GPU 偏置渲染器" },
  "houdini-mantra":   { description: "VFX 级物理渲染" },

  // Render-quality keywords
  "raytracing":                 { label: "光线追踪",     description: "精准的反射与阴影" },
  "physically-based-rendering": { label: "PBR 物理渲染", description: "基于物理的材质" },
  "global-illumination":        { label: "全局光照",     description: "真实的光线反弹" },
  "lumen-reflections":          { description: "实时动态全局光照" },

  // Resolution / Detail — keep K units in alphanumeric
  "8k-uhd":         { description: "极致清晰的 8K 分辨率" },
  "4k-uhd":         { description: "锐利的 4K 分辨率" },
  "16k-megapixel":  { description: "夸张的高分辨率细节" },
  "ultra-detailed": { label: "超精细",     description: "最大化的微细节渲染" },

  // Style stamps
  "raw-photo":     { label: "原始照片",   description: "未经处理的摄影感" },
  "masterpiece":   { label: "大师级",     description: "出自高手之手的品质标签" },
  "award-winning": { label: "获奖之作",   description: "评奖级别水准" },
  "volumetric-lighting": { label: "体积光",     description: "丁达尔光柱般的体积光" },
  "photon-mapping":      { label: "光子映射",   description: "支持焦散的光子映射全局光照" },
  "ai-upscaled":         { label: "AI 升采样",  description: "神经网络放大后的细节增强" },
  "denoised":            { label: "降噪",       description: "去噪后的纯净渲染" },
}

export default map
