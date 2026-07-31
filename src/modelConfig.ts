export const fallbackModelConfig = {
  chatBaseUrl: 'https://ai.aiwanai.com.cn/v1',
  imageBaseUrl: 'https://ai.aiwanai.com.cn/v1',
  chatModel: 'gpt-5.4-mini',
  imageModel: 'gpt-image-2-count'
} as const;

export type ModelConnectionConfig = {
  chatBaseUrl: string;
  imageBaseUrl: string;
  chatModel: string;
  imageModel: string;
};

export function normalizeModelConnectionConfig(
  value: unknown,
  defaults: ModelConnectionConfig = fallbackModelConfig
): ModelConnectionConfig {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const legacyBaseUrl = typeof source.baseUrl === 'string' ? source.baseUrl.trim() : '';
  const text = (key: keyof ModelConnectionConfig) => typeof source[key] === 'string' && source[key].trim()
    ? source[key].trim()
    : defaults[key];
  const url = (key: 'chatBaseUrl' | 'imageBaseUrl') => {
    const value = typeof source[key] === 'string' && source[key].trim() ? source[key].trim() : legacyBaseUrl || defaults[key];
    return value.replace(/\/$/, '');
  };
  return { chatBaseUrl: url('chatBaseUrl'), imageBaseUrl: url('imageBaseUrl'), chatModel: text('chatModel'), imageModel: text('imageModel') };
}

export function validateModelConnectionConfig(config: ModelConnectionConfig): string | null {
  for (const [label, value] of [['基础模型', config.chatBaseUrl], ['图像模型', config.imageBaseUrl]] as const) {
    let target: URL;
    try {
      target = new URL(value);
    } catch {
      return `${label} Base URL 必须是合法的 HTTP(S) 地址`;
    }
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) {
      return `${label} Base URL 仅支持不含账号密码的 HTTP(S) 地址`;
    }
    if (value.length > 2048) return `${label} Base URL 不能超过 2048 个字符`;
  }
  if (!config.chatModel.trim() || config.chatModel.length > 200) return '基础模型名称不能为空且不能超过 200 个字符';
  if (!config.imageModel.trim() || config.imageModel.length > 200) return '图像模型名称不能为空且不能超过 200 个字符';
  return null;
}
