/**
 * UI 渲染模块 v2
 * 适配 WCS + 风格画像双轴系统
 */
import { t, getLang } from '../i18n/index.js';
import { MEDAL_CONFIG } from '../engine/medals.js';
import { getUnitDisplayName, ensureGlobalUnitList } from '../engine/units.js';
import { escapeHtml, formatDuration, formatMatchTime } from '../utils/format.js';

/** 渲染用全局状态 */
let currentMatchStats = [];

export function getCurrentMatchStats() {
  return currentMatchStats;
}

export function updateProgress(percent, status, detail) {
  document.getElementById('loadPercent').innerText = percent + '%';
  document.getElementById('loadProgressFill').style.width = percent + '%';
  document.getElementById('loadStatus').innerText = status;
  document.getElementById('loadDetail').innerText = detail;
}

// ============================================
// 主结果渲染
// ============================================

/**
 * 渲染完整结果面板
 * @param {Object} result - processFinalData 返回的完整结果
 */
export function renderResults(result) {
  const { stats, wcs, wcsBreakdown, wcsLevel, playstyle, wins, winRate, topMedals } = result;
  const d = t();
  currentMatchStats = stats;
  document.getElementById('resultPanel').classList.remove('hidden');

  // ---- WCS 大数字 ----
  const display = document.getElementById('maggotScoreDisplay');
  display.innerText = wcs.toFixed(1);
  display.style.color = wcs >= 65 ? '#4ade80' : wcs >= 40 ? '#facc15' : '#f87171';

  // 等级标签
  const levelLabel = d.wcs_levels?.[wcsLevel.key] || wcsLevel.key;
  document.getElementById('maggotLabel').innerText = levelLabel;

  // 仪表条 (0=左/红, 100=右/绿)
  document.getElementById('meterIndicator').style.left = `${Math.min(wcs, 100)}%`;

  // ---- WCS 六维数据 ----
  document.getElementById('ref_avgImpact').innerText = wcsBreakdown.battlefield.toFixed(1);
  document.getElementById('ref_avgDR').innerText = wcsBreakdown.combat.toFixed(1);
  document.getElementById('ref_avgTR').innerText = wcsBreakdown.economy.toFixed(1);
  document.getElementById('ref_avgOR').innerText = wcsBreakdown.teamwork.toFixed(1);
  document.getElementById('ref_avgST').innerText = wcsBreakdown.strategy.toFixed(1);
  document.getElementById('ref_avgFP').innerText = wcsBreakdown.firepower.toFixed(1);
  document.getElementById('ref_WR').innerText = winRate + '%';

  // ---- Tooltip 说明 ----
  const tips = d.wcs_tips || {
    battlefield: 'Team loss share + Team damage share + Team destruction share\nWeight: 29%',
    combat: 'D/L Ratio + Survival Rate + Damage Trade + Cost Efficiency\nWeight: 16%',
    economy: 'Refund Rate + Total Refunded\nWeight: 16%',
    teamwork: 'Unit Diversity + Supply From/To Allies\nWeight: 10%',
    strategy: 'Objectives + Supply Captured + Buildings Destroyed\nWeight: 8%',
    firepower: 'Damage Dealt + Destruction Score\nWeight: 6%',
  };
  Object.entries(tips).forEach(([key, text]) => {
    const el = document.getElementById(`tip_${key}`);
    if (el) el.innerText = text;
  });

  // ---- 勋章贴纸 ----
  renderMedalStickers(topMedals);

  // ---- 趋势贴纸 ----
  const container = document.querySelector('.tag-sticker-container');
  const recentAvg = stats.slice(0, 3).reduce((a, b) => a + b.wcs, 0) / 3;
  const oldAvg = stats.slice(3).reduce((a, b) => a + b.wcs, 0) / Math.max(stats.length - 3, 1);
  const trendText = recentAvg > oldAvg + 3 ? (d.trend_up || '📈 上升趋势') : recentAvg < oldAvg - 3 ? (d.trend_down || '📉 下降趋势') : (d.trend_flat || '➡️ 稳定发挥');

  const trendEl = document.createElement('div');
  trendEl.title = d.trend_desc || 'Performance trend';
  trendEl.className = 'tag-sticker bg-slate-600/20 border-slate-500/50 text-slate-300 cursor-help';
  trendEl.innerText = trendText;
  container.appendChild(trendEl);

  // ---- ELO 贴纸 ----
  if (stats.length > 0) {
    const currentMe = stats[0].ally.find((p) => p.isMe);
    if (currentMe) {
      const eloEl = document.createElement('div');
      eloEl.title = d.elo_desc || 'Current ELO';
      eloEl.className = 'tag-sticker bg-violet-600/20 border-violet-500/50 text-violet-300 font-mono cursor-help';
      eloEl.innerHTML = `ELO ${currentMe.elo}`;
      container.appendChild(eloEl);
    }
  }

  // ---- 风格画像 ----
  renderPlaystyleSection(playstyle);

  // ---- 对局列表 ----
  document.getElementById('matchesContainer').innerHTML = stats
    .map((m) => renderMatchCard(m, d))
    .join('');
}

