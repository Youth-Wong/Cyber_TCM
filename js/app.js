// js/app.js
import { getSettings, saveSettings, getAllHistory, addHistoryItem, deleteHistoryItem, clearAllHistory, getHistoryPage } from './utils/storage.js';
import { callLLM, callLLMStream } from './utils/llm-adapter.js';
import { utf8ToBase64, base64ToUtf8 } from './utils/encoding.js';

// ===== DOM 引用（部分延迟获取） =====
let viewGenerate, viewHistory, viewSettings, navBtns;

// 生成相关
let styleSelect, patientName, patientGender, patientAge, patientHistory;
let avoidContra, premiumHerbs, generateBtn, cancelBtn, retryBtn;
let resultContainer, resultActions, copyBtn, saveHistoryBtn;

// 历史相关
let historyList, clearHistoryBtn, exportStart, exportEnd, exportBtn;

// 设置相关
let modelsContainer, addModelBtn, flowsContainer, addFlowBtn;
let autoSaveCheck, saveSettingsBtn, saveStatus;

// 主题 & Toast
let themeToggle, toastEl;

// ===== 状态 =====
let currentResult = null;
let isGenerating = false;
let abortController = null;
let settings = null;

// ---------- 分页状态 ----------
let historyItems = [];
let historyLastItem = null;
let hasMoreHistory = true;
let isLoadingHistory = false;
const PAGE_SIZE = 20;

// 默认设置（仅 DeepSeek 和 Qwen）
const DEFAULT_FLOWS = [
  { id: 'jingfang', name: '经方派', prompt: '你是一位经方派中医专家，精通《伤寒杂病论》，请根据患者信息辨证论治，给出经方加减。' },
  { id: 'shifang', name: '时方派', prompt: '你是一位时方派中医专家，注重卫气营血和三焦辨证，请为患者开具时方。' },
  { id: 'comprehensive', name: '学院派', prompt: '你是一位学院派中西医结合专家，请综合脏腑、八纲、气血津液进行辨证，提供治疗方案。' }
];

const DEFAULT_MODELS = [
  {
    id: 'deepseek',
    name: 'DeepSeek V4 Flash',
    type: 'deepseek',
    endpoint: 'https://api.deepseek.com/v1',
    apiKey: 'sk-please-replace-with-your-key',  // 占位，用户必须替换
    modelName: 'deepseek-v4-flash',  // 更新为最新模型名称
    active: true
  }
];

// ===== Toast =====
let toastTimer = null;
function showToast(msg, duration = 2500) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), duration);
}

// ===== 主题 =====
function getTheme() {
  return localStorage.getItem('user_theme') || 'system';
}
function setTheme(theme) {
  localStorage.setItem('user_theme', theme);
  applyTheme(theme);
}
function applyTheme(theme) {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let isDark = false;
  if (theme === 'system') isDark = prefersDark;
  else if (theme === 'dark') isDark = true;
  else isDark = false;
  document.body.classList.toggle('dark', isDark);
  if (themeToggle) themeToggle.textContent = isDark ? '☀️' : '🌙';
}

// ===== 加载设置 =====
function loadSettings() {
  let saved = getSettings();
  if (!saved) {
    saved = {
      models: DEFAULT_MODELS,
      flows: DEFAULT_FLOWS,
      defaultFlowId: 'shifang',
      autoSave: false
    };
    saveSettings(saved);
  }
  if (!saved.models) saved.models = DEFAULT_MODELS;
  if (!saved.flows) saved.flows = DEFAULT_FLOWS;
  if (!saved.defaultFlowId && saved.flows.length) saved.defaultFlowId = saved.flows[0].id;
  if (saved.autoSave === undefined) saved.autoSave = false;
  return saved;
}

// ===== 渲染流派下拉 =====
function renderFlowsSelect() {
  if (!styleSelect) return;
  const flows = settings.flows || DEFAULT_FLOWS;
  styleSelect.innerHTML = '';
  flows.forEach(flow => {
    const opt = document.createElement('option');
    opt.value = flow.id;
    opt.textContent = flow.name;
    styleSelect.appendChild(opt);
  });
  if (settings.defaultFlowId && flows.some(f => f.id === settings.defaultFlowId)) {
    styleSelect.value = settings.defaultFlowId;
  } else if (flows.length) {
    styleSelect.value = flows[0].id;
  }
}

