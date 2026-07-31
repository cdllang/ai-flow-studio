export const fallbackModelConfig = {
  baseUrl: 'https://ai.aiwanai.com.cn/v1',
  chatModel: 'gpt-5.4-mini',
  imageModel: 'gpt-image-2-count'
} as const;

export type ModelConnectionConfig = {
  baseUrl: string;
  chatModel: string;
  imageModel: string;
};

export function normalizeModelConnectionConfig(
  value: unknown,
  defaults: ModelConnectionConfig = fallbackModelConfig
): ModelConnectionConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (key: keyof ModelConnectionConfig) => typeof source[key] === 'string' && source[key].trim()
    ? source[key].trim()
    : defaults[key];
  return { baseUrl: text('baseUrl').replace(/\/$/, ''), chatModel: text('chatModel'), imageModel: text('imageModel') };
}

export function validateModelConnectionConfig(config: ModelConnectionConfig): string | null {
  let target: URL;
  try {
    target = new URL(config.baseUrl);
  } catch {
    return 'Base URL 必须是合法的 HTTP(S) 地址';
  }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
    return 'Base URL 仅支持不含账号密码的 HTTP(S) 地址';
  }
  if (config.baseUrl.length > 2048) return 'Base URL 不能超过 2048 个字符';
  if (!config.chatModel.trim() || config.chatModel.length > 200) return '基础模型名称不能为空且不能超过 200 个字符';
  if (!config.imageModel.trim() || config.imageModel.length > 200) return '图像模型名称不能为空且不能超过 200 个字符';
  return null;
}