// ============================================
// 风格画像渲染
// ============================================

function renderPlaystyleSection(playstyle) {
  const d = t();
  const container = document.getElementById('playstyleSection');
  if (!container) return;

  container.classList.remove('hidden');

  // 风格标签
  document.getElementById('playstyleLabel').innerHTML =
    `<span class="text-3xl mr-2">${playstyle.labelIcon}</span>` +
    `<span>${playstyle.label}</span>`;

  // 雷达图
  const radarEl = document.getElementById('playstyleRadar');
  radarEl.innerHTML = renderRadarSVG(playstyle.dimensions, d);

  // 维度条
  const barsEl = document.getElementById('playstyleBars');
  barsEl.innerHTML = playstyle.dimensions.map((dim) => {
    const label = d.style_dims?.[dim.key] || dim.key;
    const barColor = dim.value >= 60 ? 'bg-cyan-500' : dim.value >= 40 ? 'bg-yellow-500' : 'bg-slate-500';
    return `
    <div class="flex items-center gap-3">
      <span class="text-lg w-6 text-center">${dim.icon}</span>
      <span class="text-[11px] text-slate-400 w-16 uppercase font-bold truncate">${label}</span>
      <div class="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div class="${barColor} h-full rounded-full transition-all duration-700" style="width:${dim.value}%"></div>
      </div>
      <span class="text-xs font-mono font-bold text-slate-300 w-8 text-right">${dim.value}</span>
    </div>`;
  }).join('');
}

/**
 * 渲染 SVG 雷达图
 */
function renderRadarSVG(dimensions, dict) {
  const cx = 100, cy = 100, r = 70;
  const n = dimensions.length;
  const angleStep = (2 * Math.PI) / n;

  // 网格线
  const gridLines = [0.25, 0.5, 0.75, 1.0].map((scale) => {
    const pts = Array.from({ length: n }, (_, i) => {
      const angle = -Math.PI / 2 + i * angleStep;
      return `${cx + r * scale * Math.cos(angle)},${cy + r * scale * Math.sin(angle)}`;
    }).join(' ');
    return `<polygon points="${pts}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`;
  }).join('');

  // 轴线
  const axes = Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    return `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.cos(angle)}" y2="${cy + r * Math.sin(angle)}" stroke="rgba(255,255,255,0.06)" stroke-width="1"/>`;
  }).join('');

  // 数据多边形
  const dataPoints = dimensions.map((d, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const val = Math.min(d.value, 100) / 100;
    return `${cx + r * val * Math.cos(angle)},${cy + r * val * Math.sin(angle)}`;
  }).join(' ');

  // 数据点
  const dots = dimensions.map((d, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const val = Math.min(d.value, 100) / 100;
    const dx = cx + r * val * Math.cos(angle);
    const dy = cy + r * val * Math.sin(angle);
    return `<circle cx="${dx}" cy="${dy}" r="3" fill="#06b6d4" stroke="white" stroke-width="1"/>`;
  }).join('');

  // 标签
  const labels = dimensions.map((d, i) => {
    const angle = -Math.PI / 2 + i * angleStep;
    const lx = cx + (r + 22) * Math.cos(angle);
    const ly = cy + (r + 22) * Math.sin(angle);
    const label = dict.style_dims?.[d.key] || d.key;
    const anchor = Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end';
    return `<text x="${lx}" y="${ly}" fill="#94a3b8" text-anchor="${anchor}" dominant-baseline="middle" font-size="9" font-weight="bold">${d.icon} ${label}</text>`;
  }).join('');

  return `<svg viewBox="0 0 200 200" class="w-full h-full max-w-[240px] mx-auto">
    ${gridLines}${axes}
    <polygon points="${dataPoints}" fill="rgba(6,182,212,0.2)" stroke="rgba(6,182,212,0.8)" stroke-width="2"/>
    ${dots}${labels}
  </svg>`;
}

