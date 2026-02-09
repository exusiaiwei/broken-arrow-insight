/**
 * 应用入口
 * 初始化、事件绑定、主查询流程
 */
import { CONFIG } from './config.js';
import { setLang, t, updateUIStrings } from './i18n/index.js';
import { resolvePlayerId, fetchMatchList, fetchMatchDetail, searchPlayerByName, robustFetch } from './api/fetcher.js';
import { ensureGlobalUnitList } from './engine/units.js';
import { processFinalData, calculateFavoriteUnits } from './engine/analyzer.js';
import {
  updateProgress,
  renderResults,
  openPlayerDetail,
  closePlayerDetailModal,
  fetchAndShowUnitStickers,
} from './ui/renderer.js';
import { getHistory, saveHistory, removeHistory } from './utils/history.js';
import { escapeHtml } from './utils/format.js';

// ============================================
// 全局函数暴露（供 HTML onclick 调用）
// ============================================
window.__openPlayerDetail = openPlayerDetail;
window.__inspect = (id) => {
  const newUrl = window.location.origin + window.location.pathname + '?steamId=' + id;
  window.open(newUrl, '_blank');
};

window.setLang = (lang) => {
  setLang(lang);
  renderHistory();
};
window.handleCheck = handleCheck;
window.openSearchModal = openSearchModal;
window.closeSearchModal = closeSearchModal;
window.openMatchSearchModal = openMatchSearchModal;
window.closeMatchSearchModal = closeMatchSearchModal;
window.doNameSearch = doNameSearch;
window.doMatchSearch = doMatchSearch;
window.useFoundId = useFoundId;
window.useFromMatch = useFromMatch;
window.closePlayerDetailModal = closePlayerDetailModal;

// ============================================
// 初始化
// ============================================
window.onload = () => {
  setLang('zh');
  renderHistory();

  // URL参数自动查询
  const params = new URLSearchParams(window.location.search);
  const steamId = params.get('steamId');
  if (steamId) {
    document.getElementById('steamInput').value = steamId;
    handleCheck();
  }
};

// ============================================
// 搜索历史
// ============================================
function renderHistory() {
  const container = document.getElementById('historyContainer');
  const h = getHistory();
  container.innerHTML = h
    .map(
      (x) => `
    <div class="flex items-center gap-1 bg-slate-800/50 border border-slate-700 rounded-xl px-3 py-1.5 group hover:border-cyan-500 transition cursor-pointer" onclick="document.getElementById('steamInput').value='${x.id}'; handleCheck();">
      <span class="text-xs text-slate-300 font-bold truncate max-w-[100px]">${escapeHtml(x.name)}</span>
      <button onclick="event.stopPropagation(); window.__removeHistory('${x.id}')" class="text-slate-500 hover:text-red-400 text-xs font-bold ml-1 opacity-0 group-hover:opacity-100 transition">×</button>
    </div>`
    )
    .join('');
}

window.__removeHistory = (id) => {
  removeHistory(id);
  renderHistory();
};

