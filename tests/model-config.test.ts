import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fallbackModelConfig,
  normalizeModelConnectionConfig,
  validateModelConnectionConfig
} from '../src/modelConfig.ts';

test('model connection config keeps existing defaults for legacy localStorage', () => {
  assert.deepEqual(normalizeModelConnectionConfig({}), fallbackModelConfig);
  assert.deepEqual(normalizeModelConnectionConfig({ chatBaseUrl: '', imageBaseUrl: '', chatModel: '', imageModel: '' }), fallbackModelConfig);
  assert.deepEqual(normalizeModelConnectionConfig({ baseUrl: 'https://legacy.example.com/v1' }), {
    ...fallbackModelConfig,
    chatBaseUrl: 'https://legacy.example.com/v1',
    imageBaseUrl: 'https://legacy.example.com/v1'
  });
});

test('model connection config trims custom values and trailing slash', () => {
  assert.deepEqual(normalizeModelConnectionConfig({
    chatBaseUrl: ' https://chat.example.com/v1/ ',
    imageBaseUrl: ' https://image.example.com/openai/ ',
    chatModel: ' custom-chat ',
    imageModel: ' custom-image '
  }), {
    chatBaseUrl: 'https://chat.example.com/v1',
    imageBaseUrl: 'https://image.example.com/openai',
    chatModel: 'custom-chat',
    imageModel: 'custom-image'
  });
});

test('model connection config rejects unsafe or incomplete values', () => {
  assert.match(validateModelConnectionConfig({ ...fallbackModelConfig, chatBaseUrl: 'file:///tmp/model' }) || '', /基础模型.*HTTP/);
  assert.match(validateModelConnectionConfig({ ...fallbackModelConfig, imageBaseUrl: 'https://user:pass@example.com/v1' }) || '', /图像模型.*账号密码/);
  assert.match(validateModelConnectionConfig({ ...fallbackModelConfig, chatModel: '' }) || '', /基础模型/);
  assert.equal(validateModelConnectionConfig({ ...fallbackModelConfig }), null);
});
