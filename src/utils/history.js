/**
 * 搜索历史管理（LocalStorage）
 */
import { CONFIG } from '../config.js';

const HISTORY_KEY = CONFIG.LS_HISTORY_KEY;

/**
 * 获取历史记录列表
 * @returns {Array<{id: string, name: string}>}
 */
export function getHistory() {
  return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
}

/**
 * 保存查询记录（去重，最多 10 条）
 * @param {string} id
 * @param {string} [name]
 */
export function saveHistory(id, name) {
  let h = getHistory();
  h = h.filter((x) => x.id !== id);
  h.unshift({ id, name: name || id });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, 10)));
}

/**
 * 移除一条历史记录
 * @param {string} id
 */
export function removeHistory(id) {
  let h = getHistory();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.filter((x) => x.id !== id)));
}