// ===== 视图切换 =====
function switchView(viewId) {
  console.log(`切换到视图: ${viewId}`);
  try {
    const views = document.querySelectorAll('.view');
    views.forEach(v => v.classList.remove('active'));
    const target = document.getElementById(`view-${viewId}`);
    if (target) {
      target.classList.add('active');
    } else {
      console.error(`未找到视图: view-${viewId}`);
      return;
    }
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewId);
    });
    if (viewId === 'history') loadHistory();
    if (viewId === 'settings') renderSettings();
  } catch (err) {
    console.error('切换视图出错:', err);
    showToast('切换视图失败，请刷新页面');
  }
}

// ===== 生成处方相关 =====
function buildPatientInfo() {
  const name = patientName ? patientName.value.trim() : '';
  const gender = patientGender ? patientGender.value : '';
  const age = patientAge ? patientAge.value.trim() : '';
  const history = patientHistory ? patientHistory.value.trim() : '';
  let parts = [];
  if (name) parts.push(`姓名：${name}`);
  if (gender) parts.push(`性别：${gender}`);
  if (age) parts.push(`年龄：${age}`);
  if (history) parts.push(`病史及四诊：\n${history}`);
  return parts.join('\n');
}

function getCurrentStructured() {
  return {
    name: patientName ? patientName.value.trim() : '',
    gender: patientGender ? patientGender.value : '',
    age: patientAge ? patientAge.value.trim() : '',
    history: patientHistory ? patientHistory.value.trim() : ''
  };
}

// ===== 十八反十九畏检查 =====
function checkContraindications(composition) {
  const herbNames = composition.map(item => item.herb.trim());
  const aliasMap = {
    '乌头': ['乌头', '川乌', '草乌', '附子', '制附子', '白附片', '黑顺片'],
    '半夏': ['半夏', '法半夏', '姜半夏', '清半夏'],
    '贝母': ['贝母', '川贝母', '浙贝母'],
    '瓜蒌': ['瓜蒌', '全瓜蒌', '天花粉'],
    '白及': ['白及', '白芨'],
    '白蔹': ['白蔹'],
    '海藻': ['海藻'],
    '大戟': ['大戟', '红大戟', '京大戟'],
    '甘遂': ['甘遂'],
    '芫花': ['芫花'],
    '藜芦': ['藜芦'],
    '人参': ['人参', '红参', '西洋参'],
    '沙参': ['沙参', '南沙参', '北沙参'],
    '丹参': ['丹参'],
    '玄参': ['玄参', '元参'],
    '苦参': ['苦参'],
    '细辛': ['细辛'],
    '白芍': ['白芍', '赤芍'],
    '硫黄': ['硫黄', '硫磺'],
    '朴硝': ['朴硝', '芒硝', '元明粉'],
    '水银': ['水银'],
    '砒霜': ['砒霜', '信石'],
    '狼毒': ['狼毒'],
    '密陀僧': ['密陀僧'],
    '巴豆': ['巴豆', '巴豆霜'],
    '牵牛子': ['牵牛子', '牵牛'],
    '丁香': ['丁香', '公丁香', '母丁香'],
    '郁金': ['郁金', '广郁金'],
    '牙硝': ['牙硝', '芒硝'],
    '京三棱': ['三棱', '京三棱'],
    '犀角': ['犀角', '水牛角'],
    '五灵脂': ['五灵脂'],
    '肉桂': ['肉桂', '桂皮'],
    '赤石脂': ['赤石脂'],
    '甘草': ['甘草', '炙甘草']
  };

  function normalize(herb) {
    for (let [standard, aliases] of Object.entries(aliasMap)) {
      if (aliases.includes(herb) || aliases.some(a => herb.includes(a))) {
        return standard;
      }
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
    if (hasHerb && hasOppose) {
      contraindications.push(rule.msg);
    }
  }
  for (const rule of nineteenFears) {
    const hasHerb = rule.herbs.some(h => normalized.includes(h));
    const hasFear = normalized.includes(rule.fear);
    if (hasHerb && hasFear) {
      contraindications.push(rule.msg);
    }
  }
  return contraindications;
}

function extractAndParseJSON(text) {
  try { return JSON.parse(text); } catch(e) {}
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    try { return JSON.parse(codeBlockMatch[1]); } catch(e) {}
  }
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch(e) {}
  }
  return null;
}