// ============================================
// 勋章贴纸
// ============================================

function renderMedalStickers(topMedals) {
  const d = t();
  const container = document.querySelector('.tag-sticker-container');
  container.innerHTML = '';

  const colorStyles = {
    red: 'bg-red-600/20 border-red-500/50 text-red-300',
    orange: 'bg-orange-600/20 border-orange-500/50 text-orange-300',
    yellow: 'bg-yellow-600/20 border-yellow-500/50 text-yellow-300',
    green: 'bg-green-600/20 border-green-500/50 text-green-300',
    emerald: 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300',
    blue: 'bg-blue-600/20 border-blue-500/50 text-blue-300',
    pink: 'bg-pink-600/20 border-pink-500/50 text-pink-300',
    slate: 'bg-slate-600/20 border-slate-500/50 text-slate-300',
    gray: 'bg-gray-600/20 border-gray-500/50 text-gray-300',
  };

  topMedals.forEach((key) => {
    const conf = MEDAL_CONFIG.find((c) => c.key === key);
    if (!conf) return;
    const name = d.medals?.[key] || key;
    const desc = d.medal_descs?.[key] || name;
    const colorBase = conf.color.replace('text-', '').replace('-400', '');
    const styleClass = colorStyles[colorBase] || colorStyles['gray'];

    const el = document.createElement('div');
    el.title = desc;
    el.className = `tag-sticker ${styleClass} flex items-center gap-2 cursor-help`;
    el.innerHTML = `<span class="text-lg">${conf.icon}</span><span>${name}</span>`;
    container.appendChild(el);
  });
}

// ============================================
// 对局卡片
// ============================================

