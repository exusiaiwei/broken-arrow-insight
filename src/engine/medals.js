/**
 * 勋章系统
 * 定义 9 种勋章类型，根据队内最高值自动颁发
 */

/** 勋章配置表 */
export const MEDAL_CONFIG = [
  { key: 'Destruction',                   icon: '⚔️', color: 'text-red-400' },
  { key: 'Losses',                        icon: '☠️', color: 'text-gray-400' },
  { key: 'DamageDealt',                   icon: '💥', color: 'text-orange-400' },
  { key: 'DamageReceived',                icon: '🧱', color: 'text-slate-400' },
  { key: 'SupplyPointsConsumed',          icon: '🍔', color: 'text-yellow-400' },
  { key: 'SupplyPointsConsumedFromAllies', icon: '🐱', color: 'text-pink-400' },
  { key: 'SupplyPointsConsumedByAllies',  icon: '🚑', color: 'text-green-400' },
  { key: 'TotalSpawnedUnitScore',         icon: '🛒', color: 'text-blue-400' },
  { key: 'TotalRefundedUnitScore',        icon: '💸', color: 'text-emerald-400' },
];

/**
 * 为一组队友分配勋章（队内各维度最高者获得对应勋章）
 * @param {Array} teamPlayers - mapPlayer 后的玩家数组
 */
export function assignMedals(teamPlayers) {
  MEDAL_CONFIG.forEach((def) => {
    const maxVal = Math.max(...teamPlayers.map((p) => p.rawData[def.key] || 0));
    if (maxVal > 0) {
      teamPlayers.forEach((p) => {
        if ((p.rawData[def.key] || 0) === maxVal) {
          p.medals.push({ ...def, val: maxVal });
        }
      });
    }
  });
}
