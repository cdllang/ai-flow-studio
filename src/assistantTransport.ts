import type { AssistantStage } from './assistantSession';

export type AssistantStageProgress = { index: number; stage: AssistantStage };

export class AssistantTransportError extends Error {
  code: string;
  status: number;
  requestId: string;

  constructor(message: string, code: string, status: number, requestId = '') {
    super(message);
    this.name = 'AssistantTransportError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

type AssistantStreamEvent<T> =
  | { type: 'stage'; index: number; stage: AssistantStage }
  | { type: 'heartbeat' }
  | { type: 'result'; status: number; body: T };

const requestIdFrom = (response: Response) => response.headers.get('x-aiflow-request-id')
  || response.headers.get('x-request-id')
  || '';

const httpLabel = (status: number) => status > 0 ? `HTTP ${status}` : '未知状态';

const emptyResponseError = (response: Response) => new AssistantTransportError(
  `AI 工作流服务返回空响应（${httpLabel(response.status)}）。连接可能被反向代理超时截断，请重试；若持续发生请检查代理读取超时。`,
  'ASSISTANT_EMPTY_RESPONSE',
  response.status,
  requestIdFrom(response)
);

const invalidResponseError = (response: Response) => new AssistantTransportError(
  `AI 工作流服务返回了无法解析的响应（${httpLabel(response.status)}），未修改当前画布。`,
  'ASSISTANT_INVALID_RESPONSE',
  response.status,
  requestIdFrom(response)
);

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError';
}

function parseStreamEvent<T>(line: string, response: Response): AssistantStreamEvent<T> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(line);
  } catch {
    throw new AssistantTransportError(
      'AI 工作流阶段流包含无法解析的数据，已停止应用结果。',
      'ASSISTANT_STREAM_INVALID',
      response.status,
      requestIdFrom(response)
    );
  }
  if (!candidate || typeof candidate !== 'object') throw invalidResponseError(response);
  const event = candidate as Record<string, unknown>;
  if (event.type === 'stage') {
    const stage = event.stage as Partial<AssistantStage> | undefined;
    if (!Number.isInteger(event.index) || !stage || typeof stage.stage !== 'string'
      || !['running', 'success', 'error'].includes(String(stage.status)) || typeof stage.detail !== 'string') {
      throw invalidResponseError(response);
    }
    return { type: 'stage', index: event.index as number, stage: stage as AssistantStage };
  }
  if (event.type === 'heartbeat') return { type: 'heartbeat' };
  if (event.type === 'result' && Number.isInteger(event.status) && event.body && typeof event.body === 'object') {
    return { type: 'result', status: event.status as number, body: event.body as T };
  }
  throw invalidResponseError(response);
}

async function readNdjsonResponse<T>(response: Response, onStage?: (event: AssistantStageProgress) => void) {
  if (!response.body) throw emptyResponseError(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: { status: number; data: T } | null = null;
  const consumeLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const event = parseStreamEvent<T>(trimmed, response);
    if (event.type === 'stage') onStage?.(event);
    else if (event.type === 'result') result = { status: event.status, data: event.body };
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(consumeLine);
    }
    buffer += decoder.decode();
    consumeLine(buffer);
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof AssistantTransportError) throw error;
    throw new AssistantTransportError(
      'AI 工作流构建连接在传输阶段结果时中断，请重试。',
      'ASSISTANT_STREAM_INTERRUPTED',
      response.status,
      requestIdFrom(response)
    );
  }

  if (!result) {
    throw new AssistantTransportError(
      'AI 工作流构建连接提前结束，未收到最终校验结果，当前画布保持不变。',
      'ASSISTANT_STREAM_INCOMPLETE',
      response.status,
      requestIdFrom(response)
    );
  }
  return result;
}

export async function readAssistantTurnResponse<T = Record<string, unknown>>(
  response: Response,
  onStage?: (event: AssistantStageProgress) => void
): Promise<{ status: number; data: T }> {
  if ((response.headers.get('content-type') || '').toLowerCase().includes('application/x-ndjson')) {
    return readNdjsonResponse<T>(response, onStage);
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new AssistantTransportError(
      '无法读取 AI 工作流服务响应，请检查网络连接后重试。',
      'ASSISTANT_RESPONSE_READ_FAILED',
      response.status,
      requestIdFrom(response)
    );
  }
  if (!text.trim()) throw emptyResponseError(response);
  try {
    return { status: response.status, data: JSON.parse(text) as T };
  } catch {
    throw invalidResponseError(response);
  }
}
