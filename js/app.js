// js/app.js
import {
  saveSettings,
  loadSettings,
  DEFAULT_FLOWS,
  DEFAULT_DEEPSEEK_API_KEY,
  getAllHistory,
  getHistoryPage,
  getHistoryCount,
  getHistoryByTimeRange,
  searchHistory,
  addHistoryItem,
  deleteHistoryItem,
  clearAllHistory
} from './utils/storage.js';
import { callLLM, callLLMStream } from './utils/llm-adapter.js';
import { utf8ToBase64, base64ToUtf8 } from './utils/encoding.js';
import { getDailyQuotaStatus } from './utils/daily-quota.js';
import { DEFAULT_DEEPSEEK_DAILY_LIMIT } from './config.js';

// ===== DOM 引用 =====
let styleSelect, patientName, patientGender, patientAge, patientHistory;
let avoidContraCheck, premiumHerbsCheck, generateBtn, cancelBtn, retryBtn, clearInputBtn;
let resultContainer, resultActions, copyBtn, saveHistoryBtn;
let charCounter, charLimitInfo;
let historyList, clearHistoryBtn, exportStart, exportEnd, exportBtn;
let searchName, searchKeyword, searchStart, searchEnd, searchBtn, clearSearchBtn;
let modelsContainer, addModelBtn, flowsContainer, addFlowBtn;
let autoSaveCheck, saveSettingsBtn, saveStatus, themeSelect, maxInputLengthEl;
let themeToggle, toastEl, dailyQuotaInfo;

// ===== 状态 =====
let settings = null;
let currentResult = null;
let maxInputLength = 8000;
let autoSaveEnabled = false;
let currentAbort = null;
let isCancelled = false;
let currentTheme = 'system';

// 历史分页状态
let allHistory = [];
let totalHistoryCount = 0;
let currentDisplayCount = 0;
let isSearchMode = false;
const PAGE_SIZE = 20;

// ===== 常量 =====
const THEME_KEY = 'user_theme';

const defaultEndpoints = {
  deepseek: 'https://api.deepseek.com',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  kimi: 'https://api.moonshot.cn/v1',
  xiaomi: 'https://api.xiaomimimo.com/v1'
};

const defaultModelNames = {
  deepseek: 'deepseek-v4-flash',
  qwen: 'qwen-plus',
  kimi: 'kimi-k2.6',
  xiaomi: 'mimo-v2.5-pro'
};

const MODEL_OPTIONS_BY_TYPE = {
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  qwen: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long'],
  kimi: ['kimi-k2.6', 'kimi-k2.7-code', 'moonshot-v1-8k'],
  xiaomi: ['mimo-v2.5-pro', 'mimo-v2.5']
};

const PRESET_IDS = ['deepseek', 'qwen', 'kimi', 'xiaomi'];

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'model_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
}

// ===== Toast =====
let toastTimer = null;
function showToast(msg, duration = 2500) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

function escapeHtml(text) {
  if (!text) return '';
  return text.replace(/[&<>"]/g, function(m) {
    if (m === '&') return '&amp;';
    if (m === '<') return '&lt;';
    if (m === '>') return '&gt;';
    return '&quot;';
  });
}

// ===== 主题 =====
function getStoredTheme() {
  return localStorage.getItem(THEME_KEY) || 'system';
}
function setStoredTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
}
function applyTheme(theme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let isDark = false;
  if (theme === 'system') isDark = prefersDark;
  else if (theme === 'dark') isDark = true;
  document.body.classList.toggle('dark', isDark);
}
function updateThemeIcon(theme) {
  if (!themeToggle) return;
  if (theme === 'dark') themeToggle.innerHTML = '☀️';
  else if (theme === 'light') themeToggle.innerHTML = '🌙';
  else themeToggle.innerHTML = '🌙☀️';
}

// ===== 视图切换 =====
function switchView(viewId) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById(`view-${viewId}`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });
  if (viewId === 'history') loadHistory(false);
  if (viewId === 'settings') renderSettings();
}

// ===== 生成处方 =====
function buildPatientInfoForModel() {
  const gender = patientGender.value;
  const age = patientAge.value.trim();
  const history = patientHistory.value.trim();
  let parts = [];
  if (gender) parts.push(`性别：${gender}`);
  if (age) parts.push(`年龄：${age}`);
  if (history) parts.push(`病史及四诊：\n${history}`);
  return parts.join('\n');
}

function getCurrentStructured() {
  return {
    name: patientName.value.trim(),
    gender: patientGender.value,
    age: patientAge.value.trim(),
    history: patientHistory.value.trim()
  };
}

function getPatientInfoLength() {
  const gender = patientGender.value;
  const age = patientAge.value.trim();
  const history = patientHistory.value.trim();
  let parts = [];
  if (gender) parts.push(`性别：${gender}`);
  if (age) parts.push(`年龄：${age}`);
  if (history) parts.push(`病史及四诊：\n${history}`);
  return parts.join('\n').length;
}

function updateCharCounter() {
  if (!charCounter) return;
  const len = getPatientInfoLength();
  charCounter.textContent = `${len} 字符`;
  charCounter.style.color = len > maxInputLength ? 'var(--accent-danger)' : 'var(--text-muted)';
}

function updateDailyQuotaUI() {
  if (!dailyQuotaInfo || !settings) return;
  if (!DEFAULT_DEEPSEEK_API_KEY) {
    dailyQuotaInfo.textContent = '默认 DeepSeek API Key 尚未配置；请在 js/config.js 中填入 Base64 Key。';
    return;
  }
  const activeModel = settings.models.find(model => model.id === settings.activeModelId);
  if (!activeModel?.useDailyLimit) {
    dailyQuotaInfo.textContent = '自定义 API Key 不受本地每日次数限制。';
    return;
  }
  const status = getDailyQuotaStatus(activeModel.dailyLimit);
  dailyQuotaInfo.textContent = `默认 DeepSeek API：今日已用 ${status.used}/${status.limit} 次，剩余 ${status.remaining} 次。`;
}

