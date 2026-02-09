/**
 * 数据分析引擎 v3
 * 基于 SHAP + XGBoost 数据驱动的双轴评价系统
 * 六维类别：战场贡献 / 战斗效率 / 经济管理 / 团队协作 / 战略目标 / 火力输出
 */
import { CONFIG } from '../config.js';
import { assignMedals } from './medals.js';

// ============================================
// 工具函数
// ============================================

/**
 * 计算百分位 (0-100)
 * 使用中位数法处理并列
 */
function percentile(value, allValues) {
  if (allValues.length <= 1) return 50;
  const below = allValues.filter((v) => v < value).length;
  const equal = allValues.filter((v) => v === value).length;
  return ((below + equal * 0.5) / allValues.length) * 100;
}

function safeDivide(a, b, fallback = 0) {
  return b > 0 ? a / b : fallback;
}

/**
 * 从 UnitData 中统计建筑摧毁数和友伤总量
 */
function extractUnitStats(unitData) {
  let buildingsDestroyed = 0;
  let selfDamage = 0;
  let unitTypes = new Set();
  let topD = { id: 0, v: -1 }, topK = { id: 0, v: -1 }, topT = { id: 0, v: -1 };

  if (!unitData) return { buildingsDestroyed, selfDamage, unitTypes, topD, topK, topT };

  const unitAgg = {};

  Object.values(unitData).forEach((u) => {
    if (!u.Id) return;
    unitTypes.add(u.Id);
    buildingsDestroyed += u.BuildingDestroyedCount || 0;
    selfDamage += u.TotalSelfDamageDealt || 0;

    if (!unitAgg[u.Id]) unitAgg[u.Id] = { d: 0, k: 0, t: 0 };
    unitAgg[u.Id].d += u.TotalDamageDealt || 0;
    unitAgg[u.Id].k += u.KilledCount || 0;
    unitAgg[u.Id].t += u.TotalDamageReceived || 0;
  });

  Object.entries(unitAgg).forEach(([uid, s]) => {
    if (s.d > topD.v) topD = { id: uid, v: s.d };
    if (s.k > topK.v) topK = { id: uid, v: s.k };
    if (s.t > topT.v) topT = { id: uid, v: s.t };
  });

  return { buildingsDestroyed, selfDamage, unitTypes, topD, topK, topT };
}

// ============================================
// 主分析函数
// ============================================

/**
 * 处理所有对局数据，生成双轴评价
 * @param {string} myUid
 * @param {Array<{id: string, data: Object}>} matches
 * @returns {Object}
 */
