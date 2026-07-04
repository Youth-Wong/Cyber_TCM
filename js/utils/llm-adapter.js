// js/utils/llm-adapter.js

// DeepSeek 兼容 OpenAI Chat Completions API，直接使用标准格式
export async function callLLM(modelConfig, prompt, signal) {
  const { endpoint, apiKey, modelName } = modelConfig;
  const baseURL = endpoint || 'https://api.deepseek.com';
  const model = modelName || 'deepseek-v4-flash';

  const url = `${baseURL}/chat/completions`;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000);
  const onAbort = () => abortController.abort();
  if (signal) signal.addEventListener('abort', onAbort);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096
      }),
      signal: abortController.signal
    });
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API 请求失败: ${response.status} ${err}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (err) {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (err.name === 'AbortError') throw new Error('请求已取消或超时');
    throw err;
  }
}

export async function* callLLMStream(modelConfig, prompt, signal) {
  const { endpoint, apiKey, modelName } = modelConfig;
  const baseURL = endpoint || 'https://api.deepseek.com';
  const model = modelName || 'deepseek-v4-flash';

  const url = `${baseURL}/chat/completions`;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000);
  const onAbort = () => abortController.abort();
  if (signal) signal.addEventListener('abort', onAbort);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
        stream: true
      }),
      signal: abortController.signal
    });
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`API 请求失败: ${response.status} ${err}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const content = json.choices[0]?.delta?.content;
            if (content) yield content;
          } catch (e) {}
        }
      }
    }
  } finally {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}