// ===== 十八反十九畏检查（别名扩充） =====
function checkContraindications(composition) {
  if (!composition || !Array.isArray(composition)) return [];
  const herbNames = composition.map(item => item.herb.trim());
  const aliasMap = {
    '乌头': ['乌头', '川乌', '草乌', '附子', '制附子', '白附片', '黑顺片'],
    '半夏': ['半夏', '法半夏', '姜半夏', '清半夏', '生半夏'],
    '贝母': ['贝母', '川贝母', '浙贝母', '平贝母'],
    '瓜蒌': ['瓜蒌', '全瓜蒌', '天花粉', '瓜蒌皮', '瓜蒌仁'],
    '白及': ['白及', '白芨'],
    '白蔹': ['白蔹'],
    '海藻': ['海藻'],
    '大戟': ['大戟', '红大戟', '京大戟'],
    '甘遂': ['甘遂'],
    '芫花': ['芫花'],
    '藜芦': ['藜芦'],
    '人参': ['人参', '红参', '西洋参', '生晒参'],
    '沙参': ['沙参', '南沙参', '北沙参'],
    '丹参': ['丹参'],
    '玄参': ['玄参', '元参'],
    '苦参': ['苦参'],
    '细辛': ['细辛', '辽细辛'],
    '白芍': ['白芍', '杭白芍', '生白芍', '炒白芍'],
    '硫黄': ['硫黄', '硫磺'],
    '朴硝': ['朴硝', '芒硝', '元明粉', '玄明粉'],
    '水银': ['水银'],
    '砒霜': ['砒霜', '信石'],
    '狼毒': ['狼毒'],
    '密陀僧': ['密陀僧'],
    '巴豆': ['巴豆', '巴豆霜'],
    '牵牛子': ['牵牛子', '牵牛', '黑丑', '白丑'],
    '丁香': ['丁香', '公丁香', '母丁香'],
    '郁金': ['郁金', '广郁金', '川郁金'],
    '牙硝': ['牙硝', '芒硝'],
    '京三棱': ['三棱', '京三棱'],
    '犀角': ['犀角', '水牛角', '水牛角丝'],
    '五灵脂': ['五灵脂'],
    '肉桂': ['肉桂', '桂皮'],
    '赤石脂': ['赤石脂'],
    '甘草': ['甘草', '炙甘草', '生甘草']
  };

  function normalize(herb) {
    for (let [standard, aliases] of Object.entries(aliasMap)) {
      if (aliases.includes(herb)) return standard;
    }
    return herb;
  }
  const normalized = herbNames.map(n => normalize(n));

  const contraindications = [];

  const eighteenOpposites = [
    { herbs: ['乌头'], oppose: '半夏', msg: '乌头反半夏' },
    { herbs: ['乌头'], oppose: '贝母', msg: '乌头反贝母' },
    { herbs: ['乌头'], oppose: '瓜蒌', msg: '乌头反瓜蒌' },
    { herbs: ['乌头'], oppose: '白及', msg: '乌头反白及' },
    { herbs: ['乌头'], oppose: '白蔹', msg: '乌头反白蔹' },
    { herbs: ['甘草'], oppose: '海藻', msg: '甘草反海藻' },
    { herbs: ['甘草'], oppose: '大戟', msg: '甘草反大戟' },
    { herbs: ['甘草'], oppose: '甘遂', msg: '甘草反甘遂' },
    { herbs: ['甘草'], oppose: '芫花', msg: '甘草反芫花' },
    { herbs: ['藜芦'], oppose: '人参', msg: '藜芦反人参' },
    { herbs: ['藜芦'], oppose: '沙参', msg: '藜芦反沙参' },
    { herbs: ['藜芦'], oppose: '丹参', msg: '藜芦反丹参' },
    { herbs: ['藜芦'], oppose: '玄参', msg: '藜芦反玄参' },
    { herbs: ['藜芦'], oppose: '苦参', msg: '藜芦反苦参' },
    { herbs: ['藜芦'], oppose: '细辛', msg: '藜芦反细辛' },
    { herbs: ['藜芦'], oppose: '白芍', msg: '藜芦反白芍' },
  ];

  const nineteenFears = [
    { herbs: ['硫黄'], fear: '朴硝', msg: '硫黄畏朴硝' },
    { herbs: ['水银'], fear: '砒霜', msg: '水银畏砒霜' },
    { herbs: ['狼毒'], fear: '密陀僧', msg: '狼毒畏密陀僧' },
    { herbs: ['巴豆'], fear: '牵牛子', msg: '巴豆畏牵牛子' },
    { herbs: ['丁香'], fear: '郁金', msg: '丁香畏郁金' },
    { herbs: ['牙硝'], fear: '京三棱', msg: '牙硝畏三棱' },
    { herbs: ['乌头'], fear: '犀角', msg: '川乌、草乌畏犀角' },
    { herbs: ['人参'], fear: '五灵脂', msg: '人参畏五灵脂' },
    { herbs: ['肉桂'], fear: '赤石脂', msg: '肉桂畏赤石脂' },
  ];

  for (const rule of eighteenOpposites) {
    const hasHerb = rule.herbs.some(h => normalized.includes(h));
    const hasOppose = normalized.includes(rule.oppose);
    if (hasHerb && hasOppose) contraindications.push(rule.msg);
  }
  for (const rule of nineteenFears) {
    const hasHerb = rule.herbs.some(h => normalized.includes(h));
    const hasFear = normalized.includes(rule.fear);
    if (hasHerb && hasFear) contraindications.push(rule.msg);
  }
  return contraindications;
}

function validatePrescriptionJSON(data) {
  if (data.rawText) return data;
  const errors = [];
  if (!data.syndrome_analysis && !data.prescription) {
    return data;
  }
  if (data.prescription) {
    if (typeof data.prescription !== 'object') {
      errors.push('prescription 字段不是有效对象');
    } else {
      if (data.prescription.composition && Array.isArray(data.prescription.composition)) {
        for (let i = 0; i < data.prescription.composition.length; i++) {
          const item = data.prescription.composition[i];
          if (!item.herb || typeof item.herb !== 'string') {
            errors.push(`composition[${i}] 缺少 herb 字段`);
          }
          if (!item.dosage || typeof item.dosage !== 'string') {
            errors.push(`composition[${i}] 缺少 dosage 字段`);
          }
        }
      }
    }
  }
  if (errors.length > 0) {
    data._validationWarnings = errors;
  }
  return data;
}

function extractAndParseJSON(text) {
  try {
    return JSON.parse(text);
  } catch (e) {}
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch (e) {}
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0]);
    } catch (e) {}
  }
  return null;
}

