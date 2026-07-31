import 'dotenv/config';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: '.env.local', override: false });

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 14590);
const host = process.env.HOST || '0.0.0.0';
const baseUrl = (process.env.AIWANAI_BASE_URL || 'https://ai.aiwanai.com.cn/v1').replace(/\/$/, '');
const chatBaseUrl = (process.env.AIWANAI_CHAT_BASE_URL || baseUrl).replace(/\/$/, '');
const imageBaseUrl = (process.env.AIWANAI_IMAGE_BASE_URL || baseUrl).replace(/\/$/, '');
const defaultChatModel = process.env.AIWANAI_DEFAULT_CHAT_MODEL || 'gpt-5.4-mini';
const imageModel = process.env.AIWANAI_IMAGE_MODEL || 'gpt-image-2';
const safeError = (error) => error instanceof Error ? error.message : 'Unknown upstream error';

app.use(express.json({ limit: '16mb' }));

const requestId = () => `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const requestApiKey = (req) => {
  const value = req.get('x-aiflow-api-key');
  return typeof value === 'string' && value.length <= 4096 ? value.trim() : '';
};
const privateHostname = (hostname) => {
  const value = hostname.toLowerCase();
  return value === 'localhost' || value === '0.0.0.0' || value === '::1' || value.startsWith('127.') || value.startsWith('10.') || value.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[01])\./.test(value) || value === '169.254.169.254';
};
const requestBaseUrl = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Base URL 格式无效');
  let target;
  try { target = new URL(value.trim()); } catch { throw new Error('Base URL 必须是合法的 HTTP(S) 地址'); }
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) throw new Error('Base URL 仅支持不含账号密码的 HTTP(S) 地址');
  if (privateHostname(target.hostname) && String(process.env.ALLOW_PRIVATE_MODEL_BASE_URL).toLowerCase() !== 'true') throw new Error('Base URL 不能指向本机或私有网络地址');
  return target.toString().replace(/\/$/, '');
};
const requestModel = (value, fallback) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error('模型名称不能为空且不能超过 200 个字符');
  return value.trim();
};
const publicConfig = () => ({
  baseUrl,
  chatBaseUrl,
  imageBaseUrl,
  chatConfigured: false,
  imageConfigured: false,
  chatKeyHint: null,
  imageKeyHint: null,
  defaultChatModel,
  imageModel,
  credentialStorage: 'browser-localStorage'
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'AIFlow Studio local gateway' });
});

app.get('/api/config/status', (_req, res) => {
  res.set('Cache-Control', 'no-store').json(publicConfig());
});

app.post('/api/chat', async (req, res) => {
  const id = requestId();
  const chatApiKey = requestApiKey(req);
  if (!chatApiKey) {
    return res.status(503).json({ code: 'CHAT_KEY_MISSING', message: '基础模型 Key 未配置', requestId: id });
  }

  const { prompt, system, model, baseUrl: customBaseUrl, temperature = 0.7 } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ code: 'PROMPT_REQUIRED', message: '请输入提示词', requestId: id });
  }

  let upstreamBaseUrl;
  let upstreamModel;
  try {
    upstreamBaseUrl = requestBaseUrl(customBaseUrl, chatBaseUrl);
    upstreamModel = requestModel(model, defaultChatModel);
  } catch (error) {
    return res.status(400).json({ code: 'MODEL_CONFIG_INVALID', message: safeError(error), requestId: id });
  }

  try {
    const response = await fetch(`${upstreamBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${chatApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: upstreamModel,
        messages: [
          ...(system ? [{ role: 'system', content: String(system) }] : []),
          { role: 'user', content: prompt }
        ],
        temperature,
        stream: false
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        code: 'CHAT_UPSTREAM_ERROR',
        message: data?.error?.message || `模型服务返回 ${response.status}`,
        requestId: id
      });
    }
    return res.json({
      text: data?.choices?.[0]?.message?.content ?? '',
      usage: data?.usage ?? null,
      model: data?.model || upstreamModel,
      requestId: id
    });
  } catch (error) {
    return res.status(502).json({ code: 'CHAT_NETWORK_ERROR', message: safeError(error), requestId: id });
  }
});

