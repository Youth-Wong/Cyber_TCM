// js/utils/llm-adapter.js

export async function callLLM(modelConfig, prompt, signal) {
  const { type, endpoint, apiKey, modelName } = modelConfig;
  if (type !== 'deepseek' && type !== 'qwen') {
    throw new Error('不支持的模型类型，仅支持 DeepSeek 和 通义千问 (Qwen)');
  }
  let finalEndpoint = endpoint;
  if (!finalEndpoint) {
    if (type === 'deepseek') finalEndpoint = 'https://api.deepseek.com/v1';
    else if (type === 'qwen') finalEndpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
  }
  // 当模型名为空时，使用当前最新默认模型
  const finalModel = modelName || (type === 'deepseek' ? 'deepseek-v4-flash' : 'qwen-plus');
  if (type === 'deepseek') {
    return callOpenAICompatible(finalEndpoint, apiKey, finalModel, prompt, signal);
  } else if (type === 'qwen') {
    return callQWen(finalEndpoint, apiKey, finalModel, prompt, signal);
  }
}

export async function* callLLMStream(modelConfig, prompt, signal) {
  const { type, endpoint, apiKey, modelName } = modelConfig;
  if (type !== 'deepseek' && type !== 'qwen') {
    throw new Error('不支持的模型类型，仅支持 DeepSeek 和 通义千问 (Qwen)');
  }
  let finalEndpoint = endpoint;
  if (!finalEndpoint) {
    if (type === 'deepseek') finalEndpoint = 'https://api.deepseek.com/v1';
    else if (type === 'qwen') finalEndpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation';
  }
  const finalModel = modelName || (type === 'deepseek' ? 'deepseek-v4-flash' : 'qwen-plus');
  if (type === 'deepseek') {
    yield* callOpenAICompatibleStream(finalEndpoint, apiKey, finalModel, prompt, signal);
  } else if (type === 'qwen') {
    yield* callQWenStream(finalEndpoint, apiKey, finalModel, prompt, signal);
  }
}

// ---------- 非流式实现 ----------
async function callOpenAICompatible(baseURL, apiKey, model, prompt, signal) {
  const url = `${baseURL}/chat/completions`;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000);
  const onAbort = () => abortController.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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

async function callQWen(endpoint, apiKey, model, prompt, signal) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000);
  const onAbort = () => abortController.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: 'user', content: prompt }] },
        parameters: { result_format: 'message' }
      }),
      signal: abortController.signal
    });
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (!response.ok) throw new Error(`通义千问错误: ${response.status}`);
    const data = await response.json();
    return data.output.choices[0].message.content;
  } catch (err) {
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (err.name === 'AbortError') throw new Error('请求已取消或超时');
    throw err;
  }
}

// ---------- 流式实现 ----------
async function* callOpenAICompatibleStream(baseURL, apiKey, model, prompt, signal) {
  const url = `${baseURL}/chat/completions`;
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000);
  const onAbort = () => abortController.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
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

async function* callQWenStream(endpoint, apiKey, model, prompt, signal) {
  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 60000);
  const onAbort = () => abortController.abort();
  if (signal) signal.addEventListener('abort', onAbort);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: { messages: [{ role: 'user', content: prompt }] },
        parameters: { result_format: 'message', incremental_output: true }
      }),
      signal: abortController.signal
    });
    clearTimeout(timeoutId);
    if (signal) signal.removeEventListener('abort', onAbort);
    if (!response.ok) throw new Error(`通义千问错误: ${response.status}`);
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
        if (line.startsWith('data:')) {
          try {
            const data = JSON.parse(line.slice(5));
            const content = data.output?.choices?.[0]?.message?.content;
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