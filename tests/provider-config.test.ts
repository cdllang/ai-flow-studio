import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeProviderStore,
  providersForCapability,
  resolveNodeProvider,
  validateProvider,
  type ModelProvider
} from '../src/providerConfig.ts';

test('legacy browser credentials migrate into gateway-bound provider connections', () => {
  const store = normalizeProviderStore(undefined, {
    chatBaseUrl: 'https://chat.example.com/v1/',
    imageBaseUrl: 'https://image.example.com/v1/',
    chatApiKey: 'chat-secret',
    imageApiKey: 'image-secret',
    chatModel: 'chat-a',
    imageModel: 'image-a'
  });
  assert.deepEqual(store.providers.map((provider) => ({ baseUrl: provider.baseUrl, apiKey: provider.apiKey, models: provider.models })), [
    { baseUrl: 'https://chat.example.com/v1', apiKey: 'chat-secret', models: [{ id: 'chat-a', capability: 'chat' }] },
    { baseUrl: 'https://image.example.com/v1', apiKey: 'image-secret', models: [{ id: 'image-a', capability: 'image' }] }
  ]);
});

test('provider normalization keeps user-added mixed model lists and removes duplicates', () => {
  const store = normalizeProviderStore({ schemaVersion: 1, providers: [{
    id: 'vendor-a',
    name: ' Vendor A ',
    baseUrl: 'https://vendor.example.com/v1/',
    apiKey: ' secret ',
    models: [
      { id: 'chat-pro', capability: 'chat' },
      { id: 'chat-pro', capability: 'chat' },
      { id: 'image-pro', capability: 'image' }
    ]
  }] });
  assert.deepEqual(store.providers[0], {
    id: 'vendor-a',
    name: 'Vendor A',
    baseUrl: 'https://vendor.example.com/v1',
    apiKey: 'secret',
    models: [{ id: 'chat-pro', capability: 'chat' }, { id: 'image-pro', capability: 'image' }]
  });
});

test('nodes resolve their selected key and model instead of a global credential', () => {
  const providers: ModelProvider[] = [
    { id: 'one', name: 'One', baseUrl: 'https://one.example/v1', apiKey: 'key-one', models: [{ id: 'chat-1', capability: 'chat' }] },
    { id: 'two', name: 'Two', baseUrl: 'https://two.example/v1', apiKey: 'key-two', models: [{ id: 'chat-2', capability: 'chat' }, { id: 'image-2', capability: 'image' }] }
  ];
  assert.equal(resolveNodeProvider(providers, 'chat', 'two', 'chat-2')?.provider.apiKey, 'key-two');
  assert.equal(resolveNodeProvider(providers, 'image', 'two', 'image-2')?.model.id, 'image-2');
  assert.deepEqual(providersForCapability(providers, 'image').map((provider) => provider.id), ['two']);
});

test('provider validation requires key, safe URL and at least one user-defined model', () => {
  const valid: ModelProvider = { id: 'vendor', name: 'Vendor', baseUrl: 'https://vendor.example/v1', apiKey: 'secret', models: [{ id: 'chat', capability: 'chat' }] };
  assert.equal(validateProvider(valid), null);
  assert.match(validateProvider({ ...valid, apiKey: '' }) || '', /API Key/);
  assert.match(validateProvider({ ...valid, baseUrl: 'file:///model' }) || '', /HTTP/);
  assert.match(validateProvider({ ...valid, models: [] }) || '', /至少/);
});
