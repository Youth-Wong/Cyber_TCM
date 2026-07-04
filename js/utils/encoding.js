// js/utils/encoding.js
export function utf8ToBase64(str) {
  if (!str) return '';
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  let binary = '';
  for (let i = 0; i < data.length; i++) {
    binary += String.fromCharCode(data[i]);
  }
  return btoa(binary);
}

export function base64ToUtf8(base64) {
  if (!base64 || typeof base64 !== 'string') return '';
  const trimmed = base64.trim();
  if (!/^[A-Za-z0-9+/]*=*$/.test(trimmed)) {
    console.warn('输入不是有效的 Base64 字符串，作为明文返回');
    return trimmed;
  }
  try {
    const binary = atob(trimmed);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch (e) {
    console.warn('Base64 解码失败，作为明文处理', e);
    return trimmed;
  }
}