function renderMatchCard(m, d) {
  const reasonText = d.reasons?.[m.endReason] || d.reasons?.[1] || '';
  const timeText = formatMatchTime(m.endTime);
  const durText = formatDuration(m.duration);

  let resultBadgeColor, resultText;
  if (m.isDraw) {
    resultBadgeColor = 'bg-slate-600/30 text-slate-300 border border-slate-500/30';
    resultText = d.res_draw;
  } else {
    resultBadgeColor = m.isWin ? 'bg-cyan-600/20 text-cyan-400' : 'bg-red-600/20 text-red-400';
    resultText = m.isWin ? d.res_vic : d.res_def;
  }

  const wcsColor = m.wcs >= 65 ? 'text-green-400' : m.wcs >= 40 ? 'text-yellow-400' : 'text-red-400';

  // WCS 维度 mini 条
  const dimDefs = [
    { key: 'battlefield', label: d.style_dims?.battlefield || '⚔️', color: '#06b6d4' },
    { key: 'combat',      label: d.style_dims?.combat || '💎',      color: '#fb923c' },
    { key: 'economy',     label: d.style_dims?.economy || '💰',     color: '#4ade80' },
    { key: 'teamwork',    label: d.style_dims?.teamwork || '🤝',    color: '#a78bfa' },
    { key: 'strategy',    label: d.style_dims?.strategy || '🏁',    color: '#34d399' },
    { key: 'firepower',   label: d.style_dims?.firepower || '🔥',   color: '#f87171' },
  ];
  const wcsBarHtml = dimDefs.map((dim) => {
    const val = m.wcsBreakdown?.[dim.key] ?? 50;
    const w = Math.min(val, 100);
    const barColor = val >= 60 ? dim.color : val >= 40 ? '#94a3b8' : '#ef4444';
    return `<div class="flex items-center gap-1 flex-1 min-w-0" title="${dim.label}: ${val.toFixed(0)}">
      <span class="text-[8px] md:text-[9px] text-slate-500 w-4 md:w-12 text-right truncate font-bold">${dim.label}</span>
      <div class="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div class="h-full rounded-full transition-all" style="width:${w}%;background:${barColor};opacity:0.8"></div>
      </div>
      <span class="text-[8px] font-mono text-slate-500 w-5 text-right">${val.toFixed(0)}</span>
    </div>`;
  }).join('');

  return `
  <div class="glass-panel rounded-[2rem] md:rounded-[3rem] overflow-hidden border-white/10 shadow-2xl">
    <div class="bg-white/5 px-4 py-3 md:px-8 md:py-4 flex flex-col md:flex-row justify-between items-start md:items-center text-[10px] md:text-xs font-bold font-mono text-slate-400 gap-2 md:gap-0">
      <div class="flex flex-wrap items-center gap-2 md:gap-4 leading-relaxed">
        <span class="whitespace-nowrap">ID: ${m.id}</span>
        <span class="w-px h-3 bg-white/10 hidden md:block"></span>
        <span>${timeText}</span>
        <span class="w-px h-3 bg-white/10 hidden md:block"></span>
        <span>${d.meta_map || 'Map'} ${m.mapId}</span>
        <span class="w-px h-3 bg-white/10 hidden md:block"></span>
        <span>${durText}</span>
        <span class="w-px h-3 bg-white/10 hidden md:block"></span>
        <span class="whitespace-nowrap">${reasonText}</span>
      </div>
      <span class="px-3 py-1 md:px-4 md:py-1 ${resultBadgeColor} rounded-lg font-black uppercase tracking-widest flex items-center gap-2 self-end md:self-auto">
        <span class="${wcsColor}">WCS ${m.wcs.toFixed(1)}</span>
        <span class="opacity-50">/</span>
        <span>${resultText}</span>
      </span>
    </div>
    <div class="bg-white/3 px-4 py-1.5 md:px-8 md:py-2 flex gap-2 md:gap-3 border-t border-white/5">
      ${wcsBarHtml}
    </div>
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-px bg-white/10">
      <div class="bg-[#0f172a] p-2 md:p-4">${renderTeam(m.ally, m.id)}</div>
      <div class="bg-[#0f172a] p-2 md:p-4">${renderTeam(m.enemy, m.id)}</div>
    </div>
  </div>`;
}

// ============================================
// 队伍渲染
// ============================================

