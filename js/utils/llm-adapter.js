// js/utils/llm-adapter.js
import { consumeDailyQuota } from './daily-quota.js';

// ---------- 非流式调用 ----------
export async function callLLM(modelConfig, prompt, signal) {
  const { type, endpoint, apiKey, modelName, useDailyLimit, dailyLimit, responseFormat } = modelConfig;
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
    return callOpenAICompatible(finalEndpoint, apiKey, modelName || getDefaultModel(type), prompt, signal, type, responseFormat);
  }
  throw new Error('不支持的模型类型');
}

// ---------- 流式调用 ----------
export async function* callLLMStream(modelConfig, prompt, signal) {
  const { type, endpoint, apiKey, modelName, useDailyLimit, dailyLimit, responseFormat } = modelConfig;
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
    yield* callOpenAICompatibleStream(finalEndpoint, apiKey, modelName || getDefaultModel(type), prompt, signal, type, responseFormat);
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

function createRequestBody(type, model, prompt, stream, responseFormat) {
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 4096,
    stream
  };

  // 处方只需要最终 JSON；关闭 DeepSeek 思考模式，避免只收到 reasoning_content。
  if (type === 'deepseek') {
    body.thinking = { type: 'disabled' };
    if (responseFormat === 'json_object') {
      body.response_format = { type: 'json_object' };
    }
  }
  return body;
}

// ---------- 非流式 OpenAI 兼容 ----------
async function callOpenAICompatible(baseURL, apiKey, model, prompt, signal, type, responseFormat) {
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
      body: JSON.stringify(createRequestBody(type, model, prompt, false, responseFormat)),
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
    const choice = data.choices?.[0];
    if (choice?.finish_reason === 'length') {
      throw new Error('模型输出达到 token 上限，未能生成完整处方。');
    }
    const content = choice?.message?.content;
    if (!content || !content.trim()) {
      throw new Error('模型未返回最终答案，请重试或检查模型配置。');
    }
    return content;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('请求已取消或超时');
    throw err;
  }
}

function parseSseLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trimStart();
  if (payload === '[DONE]') return { done: true };
  try {
    const data = JSON.parse(payload);
    const choice = data.choices?.[0];
    return {
      content: choice?.delta?.content || '',
      reasoningContent: choice?.delta?.reasoning_content || '',
      finishReason: choice?.finish_reason || null
    };
  } catch (error) {
    return { parseError: error };
  }
}

// ---------- 流式 OpenAI 兼容 ----------
async function* callOpenAICompatibleStream(baseURL, apiKey, model, prompt, signal, type, responseFormat) {
  const url = `${baseURL}/chat/completions`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 120000);
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(createRequestBody(type, model, prompt, true, responseFormat)),
      signal: combinedSignal
    });
    if (!response.ok) {
      const errText = await response.text();
      let errorMsg = `API 请求失败 (${response.status})`;
      if (response.status === 401) errorMsg += '：API Key 无效或已过期';
      else if (response.status === 429) errorMsg += '：请求频率过高，请稍后重试';
      else if (response.status >= 500) errorMsg += '：服务器内部错误';
      throw new Error(`${errorMsg}: ${errText}`);
    }
    if (!response.body) {
      throw new Error('模型返回了空响应体。');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let hasContent = false;
    let hasReasoningContent = false;
    let finishReason = null;
    let parseErrorCount = 0;
    let streamFinished = false;

    while (!streamFinished) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = done ? '' : lines.pop();

      for (const line of lines) {
        const event = parseSseLine(line);
        if (!event) continue;
        if (event.done) {
          streamFinished = true;
          break;
        }
        if (event.parseError) {
          parseErrorCount++;
          continue;
        }
        if (event.finishReason) finishReason = event.finishReason;
        if (event.reasoningContent) hasReasoningContent = true;
        if (event.content) {
          if (event.content.trim()) hasContent = true;
          yield event.content;
        }
      }

      if (done) streamFinished = true;
    }

    if (finishReason === 'length') {
      throw new Error('模型输出达到 token 上限，未能生成完整处方。');
    }
    if (!hasContent && hasReasoningContent) {
      throw new Error('模型只返回了思考过程，没有返回最终答案。');
    }
    if (!hasContent && parseErrorCount > 0) {
      throw new Error('模型流式响应格式无法解析，请检查接口兼容性。');
    }
    if (!hasContent) {
      throw new Error('模型未返回最终答案，请重试或检查模型配置。');
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求已取消或超时');
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
