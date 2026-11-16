/**
 * GLB / GLTF 产物安全解析预检工具 (Task-036 R2)
 *
 * 约束：
 * 严禁加载任何未经平台授权的外部资源协议（包括预存 blob:、http:、https:、ftp:、file:、相对路径及协议相对路径），
 * 仅允许内嵌 data: 资源或在受控闭包内动态解析的二进制流。
 */

export function validateGlbSecurity(buffer: ArrayBuffer): void {
  if (!buffer || buffer.byteLength < 4) throw new Error('模型数据无效');
  const view = new DataView(buffer);
  let jsonBytes: Uint8Array;
  if (view.getUint32(0, true) === 0x46546c67) {
    if (buffer.byteLength < 20 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) {
      throw new Error('GLB 头部无效');
    }
    let offset = 12;
    let foundJson = false;
    let firstChunk = true;
    let json: Uint8Array | undefined;
    while (offset < buffer.byteLength) {
      if (offset + 8 > buffer.byteLength) throw new Error('GLB chunk 头部不完整');
      const length = view.getUint32(offset, true);
      const type = view.getUint32(offset + 4, true);
      offset += 8;
      if (length % 4 !== 0 || offset + length > buffer.byteLength) throw new Error('GLB chunk 长度无效');
      if (firstChunk && type !== 0x4e4f534a) throw new Error('GLB 首 chunk 必须为 JSON');
      if (type === 0x4e4f534a) {
        if (foundJson) throw new Error('GLB 包含多个 JSON chunk');
        foundJson = true;
        json = new Uint8Array(buffer, offset, length);
      }
      firstChunk = false;
      offset += length;
    }
    if (!json) throw new Error('GLB 缺少 JSON chunk');
    jsonBytes = json;
  } else {
    jsonBytes = new Uint8Array(buffer);
  }
  const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(jsonBytes));
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('模型 JSON 无效');
  checkGltfJsonSecurity(json);
}

export function checkGltfJsonSecurity(json: unknown): void {
  if (!json || typeof json !== 'object') return;
  const checkUri = (uri: unknown, fieldName: string) => {
    if (typeof uri === 'string') {
      const lower = uri.trim().toLowerCase();
      // 仅允许内嵌 data: URI，其余协议（包括预置 blob:、http:、https:、ftp:、file: 及相对路径）全部拒绝
      if (!lower.startsWith('data:')) {
        throw new Error(`检测到不受信任的模型资源引用 (${fieldName}): ${uri}`);
      }
    }
  };
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri') checkUri(child, key);
      else visit(child);
    }
  };
  visit(json);
}
