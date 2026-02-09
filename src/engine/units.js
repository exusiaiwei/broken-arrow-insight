/**
 * 游戏单位名称缓存管理
 * 从 batrace API 加载单位列表，24 小时缓存
 */
import { CONFIG } from '../config.js';

const UNIT_CACHE_KEY = CONFIG.LS_UNIT_CACHE_KEY;
const UNIT_CACHE_TS_KEY = CONFIG.LS_UNIT_CACHE_TS;

/** @type {Record<string, string>} 单位 ID → 显示名称映射 */
let unitNameCache = {};
let isCacheLoaded = false;

/**
 * 处理单位列表数据
 * @param {Array} list
 */
function processUnitList(list) {
  if (Array.isArray(list)) {
    list.forEach((u) => {
      const id = u.Id || u.id;
      const name = u.Name || u.name;
      if (id && name) {
        unitNameCache[id] = name;
      }
    });
    isCacheLoaded = true;
  }
}

/**
 * 确保全局单位名称库已加载（24 小时缓存）
 */
export async function ensureGlobalUnitList() {
  if (isCacheLoaded) return;

  const now = Date.now();
  const cachedData = localStorage.getItem(UNIT_CACHE_KEY);
  const cachedTime = localStorage.getItem(UNIT_CACHE_TS_KEY);
  const oneDay = 24 * 60 * 60 * 1000;

  // 1. 尝试从缓存读取
  if (cachedData && cachedTime && now - parseInt(cachedTime) < oneDay) {
    try {
      const list = JSON.parse(cachedData);
      processUnitList(list);
      console.log('Unit Library loaded from Cache');
      return;
    } catch (e) {
      console.warn('Cache corrupted, fetching fresh data');
    }
  }

  // 2. 缓存不可用，网络请求
  try {
    const resp = await fetch(`${CONFIG.BATRACE_BASE}/Units`);
    if (!resp.ok) throw new Error('Unit API Failed');
    const list = await resp.json();

    localStorage.setItem(UNIT_CACHE_KEY, JSON.stringify(list));
    localStorage.setItem(UNIT_CACHE_TS_KEY, now.toString());

    processUnitList(list);
    console.log('Unit Library loaded from API');
  } catch (e) {
    console.warn('Failed to load unit library:', e);
    // 3. 网络失败，使用过期缓存
    if (cachedData) {
      try {
        processUnitList(JSON.parse(cachedData));
        console.log('Unit Library loaded from STALE Cache');
      } catch (ex) {
        /* ignore */
      }
    }
  }
}

/**
 * 获取单位显示名称
 * @param {string|number} id - 单位 ID
 * @returns {string}
 */
export function getUnitDisplayName(id) {
  return unitNameCache[id] || `Unit ${id}`;
}
