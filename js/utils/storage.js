// js/utils/storage.js

// ---------- 设置存储 (localStorage) ----------
const SETTINGS_KEY = 'prescription_settings';

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

// ---------- 历史记录 (IndexedDB) ----------
const DB_NAME = 'PrescriptionHistoryDB';
const STORE_NAME = 'history';
const DB_VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('timestamp', 'timestamp', { unique: false });
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

// FIX: 修改分页函数，使用 lastItem 对象（包含 timestamp 和 id）作为边界
export async function getHistoryPage(limit, lastItem = null) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    // 如果提供了 lastItem，则限定 timestamp <= lastItem.timestamp
    const range = lastItem ? IDBKeyRange.upperBound(lastItem.timestamp, true) : null;
    const request = index.openCursor(range, 'prev');
    const results = [];
    let count = 0;
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && count < limit) {
        const value = cursor.value;
        // 如果存在 lastItem，且时间戳相同，则只接受 id < lastItem.id 的记录（避免同毫秒数据遗漏）
        if (lastItem && value.timestamp === lastItem.timestamp && value.id >= lastItem.id) {
          cursor.continue();
          return;
        }
        results.push(value);
        count++;
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

export async function addHistoryItem(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const newItem = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 8),
      ...item,
      timestamp: Date.now()
    };
    const request = store.add(newItem);
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