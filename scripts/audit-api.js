/**
 * API 数据审计脚本
 * 获取一场真实对局的完整 JSON 结构，分析所有可用字段
 *
 * 使用方法：在浏览器控制台中运行，或作为 Node.js 脚本运行
 * node scripts/audit-api.js
 */

const MATCH_ID = 184523;
const API_URL = `https://batrace.aoeiaol.top/api/v1/stb/match_by_matchid?match_id=${MATCH_ID}`;

async function auditMatchData() {
  console.log(`\n🔍 Fetching match ${MATCH_ID} from batrace API...\n`);

  const resp = await fetch(API_URL);
  if (!resp.ok) {
    console.error(`❌ API returned ${resp.status}. Trying barmory via CORS proxy...`);
    const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(`https://www.barmory.net/stb/match/${MATCH_ID}`)}`;
    const resp2 = await fetch(proxyUrl);
    if (!resp2.ok) throw new Error(`Both APIs failed`);
    var data = await resp2.json();
  } else {
    var data = await resp.json();
  }

  // ===== 顶层字段审计 =====
  console.log('═══════════════════════════════════════');
  console.log('📋 TOP-LEVEL MATCH FIELDS:');
  console.log('═══════════════════════════════════════');

  const topFields = Object.keys(data).filter(k => k !== 'Data');
  topFields.forEach(key => {
    const val = data[key];
    const type = typeof val;
    console.log(`  ${key}: ${type === 'object' ? JSON.stringify(val) : val} (${type})`);
  });

  // ===== 玩家数据审计 =====
  console.log('\n═══════════════════════════════════════');
  console.log('👤 PLAYER FIELDS (per player in Data):');
  console.log('═══════════════════════════════════════');

  const playerEntries = Object.entries(data.Data);
  console.log(`  Total players: ${playerEntries.length}\n`);

  // 取第一个有名字的玩家作为样本
  const samplePlayer = playerEntries.find(([, v]) => v.Name)?.[1] || playerEntries[0]?.[1];

  if (samplePlayer) {
    const playerFields = Object.keys(samplePlayer).filter(k => k !== 'UnitData');
    playerFields.forEach(key => {
      const val = samplePlayer[key];
      const type = typeof val;
      const display = type === 'object' ? JSON.stringify(val).substring(0, 100) : val;
      console.log(`  ${key}: ${display} (${type})`);
    });

    // ===== 单位数据审计 =====
    console.log('\n═══════════════════════════════════════');
    console.log('🎯 UNIT DATA FIELDS (per unit in UnitData):');
    console.log('═══════════════════════════════════════');

    if (samplePlayer.UnitData) {
      const unitEntries = Object.entries(samplePlayer.UnitData);
      console.log(`  Total units for sample player: ${unitEntries.length}\n`);

      // 取第一个单位作为样本
      const sampleUnit = unitEntries[0]?.[1];
      if (sampleUnit) {
        Object.keys(sampleUnit).forEach(key => {
          const val = sampleUnit[key];
          const type = typeof val;
          console.log(`  ${key}: ${val} (${type})`);
        });
      }

      // 显示所有单位的 ID 和基本数据
      console.log('\n  --- All units summary ---');
      unitEntries.forEach(([idx, u]) => {
        console.log(`  [${idx}] ID:${u.Id} Dmg:${u.TotalDamageDealt || 0} Kills:${u.KilledCount || 0} DmgRecv:${u.TotalDamageReceived || 0}`);
      });
    } else {
      console.log('  ⚠️ No UnitData found for sample player');
    }
  }

  // ===== 完整 JSON 输出 =====
  console.log('\n═══════════════════════════════════════');
  console.log('📦 FULL JSON (first player only):');
  console.log('═══════════════════════════════════════');
  console.log(JSON.stringify(samplePlayer, null, 2));

  return data;
}

auditMatchData().catch(e => console.error('❌ Audit failed:', e.message));