async function generatePrescription() {
  const structured = getCurrentStructured();
  const patientInfo = buildPatientInfoForModel();

  if (structured.name.length > 16) {
    showToast('姓名不能超过16个字符', 3000);
    return;
  }

  const ageStr = structured.age;
  if (ageStr) {
    const ageNum = Number(ageStr);
    if (!Number.isInteger(ageNum) || ageNum < 0 || ageNum > 200) {
      showToast('年龄必须是0-200之间的整数', 3000);
      return;
    }
  }

  const illegalChars = structured.history.match(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g);
  if (illegalChars) {
    showToast(`病史中包含非法控制字符：${illegalChars.join(' ')}`, 4000);
    return;
  }

  if (patientInfo.length > maxInputLength) {
    showToast(`输入内容过长（${patientInfo.length} 字符），请精简至 ${maxInputLength} 字符以内。`, 4000);
    return;
  }

  if (!structured.history && !structured.gender && !structured.age) {
    showToast('请至少填写性别、年龄或病史信息');
    return;
  }

  // 解析当前激活模型
  let activeModel = settings.models.find(m => m.id === settings.activeModelId);
  if (!activeModel) {
    if (settings.models.length > 0) {
      activeModel = settings.models[0];
      settings.activeModelId = activeModel.id;
      saveSettings(settings);
    } else {
      showToast('没有任何模型配置，请先在设置中添加模型');
      return;
    }
  }

  // API Key 仅以 Base64 形式保存在本地配置中，调用前还原。
  let apiKey = activeModel.apiKey || '';
  if (apiKey.startsWith('b64:')) {
    apiKey = base64ToUtf8(apiKey.substring(4));
  }
  if (!apiKey || apiKey.length < 10) {
    showToast('API Key 未配置或无效，请先在设置中填写。', 4000);
    return;
  }
  const modelConfig = { ...activeModel, apiKey, responseFormat: 'json_object' };

  // 构建 Prompt
  const avoid = avoidContraCheck.checked;
  const premium = premiumHerbsCheck.checked;
  const flows = settings.customFlows || DEFAULT_FLOWS;
  const currentFlowId = styleSelect.value || settings.prescriptionStyle || (flows[0]?.id || '');
  const flow = flows.find(f => f.id === currentFlowId) || flows[0];
  let stylePrompt = flow ? flow.prompt : (flows[0]?.prompt || '你是一位中医专家，请根据患者信息辨证论治，给出处方。');

  let fullPrompt = `${stylePrompt}

患者信息：${patientInfo}

请严格返回以下 JSON 格式，不要添加额外说明。
每个中药条目只包含 herb 和 dosage 两个字段，禁止添加括号注释。
{
  "syndrome_analysis": "综合辨证分析",
  "treatment_principle": "治法",
  "prescription": {
    "name": "方名",
    "composition": [
      {"herb": "黄芪", "dosage": "30g"},
      {"herb": "山药", "dosage": "30g"}
    ],
    "formula_explanation": "方解"
  },
  "medical_advice": "医嘱与调护"
}`;

  if (avoid) {
    fullPrompt += `\n\n特别提醒：请务必避免使用十八反、十九畏的配伍禁忌（如乌头反半夏、甘草反甘遂等）。`;
  }
  if (premium) {
    fullPrompt += `\n\n特别要求：所有药物剂量必须为5g的整数倍（如5g、10g、15g……），以适应精品中药包装规格。`;
  }

  resultContainer.innerHTML = '<div class="streaming-placeholder">⚙️ 正在生成处方，AI 思考中...</div>';
  resultContainer.classList.remove('hidden');
  resultActions.classList.add('hidden');
  generateBtn.disabled = true;
  cancelBtn.style.display = 'inline-block';
  retryBtn.style.display = 'none';

  if (currentAbort) currentAbort.abort();
  const abortController = new AbortController();
  currentAbort = abortController;
  isCancelled = false;
  let fullResponse = '';

  try {
    let streamPre = null;
    for await (const chunk of callLLMStream(modelConfig, fullPrompt, abortController.signal)) {
      if (isCancelled) break;
      fullResponse += chunk;
      if (!streamPre) {
        resultContainer.innerHTML = '';
        streamPre = document.createElement('pre');
        resultContainer.appendChild(streamPre);
      }
      streamPre.textContent = fullResponse;
      resultContainer.scrollTop = resultContainer.scrollHeight;
    }
    if (isCancelled) {
      resultContainer.innerHTML = '<p class="error">已取消生成</p>';
      showToast('已取消生成');
      retryBtn.style.display = 'inline-block';
      return;
    }
    if (!fullResponse.trim()) {
      throw new Error('模型未返回有效内容，请重试或检查模型配置。');
    }

    let parsed = extractAndParseJSON(fullResponse);
    if (!parsed) {
      parsed = { rawText: fullResponse };
    } else {
      parsed = validatePrescriptionJSON(parsed);
    }
    if (parsed.prescription && parsed.prescription.composition) {
      parsed.prescription.composition = parsed.prescription.composition.map(item => ({
        herb: item.herb,
        dosage: item.dosage
      }));
    }
    if (parsed.prescription && parsed.prescription.composition) {
      const violations = checkContraindications(parsed.prescription.composition);
      if (violations.length > 0) {
        parsed.contraindications = violations;
      }
    }

    currentResult = parsed;
    renderResult(parsed);
    resultActions.classList.remove('hidden');
    showToast('处方生成成功');

    if (autoSaveEnabled) {
      try {
        await addHistoryItem({
          structured: structured,
          patientInfo: patientInfo,
          result: parsed
        });
        showToast('已自动保存至历史', 1500);
      } catch (e) {
        console.warn('自动保存失败:', e);
      }
    }
  } catch (err) {
    let errorMsg = err.message || '未知错误';
    resultContainer.innerHTML = `<p class="error">错误：${escapeHtml(errorMsg)}</p>`;
    showToast(`生成失败：${errorMsg}`, 4000);
    retryBtn.style.display = 'inline-block';
  } finally {
    currentAbort = null;
    generateBtn.disabled = false;
    cancelBtn.style.display = 'none';
    updateDailyQuotaUI();
  }
}

// ===== 渲染结果 =====
function formatCompositionHtml(composition) {
  if (!composition || composition.length === 0) return '';
  const items = composition.map(c => `${c.herb} ${c.dosage}`.trim());
  let html = '<div class="herb-grid">';
  items.forEach(item => {
    html += `<span class="herb-tag">${escapeHtml(item)}</span>`;
  });
  html += '</div>';
  return html;
}

function formatCompositionText(composition) {
  if (!composition || composition.length === 0) return '';
  const items = composition.map(c => `${c.herb} ${c.dosage}`.trim());
  return items.join('、');
}

