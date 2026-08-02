import { fallbackModelConfig, type ModelConnectionConfig } from './modelConfig.ts';

export type ModelCapability = 'chat' | 'image';

export type ProviderModel = {
  id: string;
  capability: ModelCapability;
};

export type ModelProvider = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
};

export type ProviderStore = {
  schemaVersion: 1;
  providers: ModelProvider[];
};

export type LegacyModelCredentials = Partial<ModelConnectionConfig> & {
  baseUrl?: string;
  chatApiKey?: string;
  imageApiKey?: string;
};

export const providerStorageKey = 'aiflow.demo.providers';
export const legacyCredentialStorageKey = 'aiflow.demo.apiKeys';

const cleanUrl = (value: unknown, fallback: string) => String(value || fallback).trim().replace(/\/$/, '');
const cleanModels = (value: unknown): ProviderModel[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  value.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const candidate = entry as Record<string, unknown>;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const capability = candidate.capability === 'image' ? 'image' : candidate.capability === 'chat' ? 'chat' : null;
    if (!capability || !id) return;
    const key = `${capability}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);
    models.push({ id, capability });
  });
  return models;
};

export function createLegacyProviders(
  legacy: LegacyModelCredentials = {},
  defaults: ModelConnectionConfig = fallbackModelConfig
): ModelProvider[] {
  const legacyUrl = typeof legacy.baseUrl === 'string' ? legacy.baseUrl : '';
  return [
    {
      id: 'provider-default-chat',
      name: '默认基础模型服务',
      baseUrl: cleanUrl(legacy.chatBaseUrl || legacyUrl, defaults.chatBaseUrl),
      apiKey: typeof legacy.chatApiKey === 'string' ? legacy.chatApiKey.trim() : '',
      models: [{ id: String(legacy.chatModel || defaults.chatModel).trim(), capability: 'chat' }]
    },
    {
      id: 'provider-default-image',
      name: '默认图像模型服务',
      baseUrl: cleanUrl(legacy.imageBaseUrl || legacyUrl, defaults.imageBaseUrl),
      apiKey: typeof legacy.imageApiKey === 'string' ? legacy.imageApiKey.trim() : '',
      models: [{ id: String(legacy.imageModel || defaults.imageModel).trim(), capability: 'image' }]
    }
  ];
}

export function normalizeProviderStore(
  value: unknown,
  legacy: LegacyModelCredentials = {},
  defaults: ModelConnectionConfig = fallbackModelConfig
): ProviderStore {
  const candidate = value && typeof value === 'object' ? value as Partial<ProviderStore> : {};
  if (!Array.isArray(candidate.providers)) return { schemaVersion: 1, providers: createLegacyProviders(legacy, defaults) };
  const providers = candidate.providers.flatMap((entry, index): ModelProvider[] => {
    if (!entry || typeof entry !== 'object') return [];
    const raw = entry as unknown as Record<string, unknown>;
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `provider-${index + 1}`;
    const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : `供应商 ${index + 1}`;
    const baseUrl = cleanUrl(raw.baseUrl, defaults.chatBaseUrl);
    const apiKey = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    return [{ id, name, baseUrl, apiKey, models: cleanModels(raw.models) }];
  });
  return { schemaVersion: 1, providers };
}

export function validateProvider(provider: ModelProvider, peers: readonly ModelProvider[] = []): string | null {
  if (!provider.name.trim()) return '供应商名称不能为空';
  if (!provider.apiKey.trim()) return 'API Key 不能为空';
  let target: URL;
  try { target = new URL(provider.baseUrl); } catch { return 'Base URL 必须是合法的 HTTP(S) 地址'; }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return 'Base URL 仅支持不含账号密码的 HTTP(S) 地址';
  if (provider.baseUrl.length > 2048) return 'Base URL 不能超过 2048 个字符';
  if (!provider.models.length) return '至少添加一个模型';
  if (provider.models.some((model) => !model.id.trim() || model.id.length > 200)) return '模型名称不能为空且不能超过 200 个字符';
  if (new Set(provider.models.map((model) => `${model.capability}:${model.id}`)).size !== provider.models.length) return '同类型模型名称不能重复';
  if (peers.some((candidate) => candidate.id === provider.id)) return '供应商连接 ID 重复';
  return null;
}

export function providersForCapability(providers: readonly ModelProvider[], capability: ModelCapability) {
  return providers.filter((provider) => provider.models.some((model) => model.capability === capability));
}

export function resolveNodeProvider(
  providers: readonly ModelProvider[],
  capability: ModelCapability,
  providerId?: unknown,
  modelId?: unknown
): { provider: ModelProvider; model: ProviderModel } | null {
  const compatible = providersForCapability(providers, capability);
  const requested = typeof providerId === 'string' ? compatible.find((provider) => provider.id === providerId) : undefined;
  const provider = requested || compatible[0];
  if (!provider) return null;
  const models = provider.models.filter((model) => model.capability === capability);
  const requestedModel = typeof modelId === 'string' ? models.find((model) => model.id === modelId) : undefined;
  const model = requestedModel || models[0];
  return model ? { provider, model } : null;
}

export function keyHint(apiKey: string) {
  return apiKey ? `••••${apiKey.slice(-4)}` : '未配置';
}
