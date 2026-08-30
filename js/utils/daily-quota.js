const QUOTA_KEY = 'deepseek_default_daily_usage';

function getLocalDateKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function readUsage() {
  const today = getLocalDateKey();
  try {
    const stored = JSON.parse(localStorage.getItem(QUOTA_KEY) || '{}');
    if (stored.date === today && Number.isFinite(stored.count)) {
      return { date: today, count: Math.max(0, Math.floor(stored.count)) };
    }
  } catch (error) {
    console.warn('读取每日调用次数失败，将从 0 重新计数', error);
  }
  return { date: today, count: 0 };
}

export function getDailyQuotaStatus(limit = 100) {
  const safeLimit = Math.max(1, Math.floor(Number(limit) || 100));
  const usage = readUsage();
  return {
    date: usage.date,
    used: usage.count,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - usage.count)
  };
}

export function consumeDailyQuota(limit = 100) {
  const status = getDailyQuotaStatus(limit);
  if (status.remaining <= 0) {
    const error = new Error(`今日默认 DeepSeek API 调用次数已用完（${status.used}/${status.limit}），请明日再试或配置自己的 API Key。`);
    error.code = 'DAILY_QUOTA_EXCEEDED';
    throw error;
  }

  const next = { date: status.date, count: status.used + 1 };
  localStorage.setItem(QUOTA_KEY, JSON.stringify(next));
  return {
    date: next.date,
    used: next.count,
    limit: status.limit,
    remaining: status.limit - next.count
  };
}