async function generatePrescription() {
  if (!patientHistory) return;
  const structured = getCurrentStructured();
  if (!structured.history && !structured.name && !structured.age) {
    showToast('请至少填写病史或患者基本信息');
    return;
  }
  if (structured.history.length > 2000) {
    showToast('病史信息过长，请精简至2000字以内');
    return;
  }
  if (structured.age && (isNaN(structured.age) || structured.age < 0 || structured.age > 150)) {
    showToast('年龄请输入有效数字（0-150）');
    return;
  }

  const activeModel = settings.models.find(m => m.active);
  if (!activeModel) {
    showToast('请先在设置中添加并激活一个模型');
    return;
  }
  let apiKey = activeModel.apiKey;
  if (/^[A-Za-z0-9+/]*=*$/.test(apiKey)) {
    try {
      const decoded = base64ToUtf8(apiKey);
      if (decoded && decoded.length > 0) apiKey = decoded;
    } catch(e) {}
  }
  if (!apiKey || apiKey.length < 10) {
    showToast('API Key 无效，请检查设置');
    return;
  }
  const modelConfig = { ...activeModel, apiKey };

  const fullText = buildPatientInfo();
  const avoid = avoidContra ? avoidContra.checked : false;
  const premium = premiumHerbs ? premiumHerbs.checked : false;
  const flowId = styleSelect ? styleSelect.value : (settings.flows[0]?.id || '');
  const flow = settings.flows.find(f => f.id === flowId) || settings.flows[0];
  let stylePrompt = flow ? flow.prompt : '你是一位中医专家，请根据患者信息辨证论治，给出处方。';

  const wrappedInfo = `【患者信息】\n${fullText}\n【结束】`;
  let prompt = `${stylePrompt}

${wrappedInfo}

请严格基于上述【患者信息】部分的内容进行辨证论治，不要参考其他信息。请严格返回以下 JSON 格式，不要添加额外说明。
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
  if (avoid) prompt += `\n\n特别提醒：请务必避免使用十八反、十九畏的配伍禁忌。`;
  if (premium) prompt += `\n\n特别要求：所有药物剂量必须为5g的整数倍。`;

  if (resultContainer) {
    resultContainer.innerHTML = '<div class="streaming-placeholder">⚙️ 正在生成处方，AI 思考中...</div>';
    resultContainer.classList.remove('hidden');
  }
  if (resultActions) resultActions.classList.add('hidden');
  if (generateBtn) generateBtn.disabled = true;
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  if (retryBtn) retryBtn.style.display = 'none';

  abortController = new AbortController();
  isGenerating = true;
  let fullResponse = '';

  try {
    for await (const chunk of callLLMStream(modelConfig, prompt, abortController.signal)) {
      fullResponse += chunk;
      if (resultContainer) {
        resultContainer.innerHTML = `<div class="streaming-progress">⏳ 正在生成处方... 已接收 ${fullResponse.length} 字符</div>`;
      }
    }

    let parsed = extractAndParseJSON(fullResponse);
    if (!parsed) {
      const preview = fullResponse.substring(0, 200) + (fullResponse.length > 200 ? '...' : '');
      throw new Error(`模型返回格式异常，无法解析为处方。请检查 API 配置或尝试重新生成。\n返回内容预览：${preview}`);
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
    if (resultActions) resultActions.classList.remove('hidden');
    showToast('处方生成成功');

    if (settings.autoSave) {
      const lastPage = await getHistoryPage(1);
      if (lastPage.length > 0) {
        const last = lastPage[0];
        const currentStr = JSON.stringify(currentResult);
        const lastStr = JSON.stringify(last.result);
        if (currentStr === lastStr) {
          showToast('与最近历史相同，未重复保存', 1500);
          return;
        }
      }
      await addHistoryItem({
        structured: structured,
        fullText: fullText,
        result: parsed
      });
      showToast('已自动保存至历史', 1500);
    }

  } catch (err) {
    if (err.name === 'AbortError') {
      if (resultContainer) resultContainer.innerHTML = '<p class="error">已取消生成</p>';
      showToast('已取消');
    } else {
      if (resultContainer) resultContainer.innerHTML = `<p class="error">错误：${escapeHtml(err.message)}</p>`;
      showToast(`生成失败：${err.message}`, 4000);
      if (retryBtn) retryBtn.style.display = 'inline-block';
    }
  } finally {
    isGenerating = false;
    if (generateBtn) generateBtn.disabled = false;
    if (cancelBtn) cancelBtn.style.display = 'none';
    abortController = null;
  }
}

function renderResult(data) {
  if (!resultContainer) return;
  let html = '';
  if (data.contraindications && data.contraindications.length > 0) {
    html += `<div class="contraindication-warning">
      <strong>⚠️ 配伍禁忌警告：</strong>
      ${data.contraindications.map(v => `• ${escapeHtml(v)}`).join('<br>')}
      <div style="font-size:13px; margin-top:6px;">请谨慎审核处方，建议调整上述药材配伍。</div>
    </div>`;
  }
  const compositionHtml = data.prescription?.composition?.map(c => 
    `<span class="herb-tag">${escapeHtml(c.herb)} ${escapeHtml(c.dosage)}</span>`
  ).join('') || '';
  html += `
    <div class="section"><h4>辨证分析</h4><p>${escapeHtml(data.syndrome_analysis || '')}</p></div>
    <div class="section"><h4>治法</h4><p>${escapeHtml(data.treatment_principle || '')}</p></div>
    <div class="section"><h4>处方</h4><p><strong>${escapeHtml(data.prescription?.name || '')}</strong></p><div class="herb-grid">${compositionHtml}</div></div>
    <div class="section"><h4>方解</h4><p>${escapeHtml(data.prescription?.formula_explanation || '')}</p></div>
    <div class="section"><h4>医嘱与调护</h4><p>${escapeHtml(data.medical_advice || '')}</p></div>
  `;
  resultContainer.innerHTML = html;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== 复制 & 保存历史 =====
function copyToClipboard(str) {
  if (navigator.clipboard && window.isSecureContext !== false) {
    navigator.clipboard.writeText(str).then(() => showToast('已复制')).catch(() => fallbackCopy(str));
  } else {
    fallbackCopy(str);
  }
}
function fallbackCopy(str) {
  const ta = document.createElement('textarea');
  ta.value = str;
  ta.style.position = 'fixed';
  ta.style.top = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); showToast('已复制'); } catch(e) { showToast('复制失败，请手动复制'); }
  document.body.removeChild(ta);
}

// ===== 历史记录（分页加载 + 增量渲染） =====
async function loadHistory() {
  historyItems = [];
  historyLastItem = null;
  hasMoreHistory = true;
  isLoadingHistory = false;
  if (historyList) historyList.innerHTML = '';
  await loadMoreHistory();
}

async function loadMoreHistory() {
  if (isLoadingHistory || !hasMoreHistory) return;
  isLoadingHistory = true;
  try {
    const page = await getHistoryPage(PAGE_SIZE, historyLastItem);
    if (page.length < PAGE_SIZE) hasMoreHistory = false;
    if (page.length > 0) {
      historyItems = historyItems.concat(page);
      historyLastItem = page[page.length - 1];
      appendHistoryItems(page);
    } else {
      hasMoreHistory = false;
    }
  } catch (err) {
    showToast('加载历史失败：' + err.message);
  } finally {
    isLoadingHistory = false;
  }
}

function appendHistoryItems(items) {
  if (!historyList) return;
  const existingLoadMore = historyList.querySelector('#load-more-btn');
  if (existingLoadMore) existingLoadMore.remove();

  items.forEach(h => {
    const itemDiv = createHistoryItemElement(h);
    historyList.appendChild(itemDiv);
  });

  if (hasMoreHistory) {
    const loadMoreDiv = document.createElement('div');
    loadMoreDiv.className = 'load-more-container';
    const btn = document.createElement('button');
    btn.id = 'load-more-btn';
    btn.className = 'btn-secondary';
    btn.textContent = '加载更多';
    btn.addEventListener('click', loadMoreHistory);
    loadMoreDiv.appendChild(btn);
    historyList.appendChild(loadMoreDiv);
  }
}

function createHistoryItemElement(h) {
  let preview = '';
  if (h.structured) {
    const name = h.structured.name || '无姓名';
    const historyShort = (h.structured.history || '').substring(0, 20);
    preview = `${name} - ${historyShort}...`;
  } else if (h.fullText) {
    preview = h.fullText.substring(0, 30) + '...';
  } else {
    preview = '旧记录';
  }
  const div = document.createElement('div');
  div.className = 'history-item';
  div.dataset.id = h.id;
  div.innerHTML = `
    <div class="info">
      <span class="time">${new Date(h.timestamp).toLocaleString()}</span>
      <span class="preview">${escapeHtml(preview)}</span>
    </div>
    <div class="actions">
      <button class="view-history" data-id="${h.id}" title="查看">📄</button>
      <button class="delete-history" data-id="${h.id}" title="删除">🗑️</button>
    </div>
  `;
  div.querySelector('.view-history').addEventListener('click', () => viewHistoryItem(h.id));
  div.querySelector('.delete-history').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteHistoryItemHandler(h.id);
  });
  return div;
}

async function viewHistoryItem(id) {
  const item = historyItems.find(h => h.id === id);
  if (!item) return;
  const currentHistory = patientHistory ? patientHistory.value.trim() : '';
  if (currentHistory) {
    if (!confirm('当前输入框中有未保存的病史信息，加载历史将覆盖，是否继续？')) {
      return;
    }
  }
  currentResult = item.result;
  if (item.structured) {
    if (patientName) patientName.value = item.structured.name || '';
    if (patientGender) patientGender.value = item.structured.gender || '';
    if (patientAge) patientAge.value = item.structured.age || '';
    if (patientHistory) patientHistory.value = item.structured.history || '';
  } else if (item.fullText) {
    if (patientName) patientName.value = '';
    if (patientGender) patientGender.value = '';
    if (patientAge) patientAge.value = '';
    if (patientHistory) patientHistory.value = item.fullText;
  }
  switchView('generate');
  renderResult(currentResult);
  if (resultContainer) resultContainer.classList.remove('hidden');
  if (resultActions) resultActions.classList.remove('hidden');
  showToast('已加载历史处方');
}

async function deleteHistoryItemHandler(id) {
  if (confirm('确定删除这条历史记录？')) {
    await deleteHistoryItem(id);
    historyItems = historyItems.filter(h => h.id !== id);
    await loadHistory();
    showToast('已删除');
  }
}

function renderHistoryPage() {
  if (!historyList) return;
  historyList.innerHTML = '';
  if (historyItems.length === 0) {
    historyList.innerHTML = '<p style="text-align:center;color:var(--text-muted);">暂无历史记录</p>';
    return;
  }
  appendHistoryItems(historyItems);
}

// ===== 设置页面渲染 =====
function renderSettings() {
  if (!modelsContainer || !flowsContainer) return;
  try {
    modelsContainer.innerHTML = settings.models.map((m) => {
      const hasKey = m.apiKey && m.apiKey.length > 0;
      const placeholder = hasKey ? '已设置，留空不变' : '未设置，请输入';
      return `
        <div class="model-item" data-id="${m.id}">
          <label>名称：<input type="text" class="model-name" value="${escapeHtml(m.name)}" /></label>
          <label>类型：
            <select class="model-type">
              <option value="deepseek" ${m.type==='deepseek'?'selected':''}>DeepSeek</option>
              <option value="qwen" ${m.type==='qwen'?'selected':''}>通义千问 (Qwen)</option>
            </select>
          </label>
          <label>Endpoint：<input type="text" class="model-endpoint" value="${escapeHtml(m.endpoint||'')}" placeholder="留空则默认" /></label>
          <label>模型名：<input type="text" class="model-modelname" value="${escapeHtml(m.modelName||'')}" placeholder="可选" /></label>
          <label>API Key：<input type="password" class="model-apikey" placeholder="${placeholder}" data-original="${escapeHtml(m.apiKey||'')}" /></label>
          <div class="default-checkbox">
            <input type="checkbox" class="model-active" ${m.active ? 'checked' : ''}>
            <label>设为默认</label>
          </div>
          <button class="test-model btn-secondary">测试连接</button>
          <span class="test-result"></span>
          <button class="delete-model btn-danger">删除</button>
        </div>
      `;
    }).join('');

    modelsContainer.querySelectorAll('.delete-model').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const item = e.target.closest('.model-item');
        if (item && confirm('确定删除此模型？')) {
          const id = item.dataset.id;
          settings.models = settings.models.filter(m => m.id !== id);
          saveSettings(settings);
          renderSettings();
        }
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

    modelsContainer.querySelectorAll('.test-model').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const item = e.target.closest('.model-item');
        await testModel(item);
      });
    });

    flowsContainer.innerHTML = settings.flows.map((flow) => {
      const isDefault = (flow.id === settings.defaultFlowId);
      const isBuiltin = ['jingfang','shifang','comprehensive'].includes(flow.id);
      return `
        <div class="flow-item" data-id="${flow.id}">
          <label>名称：<input type="text" class="flow-name" value="${escapeHtml(flow.name)}" /></label>
          <label>Prompt：<textarea class="flow-prompt" rows="2">${escapeHtml(flow.prompt)}</textarea></label>
          <div class="default-checkbox">
            <input type="checkbox" class="flow-default" ${isDefault ? 'checked' : ''}>
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
          const id = item.dataset.id;
          settings.flows = settings.flows.filter(f => f.id !== id);
          if (settings.defaultFlowId === id) {
            settings.defaultFlowId = settings.flows[0]?.id || '';
          }
          saveSettings(settings);
          renderSettings();
          renderFlowsSelect();
        }
      });
    });

    if (autoSaveCheck) autoSaveCheck.checked = settings.autoSave || false;
  } catch (err) {
    console.error('渲染设置出错:', err);
    showToast('设置页面加载失败，请刷新');
  }
}

