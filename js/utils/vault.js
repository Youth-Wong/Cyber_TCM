// js/utils/vault.js
import { encryptData, decryptData } from './crypto-helper.js';
import { getSettings, saveSettings } from './storage.js';
import { base64ToUtf8 } from './encoding.js';

const ENCRYPTED_KEYS_KEY = 'encrypted_api_keys';

let masterPassword = null;
let decryptedKeys = {};
let vaultUnlocked = false;

export function getEncryptedKeys() {
  try {
    return JSON.parse(localStorage.getItem(ENCRYPTED_KEYS_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function setEncryptedKeys(keys) {
  localStorage.setItem(ENCRYPTED_KEYS_KEY, JSON.stringify(keys));
}

export function hasVaultPassword() {
  return Object.keys(getEncryptedKeys()).length > 0;
}

export function isVaultUnlocked() {
  return vaultUnlocked;
}

export async function unlockVault(password) {
  const encrypted = getEncryptedKeys();
  if (Object.keys(encrypted).length === 0) {
    masterPassword = password;
    decryptedKeys = {};
    vaultUnlocked = true;
    return true;
  }
  try {
    let testCipher = encrypted['__vault_marker__'] || Object.values(encrypted)[0];
    await decryptData(testCipher, password);

    const decrypted = {};
    for (const [id, cipher] of Object.entries(encrypted)) {
      if (id === '__vault_marker__') continue;
      try {
        decrypted[id] = await decryptData(cipher, password);
      } catch (e) {
        console.warn(`密钥 ${id} 解密失败，已跳过`);
      }
    }
    masterPassword = password;
    decryptedKeys = decrypted;
    vaultUnlocked = true;
    return true;
  } catch (e) {
    console.warn('解锁失败（密码错误或数据损坏）', e);
    return false;
  }
}

export function lockVault() {
  masterPassword = null;
  decryptedKeys = {};
  vaultUnlocked = false;
}

export function getApiKeyForModel(modelId) {
  if (decryptedKeys[modelId]) return decryptedKeys[modelId];
  throw new Error('API Key 未解密，请先解锁密码保险箱');
}

export function getDecryptedKeyMap() {
  return { ...decryptedKeys };
}

function clearPlainKeysInSettings() {
  const settings = getSettings();
  if (settings?.models) {
    let needUpdate = false;
    for (const model of settings.models) {
      if (model.apiKey) {
        model.apiKey = '';
        needUpdate = true;
      }
    }
    if (needUpdate) saveSettings(settings);
  }
}

export async function saveEncryptedKeys(keyMap) {
  if (!vaultUnlocked) throw new Error('未解锁');
  const encrypted = {};
  for (const [id, plain] of Object.entries(keyMap)) {
    if (id === '__vault_marker__') continue;
    encrypted[id] = await encryptData(plain, masterPassword);
  }
  if (Object.keys(encrypted).length === 0) {
    encrypted['__vault_marker__'] = await encryptData('1', masterPassword);
  }
  setEncryptedKeys(encrypted);
  decryptedKeys = {};
  for (const [id, plain] of Object.entries(keyMap)) {
    if (id !== '__vault_marker__') decryptedKeys[id] = plain;
  }
  clearPlainKeysInSettings();
}

export async function setVaultPassword(newPassword, oldPassword) {
  const encrypted = getEncryptedKeys();
  let decryptedKeyMap = {};

  if (Object.keys(encrypted).length > 0) {
    if (!oldPassword) throw new Error('请提供旧密码');
    try {
      let testCipher = encrypted['__vault_marker__'] || Object.values(encrypted)[0];
      await decryptData(testCipher, oldPassword);
      for (const [id, cipher] of Object.entries(encrypted)) {
        if (id === '__vault_marker__') continue;
        decryptedKeyMap[id] = await decryptData(cipher, oldPassword);
      }
    } catch (e) {
      throw new Error('旧密码错误或数据损坏');
    }
  }

  const settings = getSettings();
  if (settings?.models) {
    for (const model of settings.models) {
      let raw = model.apiKey || '';
      if (raw.startsWith('b64:')) {
        try {
          raw = base64ToUtf8(raw.substring(4));
        } catch (e) {
          continue;
        }
      }
      if (raw && raw.length > 0 && !decryptedKeyMap[model.id]) {
        decryptedKeyMap[model.id] = raw;
      }
    }
  }

  const newEncrypted = {};
  for (const [id, plain] of Object.entries(decryptedKeyMap)) {
    if (id === '__vault_marker__') continue;
    newEncrypted[id] = await encryptData(plain, newPassword);
  }
  if (Object.keys(newEncrypted).length === 0) {
    newEncrypted['__vault_marker__'] = await encryptData('1', newPassword);
  }
  setEncryptedKeys(newEncrypted);

  masterPassword = newPassword;
  decryptedKeys = {};
  for (const [id, plain] of Object.entries(decryptedKeyMap)) {
    if (id !== '__vault_marker__') decryptedKeys[id] = plain;
  }
  vaultUnlocked = true;
  clearPlainKeysInSettings();
}

export async function resetVault() {
  localStorage.removeItem(ENCRYPTED_KEYS_KEY);
  masterPassword = null;
  decryptedKeys = {};
  vaultUnlocked = false;
}