// ============================================
// 主查询流程
// ============================================
async function handleCheck() {
  const input = document.getElementById('steamInput').value.trim();
  if (!input) return;

  const d = t();

  document.getElementById('errorArea').classList.add('hidden');
  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('resultPanel').classList.add('hidden');
  document.getElementById('unitStickerContainer').innerHTML = '';

  updateProgress(0, d.loading, 'Initializing...');

  // 提前加载单位库（不阻塞主流程）
  ensureGlobalUnitList();

  try {
    // 1. 解析玩家 ID
    let uid = input;
    if (input.length > 10 || isNaN(input)) {
      updateProgress(5, 'Resolving...', 'Checking Identity...');
      const resolved = await resolvePlayerId(input);
      uid = resolved.uid;
    }

    // 2. 获取对局列表
    updateProgress(10, 'Scanning...', 'Pulling Matches...');
    const matchList = await fetchMatchList(uid);

    // 3. 并发获取对局详情（3 并发窗口，比逐场快 ~3 倍）
    const CONCURRENCY = 3;
    const validMatches = [];
    let cursor = 0;

    while (cursor < matchList.length && validMatches.length < CONFIG.MATCH_GOAL) {
      // 取一批 match ID
      const batch = matchList.slice(cursor, cursor + CONCURRENCY);
      cursor += CONCURRENCY;

      // 并发请求这一批
      const results = await Promise.allSettled(
        batch.map(async (mId) => {
          const detail = await fetchMatchDetail(mId);
          return { id: mId, data: detail };
        })
      );

      // 处理结果
      for (const result of results) {
        if (validMatches.length >= CONFIG.MATCH_GOAL) break;
        if (result.status !== 'fulfilled') {
          console.error('Match fetch failed', result.reason);
          continue;
        }
        const { id: mId, data: detail } = result.value;
        const players = Object.values(detail.Data);
        const hasEloChange = players.some((p) => Math.abs(p.NewRating - p.OldRating) > 0.01);
        if (players.length >= CONFIG.MIN_PLAYERS && hasEloChange) {
          validMatches.push({ id: mId, data: detail });
          const prg = Math.round((validMatches.length / CONFIG.MATCH_GOAL) * 100);
          updateProgress(prg, `Syncing (${validMatches.length}/12)`, `Match ${mId} OK`);
        }
      }

      // 批次间小延迟，避免触发 API 限流
      if (validMatches.length < CONFIG.MATCH_GOAL && cursor < matchList.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    if (validMatches.length < CONFIG.MATCH_GOAL) throw new Error(d.err_insufficient);

    // 4. 显示玩家信息
    const finalMe = validMatches[0].data.Data[uid];
    saveHistory(uid, finalMe?.Name);

    document.getElementById('userNameDisplay').innerText = `${finalMe?.Name || 'Unknown'} ${finalMe?.Level ? '(Lv.' + finalMe.Level + ')' : ''}`;
    document.getElementById('calcTimeDisplay').innerText = `Calculated: ${new Date().toLocaleString()}`;

    // 5. 分析 & 渲染结果
    const result = processFinalData(uid, validMatches);
    renderResults(result);

    // 6. 异步加载爱用单位贴纸
    const favUnits = calculateFavoriteUnits(validMatches, uid);
    if (favUnits) {
      fetchAndShowUnitStickers(favUnits);
    }
  } catch (e) {
    document.getElementById('errorArea').classList.remove('hidden');
    document.getElementById('errorMsg').innerText = e.message;
  } finally {
    document.getElementById('loading').classList.add('hidden');
  }
}

// ============================================
// 搜索模态框
// ============================================
function openSearchModal() {
  document.getElementById('idSearchModal').classList.remove('hidden');
  document.getElementById('modalSearchInput').focus();
}

function closeSearchModal() {
  document.getElementById('idSearchModal').classList.add('hidden');
}

function openMatchSearchModal() {
  document.getElementById('matchSearchModal').classList.remove('hidden');
  document.getElementById('matchIdInput').focus();
}

function closeMatchSearchModal() {
  document.getElementById('matchSearchModal').classList.add('hidden');
  document.getElementById('matchModalResultArea').classList.add('hidden');
  document.getElementById('matchIdInput').value = '';
  document.getElementById('matchModalStatus').innerText = '';
}

async function doNameSearch() {
  const name = document.getElementById('modalSearchInput').value.trim();
  const statusEl = document.getElementById('modalStatusMsg');
  const listEl = document.getElementById('modalResultList');
  const resultEl = document.getElementById('modalFinalResult');
  const d = t();

  if (!name) return;

  statusEl.innerText = d.modal_status_search;
  statusEl.className = 'text-xs text-orange-400 min-h-[1.5rem] mb-2 pl-1 animate-pulse';
  listEl.classList.add('hidden');
  resultEl.classList.add('hidden');
  listEl.innerHTML = '';

  try {
    const results = await searchPlayerByName(name);
    if (results.length === 0) {
      statusEl.innerText = d.modal_status_none;
      statusEl.className = 'text-xs text-red-400 min-h-[1.5rem] mb-2 pl-1';
      return;
    }
    statusEl.innerText = d.modal_status_found.replace('{n}', results.length);
    statusEl.className = 'text-xs text-green-400 min-h-[1.5rem] mb-2 pl-1';
    renderPlayerList(results);
  } catch (err) {
    statusEl.innerText = d.modal_status_err + err.message;
    statusEl.className = 'text-xs text-red-400 min-h-[1.5rem] mb-2 pl-1';
  }
}

function renderPlayerList(players) {
  const listEl = document.getElementById('modalResultList');
  listEl.classList.remove('hidden');
  listEl.innerHTML = players
    .map(
      (p) => `
    <div class="search-result-item flex items-center justify-between p-3 bg-slate-800/50 border border-slate-700 rounded-xl cursor-pointer transition hover:bg-orange-900/20 hover:border-orange-500/50" data-player='${JSON.stringify(p).replace(/'/g, '&#39;')}'>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-bold text-slate-100 truncate">${escapeHtml(p.name || p.Name || 'Unknown')}</div>
        <div class="text-[10px] font-mono text-slate-500">ID: ${p.stbId || p.id || 'N/A'}</div>
      </div>
      <div class="text-right ml-4">
        <div class="text-[10px] text-slate-400 font-mono">ELO ${p.elo ? p.elo.toFixed(0) : 'N/A'}</div>
      </div>
    </div>`
    )
    .join('');

  // 添加点击事件
  listEl.querySelectorAll('.search-result-item').forEach((el) => {
    el.onclick = () => {
      const player = JSON.parse(el.dataset.player);
      selectPlayerFromSearch(player);
    };
  });
}

function selectPlayerFromSearch(player) {
  const resultEl = document.getElementById('modalFinalResult');
  document.getElementById('modalSelectedName').innerText = player.name || player.Name || 'Unknown';
  document.getElementById('modalSelectedId').innerText = player.stbId || player.id || 'N/A';
  resultEl.classList.remove('hidden');
}

function useFoundId() {
  const id = document.getElementById('modalSelectedId').innerText;
  document.getElementById('steamInput').value = id;
  closeSearchModal();
  handleCheck();
}

async function doMatchSearch() {
  const mid = document.getElementById('matchIdInput').value.trim();
  const status = document.getElementById('matchModalStatus');
  const resultArea = document.getElementById('matchModalResultArea');
  const d = t();

  if (!mid) return;

  status.innerText = d.modal_match_loading;
  status.className = 'text-xs mb-4 pl-1 text-cyan-400 animate-pulse';
  resultArea.classList.add('hidden');

  try {
    const detail = await robustFetch(`${CONFIG.BARMORY_BASE}/stb/match/${mid}`);
    const data = detail.Data;

    if (detail.WinnerTeam === undefined) {
      const pValues = Object.values(data);
      const ref = pValues.find((p) => p.NewRating !== undefined && p.OldRating !== undefined);
      if (ref) {
        const win = ref.NewRating - ref.OldRating >= 0;
        detail.WinnerTeam = win ? ref.TeamId : ref.TeamId === 1 ? 0 : 1;
      }
    }

    const players = Object.entries(data).map(([id, val]) => ({ ...val, Id: id }));
    const team0 = players.filter((p) => p.TeamId === 0 || p.TeamId === undefined);
    const team1 = players.filter((p) => p.TeamId === 1);

    const renderMiniCard = (p) => {
      const isWin = p.TeamId === detail.WinnerTeam;
      return `
      <div onclick="useFromMatch('${p.Id}')" class="flex items-center justify-between p-3 bg-slate-800/50 hover:bg-cyan-900/30 border border-slate-700 hover:border-cyan-500 rounded-xl cursor-pointer transition group">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-bold text-slate-100 group-hover:text-white truncate">${escapeHtml(p.Name || 'Unknown')}</div>
          <div class="text-[10px] font-mono text-slate-500 group-hover:text-cyan-400/70">ID: ${p.Id}</div>
        </div>
        <div class="text-right ml-4">
          <div class="text-[10px] font-black ${isWin ? 'text-cyan-400' : 'text-red-400'}">${isWin ? d.res_vic : d.res_def}</div>
          <div class="text-[10px] text-slate-400 font-mono">ELO ${p.NewRating?.toFixed(0) || '---'}</div>
        </div>
      </div>`;
    };

    document.getElementById('matchModalTeam0').innerHTML = `<div class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Team Alpha</div>` + team0.map(renderMiniCard).join('');
    document.getElementById('matchModalTeam1').innerHTML = `<div class="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 px-1">Team Bravo</div>` + team1.map(renderMiniCard).join('');

    status.innerText = '';
    resultArea.classList.remove('hidden');
  } catch (e) {
    status.innerText = d.modal_match_err;
    status.className = 'text-xs mb-4 pl-1 text-red-400';
  }
}

function useFromMatch(uid) {
  document.getElementById('steamInput').value = uid;
  closeMatchSearchModal();
  handleCheck();
}