async function testModel(modelItem) {
  const nameInput = modelItem.querySelector('.model-name');
  const typeSelect = modelItem.querySelector('.model-type');
  const endpointInput = modelItem.querySelector('.model-endpoint');
  const modelNameInput = modelItem.querySelector('.model-modelname');
  const keyInput = modelItem.querySelector('.model-apikey');
  const resultSpan = modelItem.querySelector('.test-result');

  const type = typeSelect.value;
  let endpoint = endpointInput.value;
  const defaultEndpoints = {
    deepseek: 'https://api.deepseek.com/v1',
    qwen: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
  };
  if (!endpoint && defaultEndpoints[type]) endpoint = defaultEndpoints[type];
  let apiKey = keyInput.value;
  if (!apiKey) {
    const orig = keyInput.dataset.original || '';
    if (orig) {
      try { apiKey = base64ToUtf8(orig); } catch(e) { apiKey = orig; }
    } else {
      resultSpan.textContent = '❌ 请填写 API Key';
      return;
    }
  }
  const modelName = modelNameInput.value || '';
  const config = { type, endpoint, apiKey, modelName };

  resultSpan.textContent = '⏳ 测试中...';
  const btn = modelItem.querySelector('.test-model');
  btn.disabled = true;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await callLLM(config, '请只回复“OK”', controller.signal);
    clearTimeout(timeoutId);
    if (response && response.includes('OK')) {
      resultSpan.textContent = '✅ 连接成功';
    } else {
      resultSpan.textContent = '⚠️ 响应异常';
    }
  } catch (err) {
    clearTimeout(timeoutId);
    resultSpan.textContent = `❌ 失败：${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

// ===== 初始化 =====
function init() {
  console.log('应用初始化开始');
  try {
    // 获取 DOM 引用
    viewGenerate = document.getElementById('view-generate');
    viewHistory = document.getElementById('view-history');
    viewSettings = document.getElementById('view-settings');
    navBtns = document.querySelectorAll('.nav-btn');

    styleSelect = document.getElementById('prescription-style');
    patientName = document.getElementById('patient-name');
    patientGender = document.getElementById('patient-gender');
    patientAge = document.getElementById('patient-age');
    patientHistory = document.getElementById('patient-history');
    avoidContra = document.getElementById('avoid-contraindications');
    premiumHerbs = document.getElementById('premium-herbs');
    generateBtn = document.getElementById('generate-btn');
    cancelBtn = document.getElementById('cancel-btn');
    retryBtn = document.getElementById('retry-btn');
    resultContainer = document.getElementById('result-container');
    resultActions = document.getElementById('result-actions');
    copyBtn = document.getElementById('copy-btn');
    saveHistoryBtn = document.getElementById('save-history-btn');

    historyList = document.getElementById('history-list');
    clearHistoryBtn = document.getElementById('clear-history-btn');
    exportStart = document.getElementById('export-start');
    exportEnd = document.getElementById('export-end');
    exportBtn = document.getElementById('export-history-btn');

    modelsContainer = document.getElementById('models-container');
    addModelBtn = document.getElementById('add-model-btn');
    flowsContainer = document.getElementById('flows-container');
    addFlowBtn = document.getElementById('add-flow-btn');
    autoSaveCheck = document.getElementById('auto-save-history');
    saveSettingsBtn = document.getElementById('save-settings-btn');
    saveStatus = document.getElementById('save-status');

    themeToggle = document.getElementById('theme-toggle');
    toastEl = document.getElementById('toast');

    // 加载设置
    settings = loadSettings();
    console.log('设置加载完成:', settings);

    // 主题
    const savedTheme = getTheme();
    applyTheme(savedTheme);
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const current = getTheme();
        let next;
        if (current === 'system' || current === 'light') next = 'dark';
        else if (current === 'dark') next = 'light';
        else next = 'system';
        setTheme(next);
      });
    }
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (getTheme() === 'system') applyTheme('system');
    });

    // 渲染流派下拉
    renderFlowsSelect();

    // 设置默认时间
    setDefaultDateRange();

    // 导航事件
    navBtns.forEach(btn => {
      btn.addEventListener('click', function() {
        const view = this.dataset.view;
        if (view) switchView(view);
      });
    });

    // 生成事件
    if (generateBtn) generateBtn.addEventListener('click', generatePrescription);
    if (cancelBtn) cancelBtn.addEventListener('click', () => {
      if (abortController) {
        abortController.abort();
        showToast('正在取消...');
      }
    });
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        if (resultContainer) {
          resultContainer.innerHTML = '';
          resultContainer.classList.add('hidden');
        }
        if (resultActions) resultActions.classList.add('hidden');
        generatePrescription();
      });
    }
    if (copyBtn) copyBtn.addEventListener('click', () => {
      if (!currentResult) return;
      let text = '';
      if (currentResult.rawText) {
        text = currentResult.rawText;
      } else {
        const comp = currentResult.prescription?.composition?.map(c => `${c.herb} ${c.dosage}`).join('、') || '';
        text = `【辨证分析】\n${currentResult.syndrome_analysis || ''}\n\n【治法】\n${currentResult.treatment_principle || ''}\n\n【处方】\n${currentResult.prescription?.name || ''}\n${comp}\n\n【方解】\n${currentResult.prescription?.formula_explanation || ''}\n\n【医嘱与调护】\n${currentResult.medical_advice || ''}`;
      }
      copyToClipboard(text);
    });
    if (saveHistoryBtn) saveHistoryBtn.addEventListener('click', async () => {
      if (!currentResult) return;
      const structured = getCurrentStructured();
      const fullText = buildPatientInfo();
      await addHistoryItem({ structured, fullText, result: currentResult });
      showToast('已保存到历史');
    });

    // 历史事件
    if (clearHistoryBtn) {
      clearHistoryBtn.addEventListener('click', async () => {
        if (confirm('确定清空所有历史记录？')) {
          await clearAllHistory();
          historyItems = [];
          hasMoreHistory = false;
          if (historyList) historyList.innerHTML = '<p style="text-align:center;color:var(--text-muted);">暂无历史记录</p>';
          showToast('已清空历史');
        }
      });
    }
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        let startVal = exportStart ? exportStart.value : '';
        let endVal = exportEnd ? exportEnd.value : '';
        let startTime = 0;
        if (startVal) {
          const d = new Date(startVal);
          d.setHours(0,0,0,0);
          startTime = d.getTime();
        }
        let endTime = Infinity;
        if (endVal) {
          const d = new Date(endVal);
          d.setHours(23,59,59,999);
          endTime = d.getTime();
        }
        const all = await getAllHistory();
        const filtered = all.filter(h => h.timestamp >= startTime && h.timestamp <= endTime);
        if (filtered.length === 0) {
          showToast('所选时间段内无记录', 2000);
          return;
        }
        const headers = ['时间','姓名','性别','年龄','病史/四诊','辨证分析','治法','方名','用药','方解','医嘱'];
        const rows = [headers];
        for (const item of filtered) {
          const time = new Date(item.timestamp).toLocaleString();
          let name='', gender='', age='', historyText='';
          if (item.structured) {
            name = item.structured.name || '';
            gender = item.structured.gender || '';
            age = item.structured.age || '';
            historyText = (item.structured.history || '').replace(/\n/g, ' ');
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
          rows.push([time, name, gender, age, historyText, syndrome, principle, formulaName, composition, explanation, advice]);
        }
        const csvContent = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `处方历史_${Date.now()}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast('导出成功');
      });
    }

    // 设置页面事件
    if (addModelBtn) {
      addModelBtn.addEventListener('click', () => {
        const newModel = {
          id: 'model_' + Date.now(),
          name: '新模型',
          type: 'deepseek',
          endpoint: '',
          apiKey: '',
          modelName: '',
          active: false
        };
        settings.models.push(newModel);
        saveSettings(settings);
        renderSettings();
      });
    }
    if (addFlowBtn) {
      addFlowBtn.addEventListener('click', () => {
        const newFlow = {
          id: 'flow_' + Date.now(),
          name: '新流派',
          prompt: '请根据患者信息辨证论治，给出处方。'
        };
        settings.flows.push(newFlow);
        if (!settings.defaultFlowId) settings.defaultFlowId = newFlow.id;
        saveSettings(settings);
        renderSettings();
        renderFlowsSelect();
      });
    }
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => {
        // 收集模型
        const modelItems = modelsContainer.querySelectorAll('.model-item');
        const models = [];
        for (const item of modelItems) {
          const id = item.dataset.id;
          const name = item.querySelector('.model-name').value.trim();
          const type = item.querySelector('.model-type').value;
          let endpoint = item.querySelector('.model-endpoint').value;
          const defaultEndpoints = {
            deepseek: 'https://api.deepseek.com/v1',
            qwen: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/text-generation/generation'
          };
          if (!endpoint && defaultEndpoints[type]) endpoint = defaultEndpoints[type];
          const modelName = item.querySelector('.model-modelname').value;
          const keyInput = item.querySelector('.model-apikey');
          let apiKey = keyInput.value;
          if (apiKey === '') {
            apiKey = keyInput.dataset.original || '';
          } else {
            apiKey = utf8ToBase64(apiKey);
          }
          const active = item.querySelector('.model-active').checked;
          models.push({ id, name, type, endpoint, apiKey, modelName, active });
        }
        if (models.length === 0) {
          showToast('至少保留一个模型');
          return;
        }
        // 收集流派
        const flowItems = flowsContainer.querySelectorAll('.flow-item');
        const flows = [];
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
          flows.push({ id, name, prompt });
          if (isDefault) defaultFlowId = id;
        }
        if (!defaultFlowId && flows.length > 0) defaultFlowId = flows[0].id;

        settings.models = models;
        settings.flows = flows;
        settings.defaultFlowId = defaultFlowId;
        settings.autoSave = autoSaveCheck ? autoSaveCheck.checked : false;

        saveSettings(settings);
        renderFlowsSelect();
        if (saveStatus) {
          saveStatus.textContent = '✅ 已保存';
          setTimeout(() => saveStatus.textContent = '', 2000);
        }
        showToast('设置已保存');

        // 若使用 Qwen，提示跨域问题
        const hasQwen = models.some(m => m.type === 'qwen' && m.apiKey);
        if (hasQwen) {
          showToast('注意：通义千问 API 可能存在跨域限制，建议使用代理或自建后端转发', 4000);
        }
      });
    }

    // 默认视图
    switchView('generate');
    console.log('应用初始化完成');

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

    // 安装引导（Android + iOS）
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      showInstallBanner(true);
    });

    if (window.navigator.standalone === false) {
      showIosInstallGuide();
    }

    function showInstallBanner(show) {
      if (!show) {
        const banner = document.getElementById('install-banner');
        if (banner) banner.remove();
        return;
      }
      if (document.getElementById('install-banner')) return;
      const banner = document.createElement('div');
      banner.id = 'install-banner';
      banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:var(--bg-card);padding:12px 16px;box-shadow:0 -2px 10px rgba(0,0,0,0.2);display:flex;justify-content:space-between;align-items:center;z-index:10000;';
      banner.innerHTML = `
        <span>📲 安装应用以获得更好体验</span>
        <div>
          <button id="install-btn" class="btn-primary" style="margin-right:8px;">安装</button>
          <button id="close-install-banner" class="btn-secondary">关闭</button>
        </div>
      `;
      document.body.appendChild(banner);
      document.getElementById('install-btn').addEventListener('click', async () => {
        if (deferredPrompt) {
          deferredPrompt.prompt();
          const result = await deferredPrompt.userChoice;
          if (result.outcome === 'accepted') {
            showToast('应用已添加至主屏幕');
          }
          deferredPrompt = null;
          showInstallBanner(false);
        }
      });
      document.getElementById('close-install-banner').addEventListener('click', () => {
        showInstallBanner(false);
      });
    }

    function showIosInstallGuide() {
      if (localStorage.getItem('ios_install_guide_shown')) return;
      const guide = document.createElement('div');
      guide.id = 'ios-install-guide';
      guide.style.cssText = 'position:fixed;bottom:70px;left:20px;right:20px;background:var(--bg-card);padding:16px;border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);z-index:10000;border:1px solid var(--border-color);';
      guide.innerHTML = `
        <p style="margin:0 0 8px;">📱 添加到主屏幕：</p>
        <ol style="margin:0 0 12px 20px;font-size:14px;">
          <li>点击底部「分享」按钮</li>
          <li>选择「添加到主屏幕」</li>
        </ol>
        <button id="close-ios-guide" class="btn-secondary" style="float:right;">知道了</button>
      `;
      document.body.appendChild(guide);
      document.getElementById('close-ios-guide').addEventListener('click', () => {
        guide.remove();
        localStorage.setItem('ios_install_guide_shown', 'true');
      });
    }

  } catch (err) {
    console.error('初始化失败:', err);
    showToast('应用启动失败，请刷新页面');
  }
}

function setDefaultDateRange() {
  if (!exportStart || !exportEnd) return;
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth()+1).padStart(2,'0');
  const day = String(now.getDate()).padStart(2,'0');
  if (!exportStart.value) exportStart.value = `${year}-${month}-${day}T00:00`;
  if (!exportEnd.value) exportEnd.value = `${year}-${month}-${day}T23:59`;
}

// ===== 启动 =====
document.addEventListener('DOMContentLoaded', init);