app.post('/api/images', async (req, res) => {
  const id = requestId();
  const imageApiKey = requestApiKey(req);
  if (!imageApiKey) {
    return res.status(503).json({ code: 'IMAGE_KEY_MISSING', message: '图像模型 Key 未配置', requestId: id });
  }
  const { prompt, size = '1024x1024', quality = 'high', count = 1, referenceImage = null, baseUrl: customBaseUrl, model } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ code: 'PROMPT_REQUIRED', message: '请输入图像提示词', requestId: id });
  }
  const imageCount = Number(count);
  if (!Number.isInteger(imageCount) || imageCount < 1 || imageCount > 4) {
    return res.status(400).json({ code: 'INVALID_IMAGE_COUNT', message: '单个图像节点每次可生成 1–4 张图片', requestId: id });
  }
  if (referenceImage !== null && (typeof referenceImage !== 'object' || typeof referenceImage.dataUrl !== 'string')) {
    return res.status(400).json({ code: 'INVALID_REFERENCE_IMAGE', message: '参考图片格式无效', requestId: id });
  }

  let upstreamBaseUrl;
  let upstreamModel;
  try {
    upstreamBaseUrl = requestBaseUrl(customBaseUrl, imageBaseUrl);
    upstreamModel = requestModel(model, imageModel);
  } catch (error) {
    return res.status(400).json({ code: 'MODEL_CONFIG_INVALID', message: safeError(error), requestId: id });
  }

  let imageInput = null;
  if (referenceImage) {
    const match = referenceImage.dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match) {
      return res.status(400).json({ code: 'INVALID_REFERENCE_IMAGE', message: '参考图片仅支持 PNG、JPEG 或 WebP', requestId: id });
    }
    const bytes = Buffer.from(match[2], 'base64');
    if (bytes.length > 10 * 1024 * 1024) {
      return res.status(413).json({ code: 'REFERENCE_IMAGE_TOO_LARGE', message: '参考图片不能超过 10 MB', requestId: id });
    }
    const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
    imageInput = {
      blob: new Blob([bytes], { type: match[1] }),
      filename: typeof referenceImage.name === 'string' && referenceImage.name.trim() ? referenceImage.name : `reference.${extension}`
    };
  }

  try {
    let response;
    let data;
    let attempts = 0;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      attempts = attempt;
      if (imageInput) {
        const form = new FormData();
        form.append('model', upstreamModel);
        form.append('prompt', prompt);
        form.append('size', size);
        form.append('quality', quality);
        form.append('n', String(imageCount));
        form.append('image', imageInput.blob, imageInput.filename);
        response = await fetch(`${upstreamBaseUrl}/images/edits`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${imageApiKey}` },
          body: form
        });
      } else {
        response = await fetch(`${upstreamBaseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${imageApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ model: upstreamModel, prompt, size, quality, n: imageCount })
        });
      }
      data = await response.json().catch(() => ({}));
      if (response.ok) break;
      const message = data?.error?.message || '';
      const retryable = response.status === 429 || response.status >= 500 || message.includes('无可用渠道');
      if (!retryable || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 1500 : 4000));
    }
    if (!response.ok) {
      const upstreamMessage = data?.error?.message || `图像服务返回 ${response.status}`;
      if (String(process.env.IMAGE_DEMO_FALLBACK).toLowerCase() === 'true') {
        const images = Array.from({ length: imageCount }, (_, index) => ({
          id: `${id}-${index + 1}`,
          url: '/assets/case-template-1.jpg',
          base64: null,
          revisedPrompt: null
        }));
        return res.json({
          ...images[0],
          images,
          model: upstreamModel,
          mode: imageInput ? 'edit' : 'generate',
          simulated: true,
          attempts,
          warning: `图像渠道暂不可用，已使用品牌演示素材：${upstreamMessage}`,
          requestId: id
        });
      }
      return res.status(response.status).json({
        code: 'IMAGE_UPSTREAM_ERROR',
        message: `${upstreamMessage}；请确认模型渠道配置`,
        requestId: id
      });
    }
    const images = (Array.isArray(data?.data) ? data.data : []).map((item, index) => ({
      id: `${id}-${index + 1}`,
      url: item?.url ?? null,
      base64: item?.b64_json ?? null,
      revisedPrompt: item?.revised_prompt ?? null
    })).filter((item) => item.url || item.base64);
    const first = images[0] ?? {};
    return res.json({
      url: first.url ?? null,
      base64: first.base64 ?? null,
      revisedPrompt: first.revisedPrompt ?? null,
      images,
      count: images.length,
      model: upstreamModel,
      mode: imageInput ? 'edit' : 'generate',
      simulated: false,
      attempts,
      requestId: id
    });
  } catch (error) {
    return res.status(502).json({ code: 'IMAGE_NETWORK_ERROR', message: safeError(error), requestId: id });
  }
});

app.post('/api/http', async (req, res) => {
  const id = requestId();
  const { method = 'GET', url, headers = {}, body = '' } = req.body ?? {};
  const allowedMethods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  if (!allowedMethods.has(method)) {
    return res.status(400).json({ code: 'HTTP_METHOD_INVALID', message: '不支持的 HTTP 方法', requestId: id });
  }

  let target;
  try {
    target = new URL(url);
  } catch {
    return res.status(400).json({ code: 'HTTP_URL_INVALID', message: '请输入合法的 HTTP(S) URL', requestId: id });
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    return res.status(400).json({ code: 'HTTP_PROTOCOL_INVALID', message: 'HTTP 节点仅允许 http:// 或 https://', requestId: id });
  }
  if (privateHostname(target.hostname)) {
    return res.status(403).json({ code: 'HTTP_PRIVATE_ADDRESS_BLOCKED', message: '为保护本机安全，HTTP 节点不能访问本地或私有网络地址', requestId: id });
  }

  const safeHeaders = {};
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    for (const [key, value] of Object.entries(headers)) {
      if (!['host', 'content-length', 'connection'].includes(key.toLowerCase()) && typeof value === 'string') safeHeaders[key] = value;
    }
  }

  try {
    const response = await fetch(target, {
      method,
      headers: safeHeaders,
      body: method === 'GET' ? undefined : String(body || ''),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000)
    });
    const contentType = response.headers.get('content-type') || '';
    const text = await response.text();
    let responseBody = text;
    if (contentType.includes('application/json')) {
      try { responseBody = JSON.parse(text); } catch { responseBody = text; }
    }
    return res.json({
      status: response.status,
      ok: response.ok,
      contentType,
      body: responseBody,
      requestId: id
    });
  } catch (error) {
    return res.status(502).json({ code: 'HTTP_REQUEST_FAILED', message: safeError(error), requestId: id });
  }
});

const dist = path.resolve(root, process.env.STATIC_DIR || 'dist');
app.use(express.static(dist));
app.use((_req, res, next) => {
  if (process.env.NODE_ENV !== 'production') return next();
  res.sendFile(path.join(dist, 'index.html'));
});

const server = app.listen(port, host, () => {
  console.log(`[AIFlow] API running at http://${host}:${port}`);
});

const shutdown = (signal) => {
  console.log(`[AIFlow] ${signal} received, shutting down...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
