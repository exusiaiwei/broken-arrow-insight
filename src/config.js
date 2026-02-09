/**
 * 全局配置
 */
export const CONFIG = {
  // ===== 基础设置 =====
  MATCH_GOAL: 12,
  MIN_PLAYERS: 10,

  // ===== API 端点 =====
  BATRACE_BASE: 'https://batrace.aoeiaol.top/api/v1',
  BARMORY_BASE: 'https://www.barmory.net',

  // ===== CORS 代理池 =====
  PROXIES: [
    { name: 'Codetabs',   url: (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}` },
    { name: 'CorsProxy',  url: (u) => `https://corsproxy.io/?${encodeURIComponent(u)}` },
    { name: 'AllOrigins', url: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}&cb=${Date.now()}` },
  ],

  // ===== WCS (Win Contribution Score) 权重 =====
  // 基于 XGBoost + SHAP 分析 (53场/530样本, 修正 isWin bug 后)
  WCS_WEIGHTS: {
    battlefield:  0.29,   // 战场贡献 (teamLossShare, teamDmgShare 等)
    combat:       0.18,   // 战斗效率 (dlRatio, survivalRate, damageTrade)
    firepower:    0.11,   // 火力输出 (damageDealt, destructionScore)
    economy:      0.11,   // 经济管理 (netInvestment, refundRate 等)
    teamwork:     0.10,   // 团队协作 (uniqueUnits, supply 互助)
    strategy:     0.06,   // 战略目标 (占点+补给+建筑)
    winBonus:     0.15,   // 胜负修正
  },

  // ===== WCS 等级定义 =====
  WCS_LEVELS: [
    { min: 80, key: 'legendary' },
    { min: 65, key: 'elite' },
    { min: 50, key: 'good' },
    { min: 35, key: 'average' },
    { min: 20, key: 'below' },
    { min: 0,  key: 'poor' },
  ],

  // ===== 旧版排名权重 (保留兼容) =====
  RANK_WEIGHTS: {
    impact: 0.40,
    obj:    0.10,
    loss:   0.15,
    tank:   0.35,
  },

  // ===== 本地存储键名 =====
  LS_UNIT_CACHE_KEY: 'ba_unit_cache',
  LS_UNIT_CACHE_TS: 'ba_unit_cache_ts',
  LS_HISTORY_KEY: 'ba_history',
};
