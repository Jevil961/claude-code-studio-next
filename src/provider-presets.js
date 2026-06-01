// Provider presets for quick setup
// Each preset defines the API format, base URL, and available models

export const API_FORMATS = {
  anthropic: { name: "Anthropic 原生", desc: "Anthropic 官方 API 格式" },
  openai: { name: "OpenAI 兼容", desc: "OpenAI 格式 (大多数第三方支持)" },
  gemini: { name: "Google Gemini", desc: "Google Gemini API 格式" },
};

export const PROVIDER_PRESETS = [
  // ── Anthropic 原生 ──
  {
    id: "anthropic",
    name: "Anthropic",
    icon: "🟣",
    apiFormat: "anthropic",
    baseUrl: "https://api.anthropic.com",
    models: [
      { id: "claude-opus-4-20250514", name: "Claude Opus 4", tier: "opus" },
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4", tier: "sonnet" },
      { id: "claude-haiku-3-5-20241022", name: "Claude Haiku 3.5", tier: "haiku" },
    ],
  },

  // ── OpenAI ──
  {
    id: "openai",
    name: "OpenAI",
    icon: "🟢",
    apiFormat: "openai",
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-4o", name: "GPT-4o", tier: "sonnet" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", tier: "haiku" },
      { id: "gpt-4-turbo", name: "GPT-4 Turbo", tier: "opus" },
      { id: "o1-preview", name: "o1 Preview", tier: "opus" },
      { id: "o1-mini", name: "o1 Mini", tier: "sonnet" },
    ],
  },

  // ── DeepSeek ──
  {
    id: "deepseek",
    name: "DeepSeek",
    icon: "🔵",
    apiFormat: "anthropic",
    baseUrl: "https://api.deepseek.com/anthropic",
    models: [
      { id: "deepseek-chat", name: "DeepSeek V3", tier: "sonnet" },
      { id: "deepseek-reasoner", name: "DeepSeek R1", tier: "opus" },
    ],
    altFormat: {
      apiFormat: "openai",
      baseUrl: "https://api.deepseek.com/v1",
      models: [
        { id: "deepseek-chat", name: "DeepSeek V3 (OpenAI)", tier: "sonnet" },
        { id: "deepseek-reasoner", name: "DeepSeek R1 (OpenAI)", tier: "opus" },
      ],
    },
  },

  // ── Google Gemini ──
  {
    id: "gemini",
    name: "Google Gemini",
    icon: "🔴",
    apiFormat: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    models: [
      { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "opus" },
      { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "sonnet" },
      { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", tier: "haiku" },
    ],
  },

  // ── 阿里云通义 ──
  {
    id: "aliyun",
    name: "阿里云通义",
    icon: "🟠",
    apiFormat: "openai",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen-max", name: "通义千问 Max", tier: "opus" },
      { id: "qwen-plus", name: "通义千问 Plus", tier: "sonnet" },
      { id: "qwen-turbo", name: "通义千问 Turbo", tier: "haiku" },
      { id: "qwen-coder-plus", name: "通义 Coder Plus", tier: "sonnet" },
    ],
  },

  // ── 智谱 ──
  {
    id: "zhipu",
    name: "智谱 AI",
    icon: "🟤",
    apiFormat: "openai",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { id: "glm-4-plus", name: "GLM-4 Plus", tier: "opus" },
      { id: "glm-4-flash", name: "GLM-4 Flash", tier: "sonnet" },
      { id: "glm-4-long", name: "GLM-4 Long", tier: "sonnet" },
      { id: "codegeex-4", name: "CodeGeeX-4", tier: "haiku" },
    ],
  },

  // ── Moonshot ──
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    icon: "🌙",
    apiFormat: "openai",
    baseUrl: "https://api.moonshot.cn/v1",
    models: [
      { id: "moonshot-v1-128k", name: "Moonshot V1 128K", tier: "opus" },
      { id: "moonshot-v1-32k", name: "Moonshot V1 32K", tier: "sonnet" },
      { id: "moonshot-v1-8k", name: "Moonshot V1 8K", tier: "haiku" },
    ],
  },

  // ── 字节豆包 ──
  {
    id: "doubao",
    name: "字节豆包",
    icon: "🫘",
    apiFormat: "openai",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [
      { id: "doubao-pro-256k", name: "豆包 Pro 256K", tier: "opus" },
      { id: "doubao-pro-32k", name: "豆包 Pro 32K", tier: "sonnet" },
      { id: "doubao-lite-32k", name: "豆包 Lite 32K", tier: "haiku" },
    ],
  },

  // ── 百度文心 ──
  {
    id: "baidu",
    name: "百度文心",
    icon: "🐾",
    apiFormat: "openai",
    baseUrl: "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop",
    models: [
      { id: "ernie-4.0-turbo", name: "文心 4.0 Turbo", tier: "opus" },
      { id: "ernie-4.0", name: "文心 4.0", tier: "sonnet" },
      { id: "ernie-3.5", name: "文心 3.5", tier: "haiku" },
    ],
  },

  // ── Silicon Flow ──
  {
    id: "siliconflow",
    name: "Silicon Flow",
    icon: "⚡",
    apiFormat: "openai",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3", tier: "sonnet" },
      { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1", tier: "opus" },
      { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B", tier: "sonnet" },
      { id: "meta-llama/Meta-Llama-3.1-70B-Instruct", name: "Llama 3.1 70B", tier: "sonnet" },
    ],
  },

  // ── OpenRouter ──
  {
    id: "openrouter",
    name: "OpenRouter",
    icon: "🔀",
    apiFormat: "openai",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet", tier: "sonnet" },
      { id: "openai/gpt-4o", name: "GPT-4o", tier: "sonnet" },
      { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash", tier: "haiku" },
      { id: "deepseek/deepseek-chat", name: "DeepSeek V3", tier: "sonnet" },
      { id: "meta-llama/llama-3.1-405b-instruct", name: "Llama 3.1 405B", tier: "opus" },
    ],
  },

  // ── Groq ──
  {
    id: "groq",
    name: "Groq",
    icon: "⚡",
    apiFormat: "openai",
    baseUrl: "https://api.groq.com/openai/v1",
    models: [
      { id: "llama-3.1-70b-versatile", name: "Llama 3.1 70B", tier: "sonnet" },
      { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", tier: "haiku" },
      { id: "mixtral-8x7b-32768", name: "Mixtral 8x7B", tier: "sonnet" },
    ],
  },

  // ── 自定义 ──
  {
    id: "custom",
    name: "自定义",
    icon: "🔧",
    apiFormat: "openai",
    baseUrl: "",
    models: [],
  },
];

export function getPresetById(id) {
  return PROVIDER_PRESETS.find(p => p.id === id) || null;
}

export function getModelTierLabel(tier) {
  return { opus: "Opus (最强)", sonnet: "Sonnet (平衡)", haiku: "Haiku (快速)" }[tier] || tier;
}

export function getApiFormatLabel(format) {
  return API_FORMATS[format]?.name || format;
}