function renderResult(data) {
  let html = '';
  if (data._validationWarnings && data._validationWarnings.length > 0) {
    html += `<div class="contraindication-warning" style="border-left-color:var(--accent-danger);">
      <strong>⚠️ 解析警告：</strong>
      ${data._validationWarnings.map(v => `• ${escapeHtml(v)}`).join('<br>')}
      <div style="font-size:13px; margin-top:6px;">请检查处方字段完整性。</div>
    </div>`;
  }
  if (data.contraindications && data.contraindications.length > 0) {
    html += `<div class="contraindication-warning">
      <strong>⚠️ 配伍禁忌警告：</strong>
      ${data.contraindications.map(v => `• ${escapeHtml(v)}`).join('<br>')}
      <div style="font-size:13px; margin-top:6px;">请谨慎审核处方，建议调整上述药材配伍。</div>
    </div>`;
  }
  if (data.rawText) {
    html += `<pre>${escapeHtml(data.rawText)}</pre>`;
  } else if (data.syndrome_analysis || data.prescription) {
    const compositionHtml = formatCompositionHtml(data.prescription?.composition);
    html += `
      <div class="section"><h4>辨证分析</h4><p>${escapeHtml(data.syndrome_analysis || '')}</p></div>
      <div class="section"><h4>治法</h4><p>${escapeHtml(data.treatment_principle || '')}</p></div>
      <div class="section"><h4>处方</h4><p><strong>${escapeHtml(data.prescription?.name || '')}</strong></p>${compositionHtml}</div>
      <div class="section"><h4>方解</h4><p>${escapeHtml(data.prescription?.formula_explanation || '')}</p></div>
      <div class="section"><h4>医嘱与调护</h4><p>${escapeHtml(data.medical_advice || '')}</p></div>
    `;
  } else {
    html = `<pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`;
  }
  resultContainer.innerHTML = html;
}

// ===== 复制 & 保存历史 =====
function copyToClipboard(str) {
  if (navigator.clipboard && window.isSecureContext !== false) {
    navigator.clipboard.writeText(str).then(() => showToast('已复制到剪贴板')).catch(() => fallbackCopy(str));
  } else {
    fallbackCopy(str);
  }
}

function fallbackCopy(str) {
  const textarea = document.createElement('textarea');
  textarea.value = str;
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  let success = false;
  try { success = document.execCommand('copy'); } catch (err) {}
  document.body.removeChild(textarea);
  showToast(success ? '已复制' : '复制失败，请手动复制');
}

// ===== 历史记录（分页 + 搜索） =====
function showSkeleton(count) {
  historyList.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const div = document.createElement('div');
    div.className = 'skeleton-item';
    historyList.appendChild(div);
  }
}

async function loadHistory(append = false) {
  if (isSearchMode) return;
  if (!append) showSkeleton(5);
  const offset = append ? currentDisplayCount : 0;
  const limit = PAGE_SIZE;
  try {
    const [items, total] = await Promise.all([getHistoryPage(limit, offset), getHistoryCount()]);
    if (!append) {
      allHistory = items;
      totalHistoryCount = total;
      currentDisplayCount = items.length;
    } else {
      allHistory = allHistory.concat(items);
      currentDisplayCount += items.length;
    }
    renderHistoryPage(append);
  } catch (e) {
    showToast('加载历史失败：' + e.message);
  }
}

async function searchHistoryHandler() {
  const name = searchName.value.trim();
  const keyword = searchKeyword.value.trim();
  let startTime = 0, endTime = Date.now();
  if (searchStart.value) {
    const d = new Date(searchStart.value);
    d.setHours(0, 0, 0, 0);
    startTime = d.getTime();
  }
  if (searchEnd.value) {
    const d = new Date(searchEnd.value);
    d.setHours(23, 59, 59, 999);
    endTime = d.getTime();
  }
  const limit = 200;
  try {
    const items = await searchHistory({ name, keyword, startTime, endTime, limit, offset: 0 });
    isSearchMode = true;
    allHistory = items;
    totalHistoryCount = items.length;
    currentDisplayCount = items.length;
    renderHistoryPage(false);
    clearSearchBtn.style.display = 'inline-flex';
  } catch (e) {
    showToast('搜索失败：' + e.message);
  }
}

function clearSearch() {
  searchName.value = '';
  searchKeyword.value = '';
  searchStart.value = '';
  searchEnd.value = '';
  clearSearchBtn.style.display = 'none';
  isSearchMode = false;
  loadHistory(false);
}

function renderHistoryPage(append = false) {
  if (allHistory.length === 0 && totalHistoryCount === 0) {
    historyList.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">暂无历史记录</p>';
    return;
  }

  let html = `<div class="history-stats">共 ${totalHistoryCount} 条记录，已显示 ${allHistory.length} 条</div>`;

  const itemsHtml = allHistory.map(h => {
    let preview = '';
    if (h.structured) {
      const name = h.structured.name || '无姓名';
      const historyShort = (h.structured.history || '').substring(0, 20);
      preview = `${name} - ${historyShort}...`;
    } else if (h.patientInfo) {
      preview = h.patientInfo.substring(0, 30) + '...';
    } else if (h.fullText) {
      preview = h.fullText.substring(0, 30) + '...';
    } else {
      preview = '旧记录';
    }
    return `
      <div class="history-item" data-id="${h.id}">
        <div class="info">
          <span class="time">${new Date(h.timestamp).toLocaleString()}</span>
          <span class="preview">${escapeHtml(preview)}</span>
        </div>
        <div class="actions">
          <button class="view-history" data-id="${h.id}" title="查看">📄</button>
          <button class="delete-history" data-id="${h.id}" title="删除">🗑️</button>
        </div>
      </div>
    `;
  }).join('');
  html += itemsHtml;

  if (!isSearchMode && allHistory.length < totalHistoryCount) {
    html += `<div class="load-more-container"><button id="load-more-history" class="load-more-btn btn-secondary">加载更多</button></div>`;
  }

  historyList.innerHTML = html;

  historyList.querySelectorAll('.view-history').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const item = allHistory.find(h => h.id === id);
      if (!item) return;
      if (patientHistory.value.trim() && !confirm('当前未保存的处方将被覆盖，确定查看？')) return;
      currentResult = item.result;
      if (item.structured) {
        patientName.value = item.structured.name || '';
        patientGender.value = item.structured.gender || '';
        patientAge.value = item.structured.age || '';
        patientHistory.value = item.structured.history || '';
        updateCharCounter();
      } else if (item.patientInfo) {
        patientName.value = '';
        patientGender.value = '';
        patientAge.value = '';
        patientHistory.value = item.patientInfo;
        updateCharCounter();
      } else if (item.fullText) {
        patientName.value = '';
        patientGender.value = '';
        patientAge.value = '';
        patientHistory.value = item.fullText;
        updateCharCounter();
      }
      switchView('generate');
      renderResult(currentResult);
      resultContainer.classList.remove('hidden');
      resultActions.classList.remove('hidden');
      showToast('已加载历史处方');
    });
  });

  historyList.querySelectorAll('.delete-history').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (confirm('确定删除这条历史记录？')) {
        await deleteHistoryItem(id);
        if (isSearchMode) {
          searchHistoryHandler();
        } else {
          await loadHistory(false);
        }
        showToast('已删除');
      }
    });
  });

  const loadMoreBtn = historyList.querySelector('#load-more-history');
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener('click', () => loadHistory(true));
  }
}