export function processFinalData(myUid, matches) {
  const medalCounts = {};
  let wins = 0;

  // WCS 六维累加器
  let wcsSum = 0;
  const wcsCatSums = {
    battlefield: 0, combat: 0, economy: 0,
    teamwork: 0, strategy: 0, firepower: 0,
  };

  // 风格画像累加器（复用六维类别的相对倍率）
  const styleRatioSums = {
    battlefield: 0, combat: 0, economy: 0,
    teamwork: 0, strategy: 0, firepower: 0,
  };

  const stats = matches.map((m) => {
    const data = m.data.Data;
    const meta = m.data;

    // ---- 队伍推断 ----
    let t1DeltaSum = 0, t1Count = 0, t0DeltaSum = 0, t0Count = 0;
    Object.values(data).forEach((p) => {
      if (p.Name) {
        const d = (p.NewRating || 0) - (p.OldRating || 0);
        if (p.TeamId === 1) { t1DeltaSum += d; t1Count++; }
        else { t0DeltaSum += d; t0Count++; }
      }
    });
    const avgT1 = t1Count > 0 ? t1DeltaSum / t1Count : 0;
    const avgT0 = t0Count > 0 ? t0DeltaSum / t0Count : 0;

    // ---- 整理玩家列表 ----
    const players = Object.entries(data).map(([key, val]) => {
      if (!val.Id) val.Id = key;
      if (val.Name) {
        val.TeamId = val.TeamId === 1 ? 1 : 0;
      } else {
        val.Name = 'Unknown';
        const myDelta = (val.NewRating || 0) - (val.OldRating || 0);
        val.TeamId = Math.abs(myDelta - avgT1) < Math.abs(myDelta - avgT0) ? 1 : (t1Count === 0 && t0Count === 0 ? (myDelta >= 0 ? 1 : 0) : 0);
      }
      return val;
    });

    // ---- 推断胜方 ----
    if (meta.WinnerTeam === undefined) {
      let d0 = 0, d1 = 0;
      players.forEach((p) => {
        if (p.NewRating !== undefined && p.OldRating !== undefined) {
          const d = p.NewRating - p.OldRating;
          if (p.TeamId === 0) d0 += d; else d1 += d;
        }
      });
      meta.WinnerTeam = d0 > d1 ? 0 : 1;
    }

    // ---- 确定我方队伍和胜负 ----
    const myP = players.find((p) => String(p.Id) === String(myUid));
    const myTeamId = myP ? myP.TeamId : (meta.WinnerTeam === 0 ? 1 : 0);
    const isDraw = meta.WinnerTeam === 101;
    const isWin = !isDraw && myTeamId === meta.WinnerTeam;
    if (isWin) wins++;

    // ========================================
    // 计算全场所有玩家的原始指标
    // ========================================
    const teamTotals = {
      0: { dmg: 0, dest: 0, loss: 0, spawn: 0 },
      1: { dmg: 0, dest: 0, loss: 0, spawn: 0 },
    };
    players.forEach((p) => {
      const t = p.TeamId === 1 ? 1 : 0;
      teamTotals[t].dmg += p.DamageDealt || 0;
      teamTotals[t].dest += p.DestructionScore || 0;
      teamTotals[t].loss += p.LossesScore || 0;
      teamTotals[t].spawn += p.TotalSpawnedUnitScore || 0;
    });

    const allMetrics = players.map((p) => {
      const t = p.TeamId === 1 ? 1 : 0;
      const netInv = Math.max((p.TotalSpawnedUnitScore || 0) - (p.TotalRefundedUnitScore || 0), 1);
      const unitStats = extractUnitStats(p.UnitData);

      return {
        id: p.Id,
        teamId: t,

        // --- 战场贡献原始指标 ---
        teamLossShare: safeDivide(p.LossesScore || 0, Math.max(teamTotals[t].loss, 1)),
        teamDmgShare: safeDivide(p.DamageDealt || 0, Math.max(teamTotals[t].dmg, 1)),
        teamDestShare: safeDivide(p.DestructionScore || 0, Math.max(teamTotals[t].dest, 1)),

        // --- 战斗效率原始指标 ---
        dlRatio: p.DLRatio || safeDivide(p.DestructionScore || 0, Math.max(p.LossesScore || 0, 1)),
        survivalRate: Math.max(0, 1 - safeDivide(p.LossesScore || 0, netInv)),
        damageTrade: safeDivide(p.DamageDealt || 0, Math.max(p.DamageReceived || 0, 1)),
        costEfficiency: safeDivide(p.DestructionScore || 0, netInv),
        // 承伤效率 (SHAP v2 交互特征, 排名第7): 承压占比 × 交换比
        tankEfficiency: safeDivide(p.LossesScore || 0, Math.max(teamTotals[t].loss, 1)) *
                        safeDivide(p.DamageDealt || 0, Math.max(p.DamageReceived || 0, 1)),

        // --- 经济管理原始指标 ---
        refundRate: safeDivide(p.TotalRefundedUnitScore || 0, Math.max(p.TotalSpawnedUnitScore || 0, 1)),
        totalRefunded: p.TotalRefundedUnitScore || 0,

        // --- 团队协作原始指标 ---
        uniqueUnits: unitStats.unitTypes.size,
        supplyFromAllies: p.SupplyPointsConsumedFromAllies || 0,
        supplyToAllies: p.SupplyPointsConsumedByAllies || 0,

        // --- 战略目标原始指标 ---
        objectivesCaptured: p.ObjectivesCaptured || 0,
        supplyCaptured: p.SupplyCaptured || 0,
        buildingsDestroyed: unitStats.buildingsDestroyed,

        // --- 火力输出原始指标 ---
        damageDealt: p.DamageDealt || 0,
        destructionScore: p.DestructionScore || 0,
        // 火力性价比 (SHAP v2 交互特征): 每点投入产出多少伤害
        firepowerROI: safeDivide(p.DamageDealt || 0, netInv),

        // --- 展示用 ---
        netInvestment: netInv,
        damageReceived: p.DamageReceived || 0,
        objectivesRaw: p.ObjectivesCaptured || 0,
        supplyGiven: p.SupplyPointsConsumedByAllies || 0,
        unitDiversity: unitStats.unitTypes.size,
        selfDamage: unitStats.selfDamage,
        topD: unitStats.topD,
        topK: unitStats.topK,
        topT: unitStats.topT,
      };
    });

    // ========================================
    // 计算六维类别百分位
    // ========================================
    const pct = (val, key) => percentile(val, allMetrics.map((m) => m[key]));
    const myMetrics = allMetrics.find((m) => String(m.id) === String(myUid));
    const W = CONFIG.WCS_WEIGHTS;

    let matchWcs = 50;
    const myCats = {
      battlefield: 50, combat: 50, economy: 50,
      teamwork: 50, strategy: 50, firepower: 50,
    };

    if (myMetrics) {
      // 战场贡献 = 队内承压占比的均值百分位
      myCats.battlefield = (
        pct(myMetrics.teamLossShare, 'teamLossShare') +
        pct(myMetrics.teamDmgShare, 'teamDmgShare') +
        pct(myMetrics.teamDestShare, 'teamDestShare')
      ) / 3;

      // 战斗效率 = 存活率 + 承伤效率 + 成本效率 + D/L比 + 交换比
      myCats.combat = (
        pct(myMetrics.survivalRate, 'survivalRate') +
        pct(myMetrics.tankEfficiency, 'tankEfficiency') +
        pct(myMetrics.costEfficiency, 'costEfficiency') +
        pct(myMetrics.dlRatio, 'dlRatio') +
        pct(myMetrics.damageTrade, 'damageTrade')
      ) / 5;

      // 经济管理 = 退兵率 + 退款总额
      myCats.economy = (
        pct(myMetrics.refundRate, 'refundRate') +
        pct(myMetrics.totalRefunded, 'totalRefunded')
      ) / 2;

      // 团队协作 = 兵种多样性 + 补给互动
      myCats.teamwork = (
        pct(myMetrics.uniqueUnits, 'uniqueUnits') +
        pct(myMetrics.supplyFromAllies, 'supplyFromAllies') +
        pct(myMetrics.supplyToAllies, 'supplyToAllies')
      ) / 3;

      // 战略目标 = 占点 + 补给 + 建筑
      myCats.strategy = (
        pct(myMetrics.objectivesCaptured, 'objectivesCaptured') +
        pct(myMetrics.supplyCaptured, 'supplyCaptured') +
        pct(myMetrics.buildingsDestroyed, 'buildingsDestroyed')
      ) / 3;

      // 火力输出 = 击毁值 + 火力性价比 + 伤害
      myCats.firepower = (
        pct(myMetrics.destructionScore, 'destructionScore') +
        pct(myMetrics.firepowerROI, 'firepowerROI') +
        pct(myMetrics.damageDealt, 'damageDealt')
      ) / 3;

      const winScore = isWin ? 100 : isDraw ? 50 : 0;

      matchWcs =
        W.battlefield * myCats.battlefield +
        W.combat * myCats.combat +
        W.economy * myCats.economy +
        W.teamwork * myCats.teamwork +
        W.strategy * myCats.strategy +
        W.firepower * myCats.firepower +
        W.winBonus * winScore;

      // 累加到总计
      wcsSum += matchWcs;
      Object.keys(wcsCatSums).forEach((k) => { wcsCatSums[k] += myCats[k]; });

      // ---- 风格倍率计算 (相对于全场均值) ----
      const avg = (key) => allMetrics.reduce((s, m) => s + m[key], 0) / allMetrics.length || 1;

      // 战场贡献倍率 = 你的队内负担占比 vs 全场均值
      styleRatioSums.battlefield += safeDivide(
        (myMetrics.teamLossShare + myMetrics.teamDmgShare + myMetrics.teamDestShare) / 3,
        (allMetrics.reduce((s, m) => s + m.teamLossShare + m.teamDmgShare + m.teamDestShare, 0) / allMetrics.length) / 3,
        1
      );
      styleRatioSums.combat += safeDivide(myMetrics.dlRatio, avg('dlRatio'), 1);
      styleRatioSums.economy += safeDivide(myMetrics.refundRate, avg('refundRate'), 1);
      styleRatioSums.teamwork += safeDivide(myMetrics.uniqueUnits, avg('uniqueUnits'), 1);
      styleRatioSums.strategy += safeDivide(myMetrics.objectivesCaptured, avg('objectivesCaptured'), 1);
      styleRatioSums.firepower += safeDivide(myMetrics.damageDealt, avg('damageDealt'), 1);
    }

    // ========================================
    // 构建每场对局的展示数据
    // ========================================
    const maxK = Math.max(...players.map((p) => p.DestructionScore || 0), 1);
    const maxL = Math.max(...players.map((p) => p.LossesScore || 0), 1);
    const maxO = Math.max(...players.map((p) => p.ObjectivesCaptured || 0), 1);

    const mapPlayer = (p) => {
      const k = p.DestructionScore || 0;
      const l = p.LossesScore || 0;
      const pMetrics = allMetrics.find((m) => String(m.id) === String(p.Id));

      return {
        id: p.Id,
        name: p.Name,
        elo: p.NewRating ? p.NewRating.toFixed(0) : 'N/A',
        gain: p.NewRating && p.OldRating ? (p.NewRating - p.OldRating).toFixed(1) : '0.0',
        kPct: (k / maxK) * 100,
        lPct: (l / maxL) * 100,
        oPct: ((p.ObjectivesCaptured || 0) / maxO) * 100,
        isMe: String(p.Id) === String(myUid),
        score: (k - l) / 1000 + (p.ObjectivesCaptured || 0),
        kScore: k,
        lScore: l,
        oScore: p.ObjectivesCaptured || 0,
        kd: safeDivide(k, l || 1),
        rawData: p,
        medals: [],
        favUnits: pMetrics ? { d: pMetrics.topD, k: pMetrics.topK, t: pMetrics.topT } : { d: { id: 0, v: -1 }, k: { id: 0, v: -1 }, t: { id: 0, v: -1 } },
        selfDamage: pMetrics ? pMetrics.selfDamage : 0,
      };
    };

    const ally = players.filter((p) => p.TeamId === myTeamId).map(mapPlayer).sort((a, b) => b.score - a.score);
    const enemy = players.filter((p) => p.TeamId !== myTeamId).map(mapPlayer).sort((a, b) => b.score - a.score);

    assignMedals(ally);
    assignMedals(enemy);

    const myMapped = ally.find((p) => p.isMe);
    if (myMapped && myMapped.medals) {
      myMapped.medals.forEach((md) => { medalCounts[md.key] = (medalCounts[md.key] || 0) + 1; });
    }

    return {
      id: m.id,
      wcs: matchWcs,
      wcsBreakdown: myCats,
      ally,
      enemy,
      isWin,
      isDraw,
      endReason: meta.EndMatchReason,
      endTime: meta.EndTime,
      mapId: meta.MapId,
      duration: meta.TotalPlayTimeInSec,
      winnerTeam: meta.WinnerTeam,
    };
  });

  // ========================================
  // 汇总：整体 WCS
  // ========================================
  const n = matches.length;
  const wcs = wcsSum / n;
  const wcsBreakdown = {};
  Object.keys(wcsCatSums).forEach((k) => { wcsBreakdown[k] = wcsCatSums[k] / n; });

  // ========================================
  // 汇总：风格画像
  // ========================================
  const playstyle = computePlaystyle(styleRatioSums, n);

  // ========================================
  // 勋章 & 胜率
  // ========================================
  const topMedals = Object.entries(medalCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map((x) => x[0]);

  const level = CONFIG.WCS_LEVELS.find((l) => wcs >= l.min) || CONFIG.WCS_LEVELS[CONFIG.WCS_LEVELS.length - 1];

  return {
    stats,
    wcs,
    wcsBreakdown,
    wcsLevel: level,
    playstyle,
    wins,
    winRate: Math.round((wins / n) * 100),
    topMedals,
  };
}

// ============================================
// 风格画像计算
// ============================================

/**
 * 风格标签定义 (基于六维类别)
 */
const STYLE_LABELS = [
  { keys: ['battlefield', 'combat'], icon: '🗡️', zh: '铁拳突击手', en: 'Iron Fist' },
  { keys: ['combat', 'economy'], icon: '🛡️', zh: '精算指挥官', en: 'Tactician' },
  { keys: ['teamwork', 'battlefield'], icon: '🚑', zh: '团队核心', en: 'Team Core' },
  { keys: ['strategy', 'battlefield'], icon: '🎯', zh: '目标猎手', en: 'Obj Hunter' },
  { keys: ['battlefield', 'firepower'], icon: '💪', zh: '前线压制手', en: 'Frontliner' },
  { keys: ['economy', 'teamwork'], icon: '🔄', zh: '后勤大师', en: 'Logistics' },
  { keys: ['firepower', 'combat'], icon: '🔥', zh: '火力狂人', en: 'Berserker' },
  { keys: ['battlefield'], icon: '⚔️', zh: '战场主宰', en: 'Dominator' },
  { keys: ['combat'], icon: '💎', zh: '效率大师', en: 'Efficient' },
  { keys: ['teamwork'], icon: '🤝', zh: '协作专家', en: 'Collaborator' },
  { keys: ['strategy'], icon: '🏁', zh: '抢点专家', en: 'Point Rush' },
  { keys: ['firepower'], icon: '💥', zh: '重火力', en: 'Heavy Fire' },
  { keys: ['economy'], icon: '💰', zh: '理财大师', en: 'Economist' },
];

/**
 * 计算风格画像
 */
function computePlaystyle(ratioSums, n) {
  const dims = {};
  Object.keys(ratioSums).forEach((k) => {
    const avgRatio = ratioSums[k] / n;
    dims[k] = Math.min(100, Math.round(avgRatio * 50));
  });

  const icons = {
    battlefield: '⚔️', combat: '💎', economy: '💰',
    teamwork: '🤝', strategy: '🏁', firepower: '🔥',
  };

  const dimensions = Object.keys(dims).map((key) => ({
    key,
    value: dims[key],
    icon: icons[key] || '📊',
  }));

  // 确定主风格标签
  const sorted = [...dimensions].sort((a, b) => b.value - a.value);
  const top2Keys = sorted.slice(0, 2).map((d) => d.key);

  let label = STYLE_LABELS.find((sl) => sl.keys.every((k) => top2Keys.includes(k)));
  if (!label) label = STYLE_LABELS.find((sl) => sl.keys.length === 1 && sl.keys[0] === top2Keys[0]);
  if (!label) label = { icon: '📊', zh: '均衡型', en: 'Balanced' };

  return {
    dimensions,
    label: label.zh,
    labelEn: label.en,
    labelIcon: label.icon,
  };
}

// ============================================
// 累计爱用单位 (保持原逻辑)
// ============================================

export function calculateFavoriteUnits(matches, myUid) {
  const unitStats = {};

  matches.forEach((m) => {
    const myData = m.data.Data[myUid];
    if (!myData || !myData.UnitData) return;

    Object.values(myData.UnitData).forEach((unit) => {
      const typeId = unit.Id;
      if (!typeId) return;

      if (!unitStats[typeId]) {
        unitStats[typeId] = { id: typeId, damageDealt: 0, kills: 0, damageReceived: 0 };
      }

      unitStats[typeId].damageDealt += unit.TotalDamageDealt || 0;
      unitStats[typeId].kills += unit.KilledCount || 0;
      unitStats[typeId].damageReceived += unit.TotalDamageReceived || 0;
    });
  });

  const unitsArr = Object.values(unitStats);
  if (unitsArr.length === 0) return null;

  const topDmg = [...unitsArr].sort((a, b) => b.damageDealt - a.damageDealt)[0];
  const topKill = [...unitsArr].sort((a, b) => b.kills - a.kills)[0];
  const topTank = [...unitsArr].sort((a, b) => b.damageReceived - a.damageReceived)[0];

  return { topDmg, topKill, topTank };
}