function renderTeam(players, matchId) {
  const d = t();
  return players
    .map((p) => {
      const hoverDetail = `${d.kill || 'Kill'}: ${p.kScore.toLocaleString()} | ${d.loss || 'Loss'}: ${p.lScore.toLocaleString()} | ${d.obj || 'Obj'}: ${p.oScore}`;
      const medalsHtml =
        p.medals.length > 0
          ? `<div class="flex flex-wrap gap-1 mt-1.5">${p.medals
              .map((m) => {
                const mName = d.medals?.[m.key] || m.key;
                return `<div class="medal-badge group" title="${mName}: ${Math.round(m.val).toLocaleString()}">
                  <span class="text-[10px] md:text-[12px] filter drop-shadow-md select-none leading-none">${m.icon}</span>
                  <span class="text-[10px] font-bold ${m.color} opacity-90 leading-none whitespace-nowrap">${mName}</span>
                </div>`;
              })
              .join('')}</div>`
          : '';

      let favHtml = '';
      if (p.favUnits) {
        const uD = p.favUnits.d.id > 0 ? getUnitDisplayName(p.favUnits.d.id) : '';
        const uK = p.favUnits.k.id > 0 ? getUnitDisplayName(p.favUnits.k.id) : '';
        const uT = p.favUnits.t.id > 0 ? getUnitDisplayName(p.favUnits.t.id) : '';

        const renderTag = (name, val, colorClass, textClass) => {
          if (!name) return '';
          return `<div class="match-unit-tag ${textClass} ${colorClass}">
            <span class="truncate opacity-90 flex-1">${name}</span>
            <span class="ml-1 opacity-70">${val}</span>
          </div>`;
        };

        const tagD = renderTag(uD, Math.round(p.favUnits.d.v).toLocaleString(), 'border-orange-500/30 bg-orange-900/20', 'text-orange-200');
        const tagK = renderTag(uK, p.favUnits.k.v, 'border-red-500/30 bg-red-900/20', 'text-red-200');
        const tagT = renderTag(uT, Math.round(p.favUnits.t.v).toLocaleString(), 'border-blue-500/30 bg-blue-900/20', 'text-blue-200');

        if (tagD || tagK || tagT) {
          favHtml = `<div class="flex flex-col gap-0.5 ml-2 w-24 md:w-32 flex-shrink-0 border-l border-white/10 pl-1 justify-center h-full">
            ${tagD}${tagK}${tagT}
          </div>`;
        }
      }

      return `
      <div class="teammate-row flex items-center p-2 md:p-3 rounded-xl md:rounded-2xl ${p.isMe ? 'is-me' : ''}" title="${hoverDetail}" onclick="window.__openPlayerDetail('${matchId}', '${p.id}')">
        <div class="flex-1 min-w-0 pr-2 md:pr-4 flex flex-col justify-center relative">
          <div class="flex justify-between items-start w-full">
            <div class="text-xs md:text-sm font-black text-slate-100 truncate mb-0.5 mr-1">${escapeHtml(p.name)}</div>
            <div class="text-right font-mono flex-shrink-0 flex flex-col items-end leading-none">
              <div class="text-[10px] md:text-[11px] font-black ${parseFloat(p.gain) >= 0 ? 'text-green-500' : 'text-red-500'}">${parseFloat(p.gain) >= 0 ? '+' : ''}${p.gain}</div>
              <div class="text-[9px] md:text-[10px] font-bold text-slate-500">ELO ${p.elo}</div>
            </div>
          </div>
          ${medalsHtml}
          <div class="id-link mt-1" onclick="event.stopPropagation(); window.__inspect('${p.id}')">${p.id}</div>
        </div>
        <div class="w-16 md:w-28 space-y-1 flex-shrink-0">
          <div class="flex items-center gap-1"><div class="bar-container"><div class="bar-kill" style="width:${p.kPct}%"></div></div></div>
          <div class="flex items-center gap-1"><div class="bar-container"><div class="bar-loss" style="width:${p.lPct}%"></div></div></div>
          <div class="flex items-center gap-1"><div class="bar-container"><div class="bar-obj" style="width:${p.oPct}%"></div></div></div>
        </div>
        ${favHtml}
      </div>`;
    })
    .join('');
}

// ============================================
// 玩家详情弹窗
// ============================================