// ===== 导出 CSV =====
async function exportHistoryToExcel() {
  let startVal = exportStart.value;
  let endVal = exportEnd.value;
  let startTime = 0;
  if (startVal) {
    const startDate = new Date(startVal);
    startDate.setHours(0, 0, 0, 0);
    startTime = startDate.getTime();
  }
  let endTime = Date.now();
  if (endVal) {
    const endDate = new Date(endVal);
    endDate.setHours(23, 59, 59, 999);
    endTime = endDate.getTime();
  }
  try {
    const history = await getHistoryByTimeRange(startTime, endTime, 2000);
    if (history.length === 0) {
      showToast('所选时间段内无历史记录', 2000);
      return;
    }
    const headers = ['时间', '姓名', '性别', '年龄', '病史/四诊', '辨证分析', '治法', '方名', '用药', '方解', '医嘱', '禁忌警告'];
    const rows = [headers];
    for (const item of history) {
      const time = new Date(item.timestamp).toLocaleString();
      let name = '', gender = '', age = '', historyText = '';
      if (item.structured) {
        name = item.structured.name || '';
        gender = item.structured.gender || '';
        age = item.structured.age || '';
        historyText = (item.structured.history || '').replace(/\n/g, ' ');
      } else if (item.patientInfo) {
        historyText = item.patientInfo.replace(/\n/g, ' ');
      } else if (item.fullText) {
        historyText = item.fullText.replace(/\n/g, ' ');
      }
      const result = item.result || {};
      const syndrome = (result.syndrome_analysis || '').replace(/\n/g, ' ');
      const principle = (result.treatment_principle || '').replace(/\n/g, ' ');
      const formulaName = result.prescription?.name || '';
      const composition = (result.prescription?.composition || []).map(c => `${c.herb} ${c.dosage}`).join('；');
      const explanation = (result.prescription?.formula_explanation || '').replace(/\n/g, ' ');
      const advice = (result.medical_advice || '').replace(/\n/g, ' ');
      const contraindications = (result.contraindications || []).join('；');
      rows.push([
        time, name, gender, age, historyText,
        syndrome, principle, formulaName, composition, explanation, advice,
        contraindications
      ]);
    }
    const csvContent = rows.map(row =>
      row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.setAttribute('download', `prescription_export_${Date.now()}.csv`);
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('导出成功');
  } catch (e) {
    showToast('导出失败：' + e.message);
  }
}

// ===== 渲染流派下拉 =====
function renderFlowsSelect() {
  if (!styleSelect) return;
  const flows = settings.customFlows || DEFAULT_FLOWS;
  styleSelect.innerHTML = '';
  flows.forEach(flow => {
    const opt = document.createElement('option');
    opt.value = flow.id;
    opt.textContent = flow.name;
    styleSelect.appendChild(opt);
  });
  const currentId = settings.prescriptionStyle;
  if (currentId && flows.some(f => f.id === currentId)) {
    styleSelect.value = currentId;
  } else if (flows.length > 0) {
    styleSelect.value = flows[0].id;
  }
}

// ===== 设置：渲染流派 =====
function renderFlows(flows, defaultFlowId) {
  if (!flows || flows.length === 0) {
    flows = DEFAULT_FLOWS;
    defaultFlowId = defaultFlowId || flows[0].id;
  }
  flowsContainer.innerHTML = flows.map(flow => {
    const isDefault = (flow.id === defaultFlowId);
    const isBuiltin = ['jingfang', 'shifang', 'comprehensive'].includes(flow.id);
    return `
      <div class="flow-item" data-id="${flow.id}">
        <label>显示名称：<input type="text" class="flow-name" value="${escapeHtml(flow.name)}" /></label>
        <label>Prompt：<textarea class="flow-prompt" rows="2">${escapeHtml(flow.prompt)}</textarea></label>
        <div class="default-checkbox">
          <input type="checkbox" class="flow-default" value="${flow.id}" ${isDefault ? 'checked' : ''}>
          <label>设为默认</label>
        </div>
        ${!isBuiltin ? `<button class="delete-flow btn-danger">删除</button>` : ''}
      </div>
    `;
  }).join('');

  flowsContainer.querySelectorAll('.flow-default').forEach(cb => {
    cb.addEventListener('change', function() {
      if (this.checked) {
        flowsContainer.querySelectorAll('.flow-default').forEach(other => {
          if (other !== this) other.checked = false;
        });
      }
    });
  });

  flowsContainer.querySelectorAll('.delete-flow').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const item = e.target.closest('.flow-item');
      if (item && confirm('确定删除此流派？')) {
        item.remove();
      }
    });
  });
}

