// js/utils/llm-adapter.js
export async function callLLM(modelConfig, prompt, signal) {
  const { type, endpoint, apiKey, modelName } = modelConfig;
  let finalEndpoint = endpoint;
  if (!finalEndpoint) {
    switch (type) {
      case 'deepseek': finalEndpoint = 'https://api.deepseek.com/v1'; break;
      case 'openai': finalEndpoint = 'https://api.openai.com/v1'; break;
      case 'qwen': finalEndpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'; break;
      default: finalEndpoint = '';
    }
  }
  switch (type) {
    case 'deepseek':
    case 'openai':
      return callOpenAICompatible(finalEndpoint, apiKey, modelName || (type === 'deepseek' ? 'deepseek-chat' : 'gpt-3.5-turbo'), prompt, signal);
    case 'qwen':
      return callQWen(finalEndpoint, apiKey, modelName || 'qwen-plus', prompt, signal);
    case 'ernie':
      return callErnie(apiKey, modelName || 'completions', prompt, signal);
    default:
      throw new Error('不支持的模型类型');
  }
}

export async function* callLLMStream(modelConfig, prompt, signal) {
  const { type, endpoint, apiKey, modelName } = modelConfig;
  let finalEndpoint = endpoint;
  if (!finalEndpoint) {
    switch (type) {
      case 'deepseek': finalEndpoint = 'https://api.deepseek.com/v1'; break;
      case 'openai': finalEndpoint = 'https://api.openai.com/v1'; break;
      case 'qwen': finalEndpoint = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'; break;
      default: finalEndpoint = '';
    }
  }
  switch (type) {
    case 'deepseek':
    case 'openai':
      yield* callOpenAICompatibleStream(finalEndpoint, apiKey, modelName || (type === 'deepseek' ? 'deepseek-chat' : 'gpt-3.5-turbo'), prompt, signal);
      break;
    case 'qwen':
      yield* callQWenStream(finalEndpoint, apiKey, modelName || 'qwen-plus', prompt, signal);
      break;
    case 'ernie':
      yield* callErnieStream(apiKey, modelName || 'completions', prompt, signal);
      break;
    default:
      throw new Error('不支持的模型类型');
  }
}

// ---------- 非流式实现 ----------
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
      const err = await response.text();
      throw new Error(`API 请求失败: ${response.status} ${err}`);
    }
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('请求已取消或超时');
    throw err;
  }
}

async function callQWen(endpoint, apiKey, model, prompt, signal) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        input: { messages: [{ role: 'user', content: prompt }] },
        parameters: { result_format: 'message' }
      }),
      signal: combinedSignal
    });
    clearTimeout(timeoutId);
    if (!response.ok) throw new Error(`通义千问错误: ${response.status}`);
    const data = await response.json();
    return data.output.choices[0].message.content;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') throw new Error('请求已取消或超时');
    throw err;
  }
}

async function callErnie(apiKey, model, prompt, signal) {
  const [clientId, clientSecret] = apiKey.split('|');
  if (!clientId || !clientSecret) throw new Error('文心一言 API Key 格式错误，请使用 client_id|client_secret');
  const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
  try {
    const tokenResp = await fetch(tokenUrl, { method: 'POST', signal: combinedSignal });
    clearTimeout(timeoutId);
    const tokenData = await tokenResp.json();
    const accessToken = tokenData.access_token;
    const apiUrl = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${accessToken}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
      signal: combinedSignal
    });
    if (!response.ok) throw new Error(`文心一言错误: ${response.status}`);
    const data = await response.json();
    return data.result;
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('请求已取消或超时');
    throw err;
  }
}

// ---------- 流式实现 ----------
async function* callOpenAICompatibleStream(baseURL, apiKey, model, prompt, signal) {
  const url = `${baseURL}/chat/completions`;
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
      max_tokens: 4096,
      stream: true
    }),
    signal
  });
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
}

async function* callQWenStream(endpoint, apiKey, model, prompt, signal) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      input: { messages: [{ role: 'user', content: prompt }] },
      parameters: { result_format: 'message', incremental_output: true }
    }),
    signal
  });
  if (!response.ok) throw new Error(`通义千问错误: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
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
}

async function* callErnieStream(apiKey, model, prompt, signal) {
  const [clientId, clientSecret] = apiKey.split('|');
  if (!clientId || !clientSecret) throw new Error('文心一言 API Key 格式错误');
  const tokenUrl = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;
  const tokenResp = await fetch(tokenUrl, { method: 'POST', signal });
  const tokenData = await tokenResp.json();
  const accessToken = tokenData.access_token;
  const apiUrl = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/${model}?access_token=${accessToken}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], stream: true }),
    signal
  });
  if (!response.ok) throw new Error(`文心一言错误: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split('\n');
    for (const line of lines) {
      if (line.startsWith('data:')) {
        try {
          const data = JSON.parse(line.slice(5));
          const content = data.result;
          if (content) yield content;
        } catch (e) {}
      }
    }
  }
}
