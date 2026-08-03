import assert from 'node:assert/strict';
import test from 'node:test';
import { AssistantTransportError, readAssistantTurnResponse } from '../src/assistantTransport.ts';

test('assistant transport converts an empty HTTP response into a structured error', async () => {
  const response = new Response('', {
    status: 504,
    headers: { 'x-request-id': 'proxy-request-1' }
  });

  await assert.rejects(
    () => readAssistantTurnResponse(response),
    (error: unknown) => {
      assert.ok(error instanceof AssistantTransportError);
      assert.equal(error.code, 'ASSISTANT_EMPTY_RESPONSE');
      assert.equal(error.status, 504);
      assert.equal(error.requestId, 'proxy-request-1');
      assert.doesNotMatch(error.message, /Unexpected end of JSON input/);
      return true;
    }
  );
});

test('assistant transport rejects a non-JSON response without leaking its body', async () => {
  const response = new Response('<html>gateway error</html>', {
    status: 502,
    headers: { 'content-type': 'text/html' }
  });

  await assert.rejects(
    () => readAssistantTurnResponse(response),
    (error: unknown) => {
      assert.ok(error instanceof AssistantTransportError);
      assert.equal(error.code, 'ASSISTANT_INVALID_RESPONSE');
      assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /<html>/);
      return true;
    }
  );
});

test('assistant transport consumes NDJSON stage updates before the final result', async () => {
  const events = [
    { type: 'stage', index: 0, stage: { stage: 'intent', status: 'running', detail: '正在识别输入与输出' } },
    { type: 'heartbeat', at: Date.now() },
    { type: 'stage', index: 0, stage: { stage: 'intent', status: 'success', detail: '输入与输出已识别' } },
    { type: 'result', status: 200, body: { schemaVersion: 1, requestId: 'request-2', stages: [] } }
  ];
  const response = new Response(events.map((event) => JSON.stringify(event)).join('\n') + '\n', {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' }
  });
  const progress: Array<{ index: number; status: string }> = [];

  const result = await readAssistantTurnResponse(response, (event) => progress.push({ index: event.index, status: event.stage.status }));

  assert.equal(result.status, 200);
  assert.equal(result.data.requestId, 'request-2');
  assert.deepEqual(progress, [{ index: 0, status: 'running' }, { index: 0, status: 'success' }]);
});

test('assistant transport reports a stream that ends before its final result', async () => {
  const response = new Response(`${JSON.stringify({ type: 'stage', index: 0, stage: { stage: 'intent', status: 'running', detail: '处理中' } })}\n`, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson', 'x-request-id': 'stream-request-3' }
  });

  await assert.rejects(
    () => readAssistantTurnResponse(response),
    (error: unknown) => {
      assert.ok(error instanceof AssistantTransportError);
      assert.equal(error.code, 'ASSISTANT_STREAM_INCOMPLETE');
      assert.equal(error.requestId, 'stream-request-3');
      return true;
    }
  );
});