// ===== 设置：渲染模型 =====
function renderModels(models) {
  if (models.length === 0) {
    models = [...DEFAULT_MODELS];
  }

  modelsContainer.innerHTML = models.map((m, idx) => {
    const hasKey = m.apiKey && m.apiKey.length > 0;
    const displayKey = hasKey ? '********' : '';
    const modelName = m.modelName || defaultModelNames[m.type] || '';
    const datalistId = `model-options-${m.id || idx}`;
    const modelOptions = MODEL_OPTIONS_BY_TYPE[m.type] || [];
    const placeholder = hasKey ? '********' : '请输入 API Key';
    const isPreset = PRESET_IDS.includes(m.id);
    return `
      <div class="model-item" data-id="${m.id}">
        <label>名称：<input type="text" class="model-name" value="${escapeHtml(m.name)}" /></label>
        <label>类型：
          <select class="model-type">
            <option value="deepseek" ${m.type === 'deepseek' ? 'selected' : ''}>DeepSeek</option>
            <option value="qwen" ${m.type === 'qwen' ? 'selected' : ''}>通义千问</option>
            <option value="kimi" ${m.type === 'kimi' ? 'selected' : ''}>Kimi (Moonshot)</option>
            <option value="xiaomi" ${m.type === 'xiaomi' ? 'selected' : ''}>小米 (Xiaomi MiMo)</option>
          </select>
        </label>
        <label>Endpoint：<input type="text" class="model-endpoint" placeholder="留空则使用默认" value="${escapeHtml(m.endpoint || '')}" /></label>
        <label>模型名：
          <input type="text" class="model-modelname" list="${datalistId}" placeholder="输入或选择模型" value="${escapeHtml(modelName)}" />
          <datalist id="${datalistId}">
            ${modelOptions.map(opt => `<option value="${opt}">`).join('')}
          </datalist>
        </label>
        <label>API Key：
          <input type="password" class="model-apikey" placeholder="${placeholder}" value="${displayKey}" data-original-key="${escapeHtml(m.apiKey || '')}" />
          ${hasKey ? '<button class="clear-key-btn">清除</button>' : ''}
          ${m.useDailyLimit ? `<span class="hint-text">默认 Key · 每日 ${m.dailyLimit || DEFAULT_DEEPSEEK_DAILY_LIMIT} 次</span>` : ''}
        </label>
        <div class="default-checkbox">
          <input type="checkbox" class="model-active" ${m.active ? 'checked' : ''}>
          <label>设为默认</label>
        </div>
        <button class="test-model btn-secondary">测试连接</button>
        <span class="test-result"></span>
        ${!isPreset ? '<button class="delete-model btn-danger">删除</button>' : ''}
      </div>
    `;
  }).join('');

  modelsContainer.querySelectorAll('.clear-key-btn').forEach(btn => {
    btn.addEventListener('click', function(e) {
      const item = e.target.closest('.model-item');
      const keyInput = item.querySelector('.model-apikey');
      keyInput.value = '';
      keyInput.removeAttribute('data-original-key');
      this.style.display = 'none';
    });
  });

  modelsContainer.querySelectorAll('.model-active').forEach(cb => {
    cb.addEventListener('change', function() {
      if (this.checked) {
        modelsContainer.querySelectorAll('.model-active').forEach(other => {
          if (other !== this) other.checked = false;
        });
      }
    });
  });

  modelsContainer.querySelectorAll('.delete-model').forEach(btn => {
    btn.addEventListener('click', (e) => e.target.closest('.model-item').remove());
  });

  modelsContainer.querySelectorAll('.test-model').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      await testModel(e.target.closest('.model-item'));
    });
  });

  modelsContainer.querySelectorAll('.model-type').forEach(typeSelect => {
    typeSelect.addEventListener('change', function() {
      const item = this.closest('.model-item');
      const datalist = item.querySelector('datalist');
      const type = this.value;
      const options = MODEL_OPTIONS_BY_TYPE[type] || [];
      datalist.innerHTML = options.map(opt => `<option value="${opt}">`).join('');
    });
  });
}

// ===== 设置：测试模型 =====
async function testModel(modelItem) {
  const typeSelect = modelItem.querySelector('.model-type');
  const endpointInput = modelItem.querySelector('.model-endpoint');
  const modelNameInput = modelItem.querySelector('.model-modelname');
  const keyInput = modelItem.querySelector('.model-apikey');
  const resultSpan = modelItem.querySelector('.test-result');
  const type = typeSelect.value;
  let endpoint = endpointInput.value;
  if (!endpoint && defaultEndpoints[type]) endpoint = defaultEndpoints[type];

  let apiKey = null;

  const val = keyInput.value;
  if (val && val !== '********') {
    apiKey = val;
  } else {
    const orig = keyInput.dataset.originalKey || '';
    if (orig) {
      apiKey = orig.startsWith('b64:') ? base64ToUtf8(orig.substring(4)) : orig;
    }
  }
  if (!apiKey) {
    resultSpan.textContent = '❌ 请填写 API Key';
    return;
  }

  const modelName = modelNameInput.value || defaultModelNames[type] || '';
  const originalKey = keyInput.dataset.originalKey || '';
  const config = {
    type,
    endpoint,
    apiKey,
    modelName,
    useDailyLimit: originalKey === DEFAULT_DEEPSEEK_API_KEY && Boolean(DEFAULT_DEEPSEEK_API_KEY),
    dailyLimit: DEFAULT_DEEPSEEK_DAILY_LIMIT
  };
  resultSpan.textContent = '⏳ 测试中...';
  const btn = modelItem.querySelector('.test-model');
  btn.disabled = true;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await callLLM(config, '请只回复"OK"', controller.signal);
    clearTimeout(timeoutId);
    if (response && response.includes('OK')) {
      resultSpan.textContent = '✅ 连接成功';
    } else {
      resultSpan.textContent = '⚠️ 响应异常，请检查配置';
    }
  } catch (err) {
    clearTimeout(timeoutId);
    resultSpan.textContent = `❌ 失败：${err.message}`;
  } finally {
    btn.disabled = false;
    updateDailyQuotaUI();
  }
}

// ===== 设置：渲染设置视图 =====
function renderSettings() {
  if (!modelsContainer || !flowsContainer) return;
  try {
    themeSelect.value = getStoredTheme();

    const models = settings.models.map(m => ({ ...m, apiKey: m.apiKey || '' }));
    renderModels(models);

    const flows = settings.customFlows || DEFAULT_FLOWS;
    const defaultFlowId = settings.prescriptionStyle || flows[0]?.id;
    renderFlows(flows, defaultFlowId);

    if (autoSaveCheck) autoSaveCheck.checked = settings.autoSaveHistory || false;
    if (maxInputLengthEl) maxInputLengthEl.value = settings.maxInputLength || 8000;

    updateDailyQuotaUI();
  } catch (err) {
    console.error('渲染设置失败:', err);
    showToast('设置页面加载失败，请刷新');
  }
}

