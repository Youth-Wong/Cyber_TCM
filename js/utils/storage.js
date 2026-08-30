// js/utils/storage.js

// ==================== 设置存储 (localStorage) ====================
import {
  DEFAULT_DEEPSEEK_API_KEY_BASE64,
  DEFAULT_DEEPSEEK_DAILY_LIMIT
} from '../config.js';
import { utf8ToBase64 } from './encoding.js';

const SETTINGS_KEY = 'prescription_settings';
export const DEFAULT_DEEPSEEK_API_KEY = DEFAULT_DEEPSEEK_API_KEY_BASE64
  ? `b64:${DEFAULT_DEEPSEEK_API_KEY_BASE64}`
  : '';

const DEFAULT_ENDPOINTS = {
  deepseek: 'https://api.deepseek.com',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  kimi: 'https://api.moonshot.cn/v1',
  xiaomi: 'https://api.xiaomimimo.com/v1'
};

const DEFAULT_MODEL_NAMES = {
  deepseek: 'deepseek-v4-flash',
  qwen: 'qwen-plus',
  kimi: 'kimi-k2.6',
  xiaomi: 'mimo-v2.5-pro'
};

export const DEFAULT_MODELS = [
  {
    id: 'deepseek',
    name: 'DeepSeek-V4',
    type: 'deepseek',
    endpoint: 'https://api.deepseek.com',
    apiKey: DEFAULT_DEEPSEEK_API_KEY,
    modelName: 'deepseek-v4-flash',
    useDailyLimit: Boolean(DEFAULT_DEEPSEEK_API_KEY),
    dailyLimit: DEFAULT_DEEPSEEK_DAILY_LIMIT,
    active: true
  },
  {
    id: 'qwen',
    name: '通义千问',
    type: 'qwen',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: '',
    modelName: 'qwen-plus',
    active: false
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    type: 'kimi',
    endpoint: 'https://api.moonshot.cn/v1',
    apiKey: '',
    modelName: 'kimi-k2.6',
    active: false
  },
  {
    id: 'xiaomi',
    name: '小米 (Xiaomi MiMo)',
    type: 'xiaomi',
    endpoint: 'https://api.xiaomimimo.com/v1',
    apiKey: '',
    modelName: 'mimo-v2.5-pro',
    active: false
  }
];

export const DEFAULT_FLOWS = [
  { id: 'jingfang', name: '经方派', prompt: '你是一位经方派中医专家，精通《伤寒杂病论》，请根据患者信息辨证论治，给出经方加减。' },
  { id: 'shifang', name: '时方派', prompt: '你是一位时方派中医专家，注重卫气营血和三焦辨证，请为患者开具时方。' },
  { id: 'comprehensive', name: '学院派', prompt: '你是一位学院派中西医结合专家，请综合脏腑、八纲、气血津液进行辨证，提供治疗方案。' }
];

const DEFAULT_SETTINGS = {
  prescriptionStyle: 'shifang',
  customFlows: DEFAULT_FLOWS,
  autoSaveHistory: false,
  maxInputLength: 8000,
  models: DEFAULT_MODELS,
  activeModelId: 'deepseek'
};

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// 旧版格式迁移：{ models, flows, defaultFlowId, autoSave }
function migrateLegacy(raw) {
  const settings = deepCopy(DEFAULT_SETTINGS);
  if (Array.isArray(raw.flows) && raw.flows.length > 0) {
    settings.customFlows = raw.flows;
  }
  if (raw.defaultFlowId) settings.prescriptionStyle = raw.defaultFlowId;
  if (raw.autoSave !== undefined) settings.autoSaveHistory = !!raw.autoSave;
  if (Array.isArray(raw.models) && raw.models.length > 0) {
    settings.models = raw.models.map(m => ({
      id: m.id || 'model_' + Date.now(),
      name: m.name || '模型',
      type: m.type || 'deepseek',
      endpoint: m.endpoint || DEFAULT_ENDPOINTS[m.type || 'deepseek'],
      apiKey: m.apiKey || '',
      modelName: m.modelName || DEFAULT_MODEL_NAMES[m.type || 'deepseek'],
      useDailyLimit: !!m.useDailyLimit,
      dailyLimit: Number(m.dailyLimit) || DEFAULT_DEEPSEEK_DAILY_LIMIT,
      active: !!m.active
    }));
    const active = settings.models.find(m => m.active);
    settings.activeModelId = active ? active.id : settings.models[0].id;
  }
  return settings;
}

// 新格式合并默认值（保留用户已保存的字段）
function mergeDefaults(defaults, raw) {
  const merged = deepCopy(defaults);
  for (const key of Object.keys(raw)) {
    merged[key] = raw[key];
  }
  return merged;
}