export function openPlayerDetail(matchId, playerId) {
  const match = currentMatchStats.find((m) => String(m.id) === String(matchId));
  if (!match) return;

  let player = match.ally.find((p) => String(p.id) === String(playerId));
  if (!player) player = match.enemy.find((p) => String(p.id) === String(playerId));
  if (!player) return;

  const raw = player.rawData;

  document.getElementById('pd_name').innerText = player.name || 'Unknown';
  document.getElementById('pd_id').innerText = `ID: ${player.id}`;
  document.getElementById('pd_elo').innerText = `ELO ${player.elo} (${parseFloat(player.gain) >= 0 ? '+' : ''}${player.gain})`;
  document.getElementById('pd_elo').className = parseFloat(player.gain) >= 0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono';

  document.getElementById('pd_kill').innerText = Math.round(player.kScore).toLocaleString();
  document.getElementById('pd_loss').innerText = Math.round(player.lScore).toLocaleString();
  document.getElementById('pd_obj').innerText = Math.round(player.oScore).toLocaleString();
  document.getElementById('pd_kd').innerText = player.kd.toFixed(2);

  document.getElementById('pd_dmg_dealt').innerText = Math.round(raw.DamageDealt || 0).toLocaleString();
  document.getElementById('pd_dmg_taken').innerText = Math.round(raw.DamageReceived || 0).toLocaleString();
  document.getElementById('pd_supply').innerText = Math.round(raw.SupplyPointsConsumed || 0).toLocaleString();
  document.getElementById('pd_supply_ally').innerText = Math.round(raw.SupplyPointsConsumedFromAllies || 0).toLocaleString();
  document.getElementById('pd_supply_give').innerText = Math.round(raw.SupplyPointsConsumedByAllies || 0).toLocaleString();
  document.getElementById('pd_units').innerText = Math.round(raw.TotalSpawnedUnitScore || 0).toLocaleString();

  const setTopUnit = (prefix, unitObj) => {
    const name = unitObj && unitObj.id > 0 ? getUnitDisplayName(unitObj.id) : '-';
    const val = unitObj && unitObj.v > -1 ? Math.round(unitObj.v).toLocaleString() : '0';
    document.getElementById(`${prefix}_name`).innerText = name;
    document.getElementById(`${prefix}_val`).innerText = val;
  };

  setTopUnit('pd_top_dmg', player.favUnits.d);
  setTopUnit('pd_top_kill', player.favUnits.k);
  setTopUnit('pd_top_tank', player.favUnits.t);

  document.getElementById('playerDetailModal').classList.remove('hidden');
}

export function closePlayerDetailModal() {
  document.getElementById('playerDetailModal').classList.add('hidden');
}

// ============================================
// 爱用单位贴纸
// ============================================

export async function fetchAndShowUnitStickers(favUnits) {
  await ensureGlobalUnitList();
  const container = document.getElementById('unitStickerContainer');
  if (!container) return;
  container.innerHTML = '';

  const lang = getLang();
  const items = [
    { type: 'dmg', unit: favUnits.topDmg, icon: '⚡', labelPrefix: { zh: '输出', en: 'Dmg', ja: '火力', ru: 'Dmg' } },
    { type: 'kill', unit: favUnits.topKill, icon: '🔫', labelPrefix: { zh: '击杀', en: 'Kill', ja: '撃破', ru: 'Kill' } },
    { type: 'tank', unit: favUnits.topTank, icon: '🛡️', labelPrefix: { zh: '抗伤', en: 'Tank', ja: '耐久', ru: 'Tank' } },
  ];

  for (const item of items) {
    if (!item.unit || item.unit.id <= 0) continue;
    const name = getUnitDisplayName(item.unit.id);
    if (!name) continue;

    const el = document.createElement('div');
    let colorClass = 'bg-slate-600/20 border-slate-500/50 text-slate-300';
    if (item.type === 'dmg') colorClass = 'bg-orange-600/20 border-orange-500/50 text-orange-300';
    if (item.type === 'kill') colorClass = 'bg-red-600/20 border-red-500/50 text-red-300';
    if (item.type === 'tank') colorClass = 'bg-blue-600/20 border-blue-500/50 text-blue-300';

    el.className = `tag-sticker tag-sticker-left ${colorClass} flex items-center gap-2 cursor-help`;

    let valStr = '';
    if (item.type === 'dmg') valStr = Math.round(item.unit.damageDealt).toLocaleString();
    if (item.type === 'kill') valStr = item.unit.kills;
    if (item.type === 'tank') valStr = Math.round(item.unit.damageReceived).toLocaleString();
    el.title = `${item.labelPrefix[lang] || item.labelPrefix.en}: ${valStr}`;
    el.innerHTML = `<span class="text-lg">${item.icon}</span><span>${name}</span>`;
    container.appendChild(el);

    await new Promise((r) => setTimeout(r, 100));
  }
}