// ===== 设置：保存 =====
async function saveSettingsHandler() {
  const modelItems = modelsContainer.querySelectorAll('.model-item');
  const models = [];

  for (const item of modelItems) {
    const id = item.dataset.id || genId();
    if (!item.dataset.id) item.dataset.id = id;

    const name = item.querySelector('.model-name').value;
    const type = item.querySelector('.model-type').value;
    let endpoint = item.querySelector('.model-endpoint').value;
    if (!endpoint && defaultEndpoints[type]) endpoint = defaultEndpoints[type];
    const modelName = item.querySelector('.model-modelname').value || defaultModelNames[type] || '';
    const active = item.querySelector('.model-active').checked;

    const keyInput = item.querySelector('.model-apikey');
    const rawKey = keyInput.value;
    let apiKey = '';
    if (rawKey && rawKey !== '********') {
      apiKey = 'b64:' + utf8ToBase64(rawKey);
    } else {
      apiKey = keyInput.dataset.originalKey || '';
    }

    const useDailyLimit = apiKey === DEFAULT_DEEPSEEK_API_KEY && Boolean(DEFAULT_DEEPSEEK_API_KEY);
    models.push({ id, name, type, endpoint, apiKey, modelName, active, useDailyLimit, dailyLimit: useDailyLimit ? DEFAULT_DEEPSEEK_DAILY_LIMIT : undefined });
  }

  const flowItems = flowsContainer.querySelectorAll('.flow-item');
  const customFlows = [];
  let defaultFlowId = null;
  for (const item of flowItems) {
    const id = item.dataset.id;
    const name = item.querySelector('.flow-name').value.trim();
    const prompt = item.querySelector('.flow-prompt').value;
    if (!name || !prompt) {
      showToast('每个流派必须填写名称和 Prompt');
      return;
    }
    const isDefault = item.querySelector('.flow-default').checked;
    customFlows.push({ id, name, prompt });
    if (isDefault) defaultFlowId = id;
  }
  if (customFlows.length === 0) {
    showToast('至少保留一个处方流派。');
    return;
  }
  if (!defaultFlowId && customFlows.length > 0) {
    defaultFlowId = customFlows[0].id;
  }

  const maxInputLengthVal = Math.max(100, parseInt(maxInputLengthEl.value, 10) || 8000);
  const activeModelCb = modelsContainer.querySelector('.model-active:checked');
  const activeModelId = activeModelCb ? activeModelCb.closest('.model-item').dataset.id : models[0].id;

  settings.models = models;
  settings.activeModelId = activeModelId;
  settings.customFlows = customFlows;
  settings.prescriptionStyle = defaultFlowId;
  settings.autoSaveHistory = autoSaveCheck.checked;
  settings.maxInputLength = maxInputLengthVal;

  saveSettings(settings);

  const theme = themeSelect.value;
  setStoredTheme(theme);
  applyTheme(theme);
  updateThemeIcon(theme);

  maxInputLength = settings.maxInputLength;
  charLimitInfo.textContent = `限制 ${maxInputLength} 字符`;
  updateCharCounter();
  renderFlowsSelect();
  renderSettings();

  saveStatus.textContent = '✅ 已保存';
  setTimeout(() => saveStatus.textContent = '', 2000);
  showToast('设置已保存');
}

// ===== 设置：添加模型 =====
function addModel() {
  const item = document.createElement('div');
  item.className = 'model-item';
  const id = genId();
  const datalistId = `model-options-${id}`;
  const placeholder = '请输入 API Key';
  const defaultOptions = MODEL_OPTIONS_BY_TYPE.deepseek || [];

  item.innerHTML = `
    <label>名称：<input type="text" class="model-name" value="新模型" /></label>
    <label>类型：<select class="model-type">
      <option value="deepseek">DeepSeek</option>
      <option value="qwen">通义千问</option>
      <option value="kimi">Kimi (Moonshot)</option>
      <option value="xiaomi">小米 (Xiaomi MiMo)</option>
    </select></label>
    <label>Endpoint：<input type="text" class="model-endpoint" placeholder="留空则使用默认" /></label>
    <label>模型名：
      <input type="text" class="model-modelname" list="${datalistId}" placeholder="输入或选择模型" />
      <datalist id="${datalistId}">
        ${defaultOptions.map(opt => `<option value="${opt}">`).join('')}
      </datalist>
    </label>
    <label>API Key：<input type="password" class="model-apikey" placeholder="${placeholder}" data-original-key="" /></label>
    <div class="default-checkbox">
      <input type="checkbox" class="model-active">
      <label>设为默认</label>
    </div>
    <button class="test-model btn-secondary">测试连接</button>
    <span class="test-result"></span>
    <button class="delete-model btn-danger">删除</button>
  `;
  modelsContainer.appendChild(item);
  item.dataset.id = id;

  item.querySelector('.model-type').addEventListener('change', function() {
    const options = MODEL_OPTIONS_BY_TYPE[this.value] || [];
    item.querySelector('datalist').innerHTML = options.map(opt => `<option value="${opt}">`).join('');
  });
  item.querySelector('.model-active').addEventListener('change', function() {
    if (this.checked) {
      modelsContainer.querySelectorAll('.model-active').forEach(other => {
        if (other !== this) other.checked = false;
      });
    }
  });
  item.querySelector('.delete-model').addEventListener('click', () => item.remove());
  item.querySelector('.test-model').addEventListener('click', async () => {
    await testModel(item);
  });
}

// ===== 设置：添加流派 =====
function addFlow() {
  const id = 'custom_' + Date.now();
  const div = document.createElement('div');
  div.className = 'flow-item';
  div.dataset.id = id;
  div.innerHTML = `
    <label>显示名称：<input type="text" class="flow-name" value="新流派" /></label>
    <label>Prompt：<textarea class="flow-prompt" rows="2">请根据患者信息辨证论治，给出处方。</textarea></label>
    <div class="default-checkbox">
      <input type="checkbox" class="flow-default" value="${id}">
      <label>设为默认</label>
    </div>
    <button class="delete-flow btn-danger">删除</button>
  `;
  flowsContainer.appendChild(div);
  div.querySelector('.flow-default').addEventListener('change', function() {
    if (this.checked) {
      flowsContainer.querySelectorAll('.flow-default').forEach(other => {
        if (other !== this) other.checked = false;
      });
    }
  });
  div.querySelector('.delete-flow').addEventListener('click', () => {
    if (confirm('确定删除此流派？')) div.remove();
  });
}