export function getSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSettings() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(SETTINGS_KEY));
  } catch (e) {
    raw = null;
  }

  let settings;
  if (raw && Array.isArray(raw.customFlows)) {
    settings = mergeDefaults(DEFAULT_SETTINGS, raw);
  } else if (raw) {
    settings = migrateLegacy(raw);
  } else {
    settings = deepCopy(DEFAULT_SETTINGS);
  }

  if (!Array.isArray(settings.customFlows) || settings.customFlows.length === 0) {
    settings.customFlows = deepCopy(DEFAULT_FLOWS);
  }
  if (!settings.prescriptionStyle && settings.customFlows.length > 0) {
    settings.prescriptionStyle = settings.customFlows[0].id;
  }
  if (!Array.isArray(settings.models) || settings.models.length === 0) {
    settings.models = deepCopy(DEFAULT_MODELS);
  }
  if (!settings.activeModelId) {
    const active = settings.models.find(m => m.active);
    settings.activeModelId = active ? active.id : settings.models[0].id;
  }
  settings.models = settings.models.map(model => {
    const normalized = { ...model };
    if (normalized.id === 'deepseek' && DEFAULT_DEEPSEEK_API_KEY && (!normalized.apiKey || normalized.useDailyLimit === true)) {
      normalized.apiKey = DEFAULT_DEEPSEEK_API_KEY;
    }
    if (normalized.apiKey && !normalized.apiKey.startsWith('b64:')) {
      normalized.apiKey = `b64:${utf8ToBase64(normalized.apiKey)}`;
    }
    normalized.useDailyLimit = normalized.apiKey === DEFAULT_DEEPSEEK_API_KEY && Boolean(DEFAULT_DEEPSEEK_API_KEY);
    normalized.dailyLimit = normalized.useDailyLimit ? DEFAULT_DEEPSEEK_DAILY_LIMIT : undefined;
    return normalized;
  });
  settings.maxInputLength = Math.max(100, Number(settings.maxInputLength) || 8000);

  saveSettings(settings);
  return settings;
}

// ==================== 历史记录 (IndexedDB) ====================
const DB_NAME = 'PrescriptionHistoryDB';
const STORE_NAME = 'history';
const DB_VERSION = 2;

function genId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 8);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      const oldVersion = e.oldVersion;
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }
      }
      if (oldVersion < 2) {
        const store = e.target.transaction.objectStore(STORE_NAME);
        if (store && !store.indexNames.contains('name')) {
          store.createIndex('name', 'structured.name', { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getAllHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.openCursor(null, 'prev');
    const results = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        results.push(cursor.value);
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getHistoryPage(limit = 20, offset = 0) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const request = index.openCursor(IDBKeyRange.upperBound(Infinity), 'prev');
    const results = [];
    let skipped = 0;
    let fetched = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      if (skipped < offset) {
        skipped++;
        cursor.continue();
        return;
      }
      if (fetched < limit) {
        results.push(cursor.value);
        fetched++;
        cursor.continue();
        return;
      }
      resolve(results);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function getHistoryCount() {
  const db = await openDB();
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count();
    req.onsuccess = () => resolve(req.result);
  });
}

export async function getHistoryByTimeRange(startTime, endTime, limit = 1000) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.bound(startTime || 0, endTime || Date.now());
    const request = index.openCursor(range, 'prev');
    const results = [];
    let count = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || count >= limit) {
        resolve(results);
        return;
      }
      results.push(cursor.value);
      count++;
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function searchHistory({ name, keyword, startTime, endTime, limit = 20, offset = 0 }) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const range = IDBKeyRange.bound(startTime || 0, endTime || Date.now());
    const request = index.openCursor(range, 'prev');
    const results = [];
    let skipped = 0;
    let fetched = 0;
    const nameLower = name ? name.toLowerCase() : '';
    const keywordLower = keyword ? keyword.toLowerCase() : '';

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(results);
        return;
      }
      const item = cursor.value;
      let match = true;
      if (nameLower) {
        const itemName = (item.structured && item.structured.name) || '';
        if (!itemName.toLowerCase().includes(nameLower)) match = false;
      }
      if (keywordLower && match) {
        const patientInfo = (item.patientInfo || item.fullText || '').toLowerCase();
        const resultStr = JSON.stringify(item.result || '').toLowerCase();
        if (!patientInfo.includes(keywordLower) && !resultStr.includes(keywordLower)) {
          match = false;
        }
      }
      if (match) {
        if (skipped < offset) {
          skipped++;
          cursor.continue();
          return;
        }
        if (fetched < limit) {
          results.push(cursor.value);
          fetched++;
          cursor.continue();
          return;
        }
        resolve(results);
        return;
      }
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addHistoryItem(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const newItem = { id: genId(), ...item, timestamp: Date.now() };
    const request = store.put(newItem);
    request.onsuccess = () => resolve(newItem);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteHistoryItem(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearAllHistory() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
