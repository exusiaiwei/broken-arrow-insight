/**
 * API 请求层
 * 策略：batrace 直连优先 → barmory + CORS 代理池回退
 * 来自改版1的双源方案
 */
import { CONFIG } from '../config.js';

/**
 * 将 barmory.net URL 映射为 batrace.aoeiaol.top 等效 URL
 * @param {string} barmoryUrl - barmory API 路径
 * @returns {{ url: string, transform: Function } | null}
 */
function toBatraceUrl(barmoryUrl) {
  let m;
  // /stb/commander/{steamId}/steam -> /steam/player/{steamId}
  if ((m = barmoryUrl.match(/stb\/commander\/([^/]+)\/steam$/))) {
    return { url: `${CONFIG.BATRACE_BASE}/steam/player/${m[1]}`, transform: (d) => d.data || d };
  }
  // /stb/commander/{id}/matches -> /stb/matchlistid_by_stbId?stbId={id}
  if ((m = barmoryUrl.match(/stb\/commander\/(\d+)\/matches/))) {
    return { url: `${CONFIG.BATRACE_BASE}/stb/matchlistid_by_stbId?stbId=${m[1]}`, transform: (d) => d };
  }
  // /stb/match/{id} -> /stb/match_by_matchid?match_id={id}
  if ((m = barmoryUrl.match(/stb\/match\/(\d+)/))) {
    return { url: `${CONFIG.BATRACE_BASE}/stb/match_by_matchid?match_id=${m[1]}`, transform: (d) => d };
  }
  return null;
}

/**
 * 带容错的 API 请求：先尝试 batrace 直连，失败后走代理池
 * @param {string} url - barmory 格式的 API URL
 * @param {number} [attempt=0] - 当前重试次数
 * @returns {Promise<any>}
 */
export async function robustFetch(url, attempt = 0) {
  // 首次尝试走 batrace 直连（无需代理）
  if (attempt === 0) {
    const mapped = toBatraceUrl(url);
    if (mapped) {
      try {
        const r = await fetch(mapped.url);
        if (r.ok) {
          const d = await r.json();
          return mapped.transform(d);
        }
      } catch (e) {
        /* batrace 失败，回退到代理池 */
      }
    }
  }

  // 回退：通过 CORS 代理池访问 barmory.net
  const proxy = CONFIG.PROXIES[attempt % CONFIG.PROXIES.length];
  try {
    const fetchUrl = proxy.url(url);
    const r = await fetch(fetchUrl);
    if (!r.ok) throw new Error(`HTTP_${r.status}`);
    const d = await r.json();

    // AllOrigins / Codetabs 返回格式处理
    if (d.contents) {
      return typeof d.contents === 'string' ? JSON.parse(d.contents) : d.contents;
    }
    return d;
  } catch (e) {
    if (attempt < 4) return robustFetch(url, attempt + 1);
    throw e;
  }
}

/**
 * 解析玩家身份（Steam64 ID 或游戏内 ID）
 * @param {string} input - 用户输入
 * @returns {Promise<{ uid: string, userData: any }>}
 */
export async function resolvePlayerId(input) {
  let uid = input;
  let userData = null;

  if (input.length > 10 || isNaN(input)) {
    userData = await robustFetch(`${CONFIG.BARMORY_BASE}/stb/commander/${input}/steam`);
    uid = String(userData.id);
  }

  return { uid, userData };
}

/**
 * 获取玩家对局列表
 * @param {string} uid - 游戏内数字 ID
 * @returns {Promise<Array<number>>}
 */
export async function fetchMatchList(uid) {
  const timeStr = new Date().toISOString().split('T')[0] + '_' + new Date().getHours().toString().padStart(2, '0');
  return robustFetch(`${CONFIG.BARMORY_BASE}/stb/commander/${uid}/matches?time=${timeStr}`);
}

/**
 * 获取对局详情
 * @param {number|string} matchId
 * @returns {Promise<Object>}
 */
export async function fetchMatchDetail(matchId) {
  return robustFetch(`${CONFIG.BARMORY_BASE}/stb/match/${matchId}`);
}

/**
 * 搜索玩家昵称
 * @param {string} name - 玩家昵称（模糊匹配）
 * @returns {Promise<Array>}
 */
export async function searchPlayerByName(name) {
  const url = `https://batrace.aoeiaol.top/api/v1/search/players?q=${encodeURIComponent(name)}&limit=20`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('API Request Failed');
  const data = await response.json();
  return data.results || [];
}
