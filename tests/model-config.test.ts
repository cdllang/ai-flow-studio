import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fallbackModelConfig,
  normalizeModelConnectionConfig,
  validateModelConnectionConfig
} from '../src/modelConfig.ts';

test('model connection config keeps existing defaults for legacy localStorage', () => {
  assert.deepEqual(normalizeModelConnectionConfig({}), fallbackModelConfig);
  assert.deepEqual(normalizeModelConnectionConfig({ baseUrl: '', chatModel: '', imageModel: '' }), fallbackModelConfig);
});

test('model connection config trims custom values and trailing slash', () => {
  assert.deepEqual(normalizeModelConnectionConfig({
    baseUrl: ' https://gateway.example.com/v1/ ',
    chatModel: ' custom-chat ',
    imageModel: ' custom-image '
  }), {
    baseUrl: 'https://gateway.example.com/v1',
    chatModel: 'custom-chat',
    imageModel: 'custom-image'
  });
});

test('model connection config rejects unsafe or incomplete values', () => {
  assert.match(validateModelConnectionConfig({ ...fallbackModelConfig, baseUrl: 'file:///tmp/model' }) || '', /HTTP/);
  assert.match(validateModelConnectionConfig({ ...fallbackModelConfig, baseUrl: 'https://user:pass@example.com/v1' }) || '', /账号密码/);
  assert.match(validateModelConnectionConfig({ ...fallbackModelConfig, chatModel: '' }) || '', /基础模型/);
  assert.equal(validateModelConnectionConfig({ ...fallbackModelConfig }), null);
});
