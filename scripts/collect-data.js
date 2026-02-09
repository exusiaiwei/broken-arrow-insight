/**
 * WCS 数据采集脚本 v2 - 全量原始数据版
 * 在浏览器控制台中运行，保存每个玩家的所有原始字段
 * 让 Python 端决定用什么特征
 */
(async () => {
  const PLAYER_IDS = [
    '16589',    // SNAPE
    '160368',   // Probe
    '194698',   // 二手导弹车
    '17366',    // 在彼扬水
    '7720',     // NeoBerekov
    '209525',   // Clement
    '203924',   // OvO
  ];

  const { robustFetch } = await import('/src/api/fetcher.js');
  const BASE = 'https://www.barmory.net';

  const allMatches = new Map();
  const seenMatchIds = new Set();

  console.log(`\n🔍 开始采集 ${PLAYER_IDS.length} 个玩家的对局数据 (全量原始版)...\n`);

  for (const pid of PLAYER_IDS) {
    console.log(`📋 玩家 ${pid}: 获取对局列表...`);
    try {
      const matchList = await robustFetch(`${BASE}/stb/commander/${pid}/matches`);
      const matchIds = Array.isArray(matchList)
        ? matchList.slice(0, 20)
        : Object.values(matchList).flat().slice(0, 20);

      console.log(`  找到 ${matchIds.length} 场对局`);

      for (const mId of matchIds) {
        if (seenMatchIds.has(String(mId))) continue;
        seenMatchIds.add(String(mId));

        try {
          const detail = await robustFetch(`${BASE}/stb/match/${mId}`);
          if (!detail || !detail.Data) continue;

          const players = Object.values(detail.Data);
          if (players.length < 10) continue;

          const hasElo = players.some(p => Math.abs((p.NewRating||0) - (p.OldRating||0)) > 0.01);
          if (!hasElo) continue;

          allMatches.set(String(mId), detail);
          console.log(`  ✅ 对局 ${mId} (累计 ${allMatches.size} 场)`);
          await new Promise(r => setTimeout(r, 300));
        } catch (e) {
          console.warn(`  ⚠️ 对局 ${mId} 失败: ${e.message}`);
        }
      }
    } catch (e) {
      console.warn(`⚠️ 玩家 ${pid} 失败: ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n📊 共采集 ${allMatches.size} 场不重复的有效对局`);

  // ===== 提取全量原始数据 =====
  const dataset = [];

  for (const [mId, match] of allMatches) {
    const players = Object.values(match.Data).filter(p => p.Name);
    if (players.length < 10) continue;

    // 推断胜方 — 优先用 ELO delta（可靠），match.WinnerTeam 可能编号不一致
    let d0 = 0, d1 = 0;
    players.forEach(p => {
      const delta = (p.NewRating || 0) - (p.OldRating || 0);
      if (p.TeamId === 0) d0 += delta;
      else d1 += delta;
    });
    // ELO 优先: 哪队总 delta 高就是赢, 仅在无 ELO 数据时回退到 WinnerTeam
    const winnerTeam = (Math.abs(d0) + Math.abs(d1) > 1)
      ? (d0 > d1 ? 0 : 1)
      : (match.WinnerTeam !== undefined ? match.WinnerTeam : 101);

    // 计算全队汇总（用于占比指标）
    const teamTotals = { 0: {dmg: 0, dest: 0, loss: 0, spawn: 0, count: 0},
                         1: {dmg: 0, dest: 0, loss: 0, spawn: 0, count: 0} };
    players.forEach(p => {
      const t = p.TeamId === 1 ? 1 : 0;
      teamTotals[t].dmg += p.DamageDealt || 0;
      teamTotals[t].dest += p.DestructionScore || 0;
      teamTotals[t].loss += p.LossesScore || 0;
      teamTotals[t].spawn += p.TotalSpawnedUnitScore || 0;
      teamTotals[t].count++;
    });

    players.forEach(p => {
      const t = p.TeamId === 1 ? 1 : 0;
      // 用个人 ratingDelta 判断胜负（最可靠）
      const rd = (p.NewRating || 0) - (p.OldRating || 0);
      const isWin = rd > 0.01 ? 1 : (rd < -0.01 ? 0 : ((t === winnerTeam && winnerTeam !== 101) ? 1 : 0));
      const netInv = Math.max((p.TotalSpawnedUnitScore||0) - (p.TotalRefundedUnitScore||0), 1);

      // 单位级统计
      let unitCount = 0, buildingsDestroyed = 0, uniqueUnits = 0;
      if (p.UnitData) {
        const units = Object.values(p.UnitData);
        unitCount = units.reduce((s, u) => s + (u.Destruction || 0), 0);
        buildingsDestroyed = units.reduce((s, u) => s + (u.BuildingDestroyedCount || 0), 0);
        uniqueUnits = units.length;
      }

      dataset.push({
        matchId: mId,
        playerId: p.Id,
        teamId: t,
        isWin,

        // ===== 原始字段（绝对值）=====
        destructionScore: p.DestructionScore || 0,
        lossesScore: p.LossesScore || 0,
        damageDealt: p.DamageDealt || 0,
        damageReceived: p.DamageReceived || 0,
        objectivesCaptured: p.ObjectivesCaptured || 0,
        supplyCaptured: p.SupplyCaptured || 0,
        totalSpawned: p.TotalSpawnedUnitScore || 0,
        totalRefunded: p.TotalRefundedUnitScore || 0,
        supplyConsumed: p.SupplyPointsConsumed || 0,
        supplyFromAllies: p.SupplyPointsConsumedFromAllies || 0,
        supplyToAllies: p.SupplyPointsConsumedByAllies || 0,
        selfDamage: p.TotalSelfDamageDealt || 0,
        buildingsDestroyed,
        unitCount,
        uniqueUnits,
        dlRatio: p.DLRatio || 0,

        // ===== 衍生比率 =====
        netInvestment: netInv,
        costEfficiency: (p.DestructionScore || 0) / netInv,
        damageTrade: (p.DamageDealt || 0) / Math.max(p.DamageReceived || 0, 1),
        survivalRate: Math.max(0, 1 - (p.LossesScore || 0) / netInv),
        refundRate: (p.TotalRefundedUnitScore || 0) / Math.max(p.TotalSpawnedUnitScore || 0, 1),

        // ===== 队内占比 =====
        teamDmgShare: (p.DamageDealt || 0) / Math.max(teamTotals[t].dmg, 1),
        teamDestShare: (p.DestructionScore || 0) / Math.max(teamTotals[t].dest, 1),
        teamLossShare: (p.LossesScore || 0) / Math.max(teamTotals[t].loss, 1),
        teamSpawnShare: (p.TotalSpawnedUnitScore || 0) / Math.max(teamTotals[t].spawn, 1),

        // ===== ELO =====
        oldRating: p.OldRating || 0,
        newRating: p.NewRating || 0,
        ratingDelta: (p.NewRating || 0) - (p.OldRating || 0),
      });
    });
  }

  console.log(`📊 数据集: ${dataset.length} 样本, ${Object.keys(dataset[0]).length} 个字段`);
  console.log(`  胜方: ${dataset.filter(d => d.isWin).length} | 败方: ${dataset.filter(d => !d.isWin).length}`);

  const blob = new Blob([JSON.stringify({ metadata: { collectedAt: new Date().toISOString(), matchCount: allMatches.size, sampleCount: dataset.length }, dataset }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wcs_raw_data.json';
  a.click();

  console.log('\n✅ 全量数据已下载为 wcs_raw_data.json');
})();
