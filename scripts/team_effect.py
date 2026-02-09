"""
Team Effect 分析
计算每个玩家的"团队增幅/拖累效应"

方法：
1. 对于目标玩家组（你们 6 人），找出每个人出现的所有对局
2. 计算每个人的基准胜率
3. 对于每对组合 (A, B)，计算同队时的实际胜率
4. Team Effect(A→B) = B在A队时的胜率 - B单独胜率
5. 正值 = A 让 B 赢更多（增幅），负值 = A 让 B 赢更少（拖累）

使用: pixi run python scripts/team_effect.py
"""
import json
import sys
import unicodedata
from pathlib import Path
from collections import defaultdict
from itertools import combinations

def cjk_ljust(s, width):
    """CJK-aware ljust: 中文字符占 2 列宽度"""
    display_width = sum(2 if unicodedata.east_asian_width(c) in ('F', 'W') else 1 for c in s)
    return s + ' ' * max(0, width - display_width)

def main():
    # 特别关注的玩家列表（从 collect-data.js 中提取）
    TRACKED_PLAYERS = {
        '17366': '在彼扬水',
        '16589': 'SNAPE·α·LSP',
        '160368': 'Probe',
        '209525': 'Clément',
        '7720': 'NeoBerekov',
        '194698': '二手导弹车',
    }

    data_path = 'scripts/wcs_raw_data.json'
    for p in [data_path, 'wcs_raw_data.json', '../wcs_raw_data.json']:
        if Path(p).exists():
            data_path = p
            break

    with open(data_path, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    dataset = raw['dataset']

    # ===== 修正 isWin bug =====
    # collect-data.js 中 match.WinnerTeam 和 TeamId 编号规则不一致
    # 导致部分比赛胜负反转，改用 ratingDelta 正负判断（正=赢，负=输）
    fixed_count = 0
    for d in dataset:
        correct_win = 1 if d.get('ratingDelta', 0) > 0 else 0
        if d['isWin'] != correct_win:
            fixed_count += 1
            d['isWin'] = correct_win

    # ===== 构建对局结构 =====
    # matchId -> [{playerId, teamId, isWin}]
    matches = defaultdict(list)
    for d in dataset:
        matches[d['matchId']].append({
            'playerId': str(d['playerId']),
            'teamId': d['teamId'],
            'isWin': d['isWin'],
        })

    print(f"\n{'='*70}")
    print(f"🤝 Team Effect 分析")
    print(f"{'='*70}")
    print(f"  对局数: {len(matches)}  |  数据行: {len(dataset)}")
    print(f"  ⚠️ 修正了 {fixed_count} 条 isWin 错误 (基于 ratingDelta)")

    # ===== 对每个被追踪玩家收集数据 =====
    # player_matches[pid] = [(matchId, teamId, isWin)]
    player_matches = defaultdict(list)
    for mid, players in matches.items():
        for p in players:
            if p['playerId'] in TRACKED_PLAYERS:
                player_matches[p['playerId']].append((mid, p['teamId'], p['isWin']))

    print(f"\n  追踪玩家:")
    for pid, name in TRACKED_PLAYERS.items():
        ms = player_matches[pid]
        wins = sum(1 for _, _, w in ms if w)
        wr = wins / len(ms) * 100 if ms else 0
        print(f"    {cjk_ljust(name, 16)}: {len(ms):3d} 局, 胜率 {wr:.1f}%")

    # ===== 计算配对效应 =====
    print(f"\n{'='*70}")
    print(f"📊 配对分析：同队时的胜率变化")
    print(f"{'='*70}")

    # 对于每对 (A, B)，找出他们同队的对局
    pair_results = {}
    tracked_ids = list(TRACKED_PLAYERS.keys())

    for id_a, id_b in combinations(tracked_ids, 2):
        name_a = TRACKED_PLAYERS[id_a]
        name_b = TRACKED_PLAYERS[id_b]

        # A 的基准胜率
        a_matches = player_matches[id_a]
        a_wins = sum(1 for _, _, w in a_matches if w)
        a_wr = a_wins / len(a_matches) if a_matches else 0.5

        # B 的基准胜率
        b_matches = player_matches[id_b]
        b_wins = sum(1 for _, _, w in b_matches if w)
        b_wr = b_wins / len(b_matches) if b_matches else 0.5

        # 找同队对局
        a_match_dict = {mid: (tid, w) for mid, tid, w in a_matches}
        together_wins = 0
        together_total = 0
        for mid, tid_b, win_b in b_matches:
            if mid in a_match_dict:
                tid_a, win_a = a_match_dict[mid]
                if tid_a == tid_b:  # 同队
                    together_total += 1
                    if win_a:  # 同队时的胜负
                        together_wins += 1

        if together_total < 2:
            continue

        together_wr = together_wins / together_total
        expected_wr = (a_wr + b_wr) / 2  # 简单期望
        effect = together_wr - expected_wr

        pair_results[(id_a, id_b)] = {
            'name_a': name_a,
            'name_b': name_b,
            'together': together_total,
            'wins': together_wins,
            'wr': together_wr,
            'a_wr': a_wr,
            'b_wr': b_wr,
            'expected': expected_wr,
            'effect': effect,
        }

    # 排序: 正面效应 → 负面效应
    sorted_pairs = sorted(pair_results.values(), key=lambda x: -x['effect'])

    print(f"\n  配对                       同队局  实际胜率  期望胜率    效应")
    print(f"  {'-'*62}")
    for r in sorted_pairs:
        effect_icon = '🟢' if r['effect'] > 0.05 else ('🔴' if r['effect'] < -0.05 else '⚪')
        pair_str = f"{r['name_a']} + {r['name_b']}"
        print(f"  {effect_icon} {cjk_ljust(pair_str, 24)} "
              f"{r['together']:3d}局  "
              f"{r['wr']*100:5.1f}%  "
              f"{r['expected']*100:5.1f}%  "
              f"{r['effect']*100:+5.1f}%")

    # ===== 个人对团队的影响（正确视角：X 加入后队友赢更多还是更少）=====
    print(f"\n{'='*70}")
    print(f"👤 个人对团队的影响 (X 加入后，队友的胜率变化)")
    print(f"{'='*70}")
    print(f"  含义：当 X 在队友的队伍里时 vs 不在时，队友赢得更多还是更少？")
    print(f"  ✅=双方≥8局  ⚠️=某方<5局\n")

    for pid in tracked_ids:
        name = TRACKED_PLAYERS[pid]
        impacts = []

        for other_id in tracked_ids:
            if other_id == pid:
                continue
            other_name = TRACKED_PLAYERS[other_id]
            other_ms = player_matches[other_id]  # 队友的所有对局
            my_ms = player_matches[pid]

            # 以队友的视角：队友的对局中，我有没有在他队里
            my_match_team = {mid: tid for mid, tid, w in my_ms}
            with_wins, with_total = 0, 0
            without_wins, without_total = 0, 0

            for mid, tid, w in other_ms:
                if mid in my_match_team and my_match_team[mid] == tid:
                    # 我和队友同队
                    with_total += 1
                    if w: with_wins += 1
                else:
                    # 我不在队友这边
                    without_total += 1
                    if w: without_wins += 1

            if with_total >= 2 and without_total >= 2:
                with_wr = with_wins / with_total
                without_wr = without_wins / without_total
                delta = with_wr - without_wr
                # 置信度
                if with_total >= 8 and without_total >= 8:
                    conf = '✅'
                elif with_total < 5 or without_total < 5:
                    conf = '⚠️'
                else:
                    conf = '  '
                impacts.append((other_name, with_total, with_wr, without_total, without_wr, delta, conf))

        if impacts:
            impacts.sort(key=lambda x: -x[5])
            avg_impact = sum(d for _, _, _, _, _, d, _ in impacts) / len(impacts)
            impact_icon = '⬆️' if avg_impact > 0.03 else ('⬇️' if avg_impact < -0.03 else '➡️')
            print(f"\n  📌 {name} 对队友的影响 (平均 {avg_impact*100:+.1f}% {impact_icon})")
            for other_name, n_with, wr_with, n_without, wr_without, delta, conf in impacts:
                icon = '⬆️' if delta > 0.05 else ('⬇️' if delta < -0.05 else '➡️')
                print(f"  {conf} {icon} {cjk_ljust(other_name, 14)} "
                      f"有我: {wr_with*100:5.1f}% ({n_with}局) | "
                      f"没我: {wr_without*100:5.1f}% ({n_without}局) | "
                      f"影响: {delta*100:+5.1f}%")

    # ===== "蛆指数" — 团队拖累排名 =====
    print(f"\n{'='*70}")
    print(f"🐛 蛆指数 — 谁拖累团队最多？")
    print(f"{'='*70}")

    maggot_scores = []
    for pid in tracked_ids:
        name = TRACKED_PLAYERS[pid]
        # 收集所有队友跟此人同队时的效应
        total_effect = 0
        count = 0
        for other_id in tracked_ids:
            if other_id == pid:
                continue
            # 用其他人的视角看此人的效应
            key1 = (pid, other_id)
            key2 = (other_id, pid)
            r = pair_results.get(key1) or pair_results.get(key2)
            if r:
                total_effect += r['effect']
                count += 1

        avg_effect = total_effect / count if count > 0 else 0
        base_ms = player_matches[pid]
        base_wr = sum(1 for _, _, w in base_ms if w) / len(base_ms) if base_ms else 0.5
        maggot_scores.append((name, avg_effect, base_wr, len(base_ms)))

    maggot_scores.sort(key=lambda x: x[1])  # 最拖累的在前

    print(f"\n  排名  玩家              平均效应   个人胜率   局数   评语")
    print(f"  {'-'*66}")
    for i, (name, effect, wr, n) in enumerate(maggot_scores):
        rank = i + 1
        if effect >= 0.05:
            comment = '✨ 团队增幅者'
        elif effect >= -0.03:
            comment = '📊 中性影响'
        elif effect >= -0.1:
            comment = '⚠️ 轻度拖累'
        else:
            comment = '🐛 蛆'
        print(f"  {rank:3d}. {cjk_ljust(name, 16)}  {effect*100:+6.1f}%    {wr*100:5.1f}%   {n:3d}局  {comment}")

    # ===== 多人组合协同分析 =====
    print(f"\n{'='*70}")
    print(f"🧩 多人组合协同分析 (3~6人)")
    print(f"{'='*70}")
    print(f"  协同效应 = 实际胜率 - 成员平均个人胜率")
    print(f"  正值 = 化学反应好, 负值 = 互相拖累\n")

    # 预计算每个人的个人胜率
    individual_wr = {}
    for pid in tracked_ids:
        ms = player_matches[pid]
        if ms:
            individual_wr[pid] = sum(1 for _, _, w in ms if w) / len(ms)
        else:
            individual_wr[pid] = 0.5

    # 构建 match -> {pid: (teamId, isWin)} 快速查找
    match_player_map = defaultdict(dict)
    for pid in tracked_ids:
        for mid, tid, w in player_matches[pid]:
            match_player_map[mid][pid] = (tid, w)

    combo_results = []

    for size in range(3, len(tracked_ids) + 1):
        for combo in combinations(tracked_ids, size):
            # 找出这个组合全部同队的对局
            combo_set = set(combo)
            together_wins = 0
            together_total = 0

            for mid, players_in_match in match_player_map.items():
                # 检查组合中所有人是否都在这场比赛
                if not combo_set.issubset(players_in_match.keys()):
                    continue
                # 检查是否同队
                teams = {players_in_match[pid][0] for pid in combo}
                if len(teams) != 1:
                    continue  # 不同队
                # 同队！
                together_total += 1
                # 用第一个人的胜负代表全队（同队同输赢）
                first_pid = combo[0]
                if players_in_match[first_pid][1]:
                    together_wins += 1

            if together_total < 3:
                continue

            actual_wr = together_wins / together_total
            expected_wr = sum(individual_wr[pid] for pid in combo) / len(combo)
            synergy = actual_wr - expected_wr
            names = [TRACKED_PLAYERS[pid] for pid in combo]

            combo_results.append({
                'size': size,
                'names': names,
                'label': ' + '.join(n[:4] for n in names),  # 简称
                'total': together_total,
                'wins': together_wins,
                'wr': actual_wr,
                'expected': expected_wr,
                'synergy': synergy,
            })

    # 按 size 分组展示
    for size in range(3, len(tracked_ids) + 1):
        combos = [c for c in combo_results if c['size'] == size]
        if not combos:
            continue
        combos.sort(key=lambda x: -x['synergy'])

        print(f"  ── {size}人组合 ──")
        for c in combos:
            icon = '🟢' if c['synergy'] > 0.05 else ('🔴' if c['synergy'] < -0.05 else '⚪')
            name_str = ' + '.join(c['names'])
            print(f"  {icon} {cjk_ljust(name_str, 38)} "
                  f"{c['total']:2d}局  "
                  f"胜率:{c['wr']*100:5.1f}%  "
                  f"期望:{c['expected']*100:5.1f}%  "
                  f"协同:{c['synergy']*100:+5.1f}%")
        print()

    # ===== 最佳/最差阵容 =====
    if combo_results:
        best = max(combo_results, key=lambda x: x['synergy'])
        worst = min(combo_results, key=lambda x: x['synergy'])
        highest_wr = max(combo_results, key=lambda x: x['wr'])

        print(f"  {'─'*50}")
        print(f"  🏆 最佳化学反应: {' + '.join(best['names'])}")
        print(f"     胜率 {best['wr']*100:.1f}% ({best['total']}局), 协同 {best['synergy']*100:+.1f}%")
        print(f"  💀 最差化学反应: {' + '.join(worst['names'])}")
        print(f"     胜率 {worst['wr']*100:.1f}% ({worst['total']}局), 协同 {worst['synergy']*100:+.1f}%")
        print(f"  👑 最高胜率阵容: {' + '.join(highest_wr['names'])}")
        print(f"     胜率 {highest_wr['wr']*100:.1f}% ({highest_wr['total']}局)")

    # ===== 输出 JSON =====
    result = {
        'pairs': [{
            'pair': f"{r['name_a']} + {r['name_b']}",
            'together_matches': r['together'],
            'actual_wr': round(r['wr'] * 100, 1),
            'expected_wr': round(r['expected'] * 100, 1),
            'effect': round(r['effect'] * 100, 1),
        } for r in sorted_pairs],
        'combos': [{
            'players': c['names'],
            'size': c['size'],
            'matches': c['total'],
            'win_rate': round(c['wr'] * 100, 1),
            'expected_wr': round(c['expected'] * 100, 1),
            'synergy': round(c['synergy'] * 100, 1),
        } for c in combo_results],
        'maggot_ranking': [{
            'name': name,
            'avg_team_effect': round(effect * 100, 1),
            'personal_wr': round(wr * 100, 1),
            'matches': n,
        } for name, effect, wr, n in maggot_scores],
    }

    out_path = Path(data_path).parent / 'team_effect.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"\n✅ 结果已保存到 {out_path}")

if __name__ == '__main__':
    main()
