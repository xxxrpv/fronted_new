/**
 * 将 AG-UI 事件归并为页面消息，保持流协议与 React 界面独立。
 * 本文件不执行网络请求、不选择发布版本，也不将消息写入浏览器存储。
 * 重连游标由会话层去重；此处只处理已经确认未消费的事件。
 * 消息快照按 ID 合并，避免压缩上下文中的近期快照覆盖用户已加载的较早历史。
 * 保留工具参数和工具返回，方便用户理解真实执行过程；忽略无展示需求的状态事件。
 */
import type { Message, ToolCall } from './types';

export type Event = Record<string, unknown>;
export function mergeMessages(old: Message[], incoming: Message[]): Message[] {
  const values = new Map(old.map(row => [row.id, row]));
  for (const row of incoming) {
    if (!row || typeof row.id !== 'string' || !['user', 'assistant', 'tool'].includes(row.role)) throw new Error('消息格式异常');
    if (typeof row.content !== 'string' && row.content != null) throw new Error('消息正文格式异常');
    values.set(row.id, row);
  }
  return [...values.values()];
}
export function reduceMessages(messages: Message[], event: Event): Message[] {
  const id = typeof event.messageId === 'string' ? event.messageId : '';
  if (event.type === 'MESSAGES_SNAPSHOT') {
    if (!Array.isArray(event.messages)) throw new Error('消息快照格式异常');
    return mergeMessages(messages, event.messages as Message[]);
  }
  if (['TEXT_MESSAGE_START', 'TEXT_MESSAGE_CONTENT', 'TEXT_MESSAGE_CHUNK'].includes(String(event.type))) {
    if (!id) throw new Error('消息标识缺失');
    const old = messages.find(m => m.id === id);
    if (old && old.role !== 'assistant') throw new Error('消息角色冲突');
    if (event.type === 'TEXT_MESSAGE_START') return old ? messages : mergeMessages(messages, [{ id, role: 'assistant', content: '' }]);
    if (typeof event.delta !== 'string') throw new Error('消息增量格式异常');
    return mergeMessages(messages, [{ ...(old || { id, role: 'assistant' as const }), content: (old?.content || '') + event.delta }]);
  }
  const toolId = typeof event.toolCallId === 'string' ? event.toolCallId : '';
  if (event.type === 'TOOL_CALL_START') {
    if (!toolId || typeof event.toolCallName !== 'string') throw new Error('工具事件格式异常');
    const parent = typeof event.parentMessageId === 'string' ? event.parentMessageId : `tool-parent-${toolId}`;
    const old = messages.find(m => m.id === parent);
    if (old && old.role !== 'assistant') throw new Error('工具消息角色冲突');
    const call: ToolCall = { id: toolId, type: 'function', function: { name: event.toolCallName, arguments: '' } };
    return mergeMessages(messages, [{ ...(old || { id: parent, role: 'assistant' as const }), toolCalls: [...(old?.toolCalls || []).filter(c => c.id !== toolId), call] }]);
  }
  if (event.type === 'TOOL_CALL_ARGS') {
    if (!toolId || typeof event.delta !== 'string') throw new Error('工具参数格式异常');
    const delta = event.delta;
    return messages.map(row => ({ ...row, toolCalls: row.toolCalls?.map(call => call.id !== toolId ? call : {
      ...call, function: { ...call.function, arguments: call.function.arguments + delta },
    }) }));
  }
  if (event.type === 'TOOL_CALL_RESULT') {
    if (!id || !toolId || typeof event.content !== 'string') throw new Error('工具结果格式异常');
    return mergeMessages(messages, [{ id, role: 'tool', toolCallId: toolId, content: event.content }]);
  }
  return messages;
}

export async function readEvents(response: Response, cursor: number, apply: (event: Event, sequence: number) => boolean): Promise<number> {
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('事件订阅格式异常');
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replaceAll('\r\n', '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        if (frame.length > 1048576) throw new Error('事件超出长度限制');
        const lines = frame.split('\n');
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (!data) continue;
        const raw = lines.find(line => line.startsWith('id:'))?.slice(3).trim();
        if (!raw || !/^\d+$/.test(raw)) throw new Error('事件游标缺失');
        const sequence = Number(raw);
        if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('事件游标无效');
        if (sequence <= cursor) continue;
        const event: unknown = JSON.parse(data);
        if (!event || typeof event !== 'object' || Array.isArray(event) || typeof (event as Event).type !== 'string') throw new Error('事件格式异常');
        const stop = apply(event as Event, sequence); cursor = sequence;
        if (stop) return cursor;
      }
      if (buffer.length > 1048576) throw new Error('事件超出长度限制');
      if (done) break;
    }
    if (buffer.trim()) throw new Error('事件流未完整结束');
    return cursor;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
