/**
 * 格式化工具函数
 */

/**
 * 格式化对局时长（秒 → Xm Xs）
 * @param {number} sec
 * @returns {string}
 */
export function formatDuration(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m ${s}s`;
}

/**
 * 格式化 Unix 时间戳为可读日期
 * @param {number} ts - Unix 时间戳（秒）
 * @returns {string}
 */
export function formatMatchTime(ts) {
  const d = new Date(ts * 1000);
  const pad = (n) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * HTML 转义（防止 XSS）
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
