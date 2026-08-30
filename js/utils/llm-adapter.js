// js/utils/llm-adapter.js
import { consumeDailyQuota } from './daily-quota.js';

// ---------- 非流式调用 ----------
export async function callLLM(modelConfig, prompt, signal) {
  const { type, endpoint, apiKey, modelName, useDailyLimit, dailyLimit } = modelConfig;
  let finalEndpoint = endpoint;
  if (!finalEndpoint) {
    switch (type) {
      case 'deepseek': finalEndpoint = 'https://api.deepseek.com'; break;
      case 'qwen': finalEndpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1'; break;
      case 'kimi': finalEndpoint = 'https://api.moonshot.cn/v1'; break;
      case 'xiaomi': finalEndpoint = 'https://api.xiaomimimo.com/v1'; break;
      default: finalEndpoint = '';
    }
  }
  if (['deepseek', 'qwen', 'kimi', 'xiaomi'].includes(type)) {
    if (useDailyLimit) consumeDailyQuota(dailyLimit);
    return callOpenAICompatible(finalEndpoint, apiKey, modelName || getDefaultModel(type), prompt, signal);
  }
  throw new Error('不支持的模型类型');
}

// ---------- 流式调用 ----------
export async function* callLLMStream(modelConfig, prompt, signal) {
  const { type, endpoint, apiKey, modelName, useDailyLimit, dailyLimit } = modelConfig;
  let finalEndpoint = endpoint;
  if (!finalEndpoint) {
    switch (type) {
      case 'deepseek': finalEndpoint = 'https://api.deepseek.com'; break;
      case 'qwen': finalEndpoint = 'https://dashscope.aliyuncs.com/compatible-mode/v1'; break;
      case 'kimi': finalEndpoint = 'https://api.moonshot.cn/v1'; break;
      case 'xiaomi': finalEndpoint = 'https://api.xiaomimimo.com/v1'; break;
      default: finalEndpoint = '';
    }
  }
  if (['deepseek', 'qwen', 'kimi', 'xiaomi'].includes(type)) {
    if (useDailyLimit) consumeDailyQuota(dailyLimit);
    yield* callOpenAICompatibleStream(finalEndpoint, apiKey, modelName || getDefaultModel(type), prompt, signal);
  } else {
    throw new Error('不支持的模型类型');
  }
}

function getDefaultModel(type) {
  switch (type) {
    case 'deepseek': return 'deepseek-v4-flash';
    case 'qwen': return 'qwen-plus';
    case 'kimi': return 'kimi-k2.6';
    case 'xiaomi': return 'mimo-v2.5-pro';
    default: return '';
  }
}

// ---------- 非流式 OpenAI 兼容 ----------
async function callOpenAICompatible(baseURL, apiKey, model, prompt, signal) {
  const url = `${baseURL}/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096
      }),
      signal: combinedSignal
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const errText = await response.text();
      let errorMsg = `API 请求失败 (${response.status})`;
      if (response.status === 401) errorMsg += '：API Key 无效或已过期';
      else if (response.status === 429) errorMsg += '：请求频率过高，请稍后重试';
      else if (response.status >= 500) errorMsg += '：服务器内部错误';
      throw new Error(`${errorMsg}: ${errText}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('请求已取消或超时');
    throw err;
  }
}

// ---------- 流式 OpenAI 兼容 ----------
async function* callOpenAICompatibleStream(baseURL, apiKey, model, prompt, signal) {
  const url = `${baseURL}/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 4096,
        stream: true
      }),
      signal: combinedSignal
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    const errText = await response.text();
    let errorMsg = `API 请求失败 (${response.status})`;
    if (response.status === 401) errorMsg += '：API Key 无效或已过期';
    else if (response.status === 429) errorMsg += '：请求频率过高，请稍后重试';
    else if (response.status >= 500) errorMsg += '：服务器内部错误';
    throw new Error(`${errorMsg}: ${errText}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      if (buffer.trim()) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith('data: ') && trimmed !== 'data: [DONE]') {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const content = json.choices[0]?.delta?.content;
            if (content) yield content;
          } catch (e) {}
        }
      }
      break;
    }
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
}