// ===== 设置默认导出日期范围（近30天） =====
function setDefaultDateRange() {
  if (!exportStart || !exportEnd) return;
  const now = new Date();
  const start = new Date(now);
  start.setDate(start.getDate() - 30);

  const format = (d) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const mins = String(d.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${mins}`;
  };

  if (!exportStart.value) exportStart.value = format(start);
  if (!exportEnd.value) exportEnd.value = format(now);
}

// ===== 初始化 =====
function init() {
  console.log('应用初始化开始');
  try {
    // DOM 引用
    styleSelect = document.getElementById('prescription-style');
    patientName = document.getElementById('patient-name');
    patientGender = document.getElementById('patient-gender');
    patientAge = document.getElementById('patient-age');
    patientHistory = document.getElementById('patient-history');
    avoidContraCheck = document.getElementById('avoid-contraindications');
    premiumHerbsCheck = document.getElementById('premium-herbs');
    generateBtn = document.getElementById('generate-btn');
    cancelBtn = document.getElementById('cancel-btn');
    retryBtn = document.getElementById('retry-btn');
    clearInputBtn = document.getElementById('clear-input-btn');
    resultContainer = document.getElementById('result-container');
    resultActions = document.getElementById('result-actions');
    copyBtn = document.getElementById('copy-btn');
    saveHistoryBtn = document.getElementById('save-history-btn');
    charCounter = document.getElementById('char-counter');
    charLimitInfo = document.getElementById('char-limit-info');

    historyList = document.getElementById('history-list');
    clearHistoryBtn = document.getElementById('clear-history-btn');
    exportStart = document.getElementById('export-start');
    exportEnd = document.getElementById('export-end');
    exportBtn = document.getElementById('export-history-btn');
    searchName = document.getElementById('search-name');
    searchKeyword = document.getElementById('search-keyword');
    searchStart = document.getElementById('search-start');
    searchEnd = document.getElementById('search-end');
    searchBtn = document.getElementById('search-history-btn');
    clearSearchBtn = document.getElementById('clear-search-btn');

    modelsContainer = document.getElementById('models-container');
    addModelBtn = document.getElementById('add-model-btn');
    flowsContainer = document.getElementById('flows-container');
    addFlowBtn = document.getElementById('add-flow-btn');
    autoSaveCheck = document.getElementById('auto-save-history');
    saveSettingsBtn = document.getElementById('save-settings-btn');
    saveStatus = document.getElementById('save-status');
    themeSelect = document.getElementById('theme-select');
    maxInputLengthEl = document.getElementById('max-input-length');

    themeToggle = document.getElementById('theme-toggle');
    toastEl = document.getElementById('toast');
    dailyQuotaInfo = document.getElementById('daily-quota-info');

    // 加载设置
    settings = loadSettings();
    maxInputLength = settings.maxInputLength;
    autoSaveEnabled = settings.autoSaveHistory;
    renderFlowsSelect();

    charLimitInfo.textContent = `限制 ${maxInputLength} 字符`;
    updateCharCounter();

    // 主题
    currentTheme = getStoredTheme();
    applyTheme(currentTheme);
    updateThemeIcon(currentTheme);
    themeSelect.value = currentTheme;

    themeToggle.addEventListener('click', () => {
      const stored = getStoredTheme();
      let newTheme;
      if (stored === 'system' || stored === 'light') newTheme = 'dark';
      else if (stored === 'dark') newTheme = 'light';
      else newTheme = 'system';
      setStoredTheme(newTheme);
      applyTheme(newTheme);
      updateThemeIcon(newTheme);
      themeSelect.value = newTheme;
    });

    themeSelect.addEventListener('change', () => {
      const theme = themeSelect.value;
      setStoredTheme(theme);
      applyTheme(theme);
      updateThemeIcon(theme);
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getStoredTheme() === 'system') {
        applyTheme('system');
        updateThemeIcon('system');
      }
    });

    // 字符计数
    patientHistory.addEventListener('input', updateCharCounter);
    patientGender.addEventListener('change', updateCharCounter);
    patientAge.addEventListener('input', updateCharCounter);

    // 导航事件
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const view = this.dataset.view;
        if (view) switchView(view);
      });
    });

    // 生成事件
    generateBtn.addEventListener('click', generatePrescription);
    cancelBtn.addEventListener('click', () => {
      if (currentAbort) {
        isCancelled = true;
        currentAbort.abort();
        showToast('正在取消...');
      } else {
        showToast('没有正在进行的生成');
      }
    });
    retryBtn.addEventListener('click', generatePrescription);
    clearInputBtn.addEventListener('click', () => {
      if (currentAbort) {
        isCancelled = true;
        currentAbort.abort();
        currentAbort = null;
        generateBtn.disabled = false;
        cancelBtn.style.display = 'none';
      }
      patientName.value = '';
      patientGender.value = '';
      patientAge.value = '';
      patientHistory.value = '';
      updateCharCounter();
      resultContainer.innerHTML = '';
      resultContainer.classList.add('hidden');
      resultActions.classList.add('hidden');
      currentResult = null;
      retryBtn.style.display = 'none';
      showToast('已清空，可开始新处方');
    });

    copyBtn.addEventListener('click', () => {
      if (!currentResult) return;
      let text = '';
      if (currentResult.rawText) {
        text = currentResult.rawText;
      } else {
        const compositionText = formatCompositionText(currentResult.prescription?.composition);
        text = `【辨证分析】\n${currentResult.syndrome_analysis || ''}\n\n【治法】\n${currentResult.treatment_principle || ''}\n\n【处方】\n${currentResult.prescription?.name || ''}\n${compositionText}\n\n【方解】\n${currentResult.prescription?.formula_explanation || ''}\n\n【医嘱与调护】\n${currentResult.medical_advice || ''}`;
      }
      copyToClipboard(text);
    });

    saveHistoryBtn.addEventListener('click', async () => {
      if (!currentResult) return;
      const structured = getCurrentStructured();
      const patientInfo = buildPatientInfoForModel();
      try {
        await addHistoryItem({ structured, patientInfo, result: currentResult });
        showToast('已保存到历史');
      } catch (e) {
        showToast('保存失败：' + e.message, 3000);
      }
    });

    // 历史事件
    searchBtn.addEventListener('click', searchHistoryHandler);
    clearSearchBtn.addEventListener('click', clearSearch);
    searchName.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchHistoryHandler(); });
    searchKeyword.addEventListener('keydown', (e) => { if (e.key === 'Enter') searchHistoryHandler(); });

    clearHistoryBtn.addEventListener('click', async () => {
      if (confirm('确定清空所有历史记录？')) {
        await clearAllHistory();
        allHistory = [];
        totalHistoryCount = 0;
        currentDisplayCount = 0;
        isSearchMode = false;
        clearSearchBtn.style.display = 'none';
        historyList.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px;">暂无历史记录</p>';
        showToast('已清空历史');
      }
    });

    exportBtn.addEventListener('click', exportHistoryToExcel);

    // 设置事件
    addModelBtn.addEventListener('click', addModel);
    addFlowBtn.addEventListener('click', addFlow);
    saveSettingsBtn.addEventListener('click', saveSettingsHandler);

    // 默认视图
    switchView('generate');
    updateDailyQuotaUI();

    // Service Worker 注册与更新提示
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js')
        .then(reg => {
          console.log('Service Worker registered', reg);
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showToast('新版本已下载，请刷新页面以使用最新功能', 5000);
              }
            });
          });
        })
        .catch(err => console.error('Service Worker registration failed', err));
    }

    console.log('应用初始化完成');
  } catch (err) {
    console.error('初始化失败:', err);
    showToast('应用启动失败，请刷新页面');
  }
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);
