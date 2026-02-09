"""
WCS v3 - SHAP + XGBoost 版本
用 XGBoost 预测胜负，SHAP 解释每个特征的贡献
最终输出：分类别的 SHAP 权重 + 可直接写入 config.js 的配置

使用: pixi run regress  (或 python scripts/regress_weights.py wcs_raw_data.json)
"""
import json
import sys
import numpy as np
from pathlib import Path
from collections import defaultdict

def main():
    # ===== 加载数据 =====
    data_path = sys.argv[1] if len(sys.argv) > 1 else 'wcs_raw_data.json'
    for p in [data_path, f'scripts/{data_path}', f'../{data_path}']:
        if Path(p).exists():
            data_path = p
            break

    with open(data_path, 'r', encoding='utf-8') as f:
        raw = json.load(f)

    dataset = raw['dataset']

    # ===== 修正 isWin bug =====
    # collect-data.js 中 match.WinnerTeam 编号可能与 TeamId 不一致
    # 用 ratingDelta > 0 = 赢 来覆盖原始 isWin
    fixed = 0
    for d in dataset:
        correct = 1 if d.get('ratingDelta', 0) > 0 else 0
        if d['isWin'] != correct:
            fixed += 1
            d['isWin'] = correct

    # 特征定义（排除标签和非特征字段）
    exclude = {'matchId', 'playerId', 'teamId', 'isWin',
               'oldRating', 'newRating', 'ratingDelta'}
    feature_names = [k for k in dataset[0].keys() if k not in exclude]

    X_raw = np.array([[d[f] for f in feature_names] for d in dataset])
    y = np.array([d['isWin'] for d in dataset])

    print(f"\n{'='*70}")
    print(f"📊 WCS v3 — SHAP + XGBoost 分析")
    print(f"{'='*70}")
    print(f"  样本: {len(dataset)}  |  对局: {raw['metadata']['matchCount']}")
    print(f"  特征: {len(feature_names)}  |  胜/败: {y.sum()}/{len(y)-y.sum()}")

    # ===== 按 matchId 做百分位化 =====
    match_groups = defaultdict(list)
    for i, d in enumerate(dataset):
        match_groups[d['matchId']].append(i)

    X_pct = np.zeros_like(X_raw, dtype=np.float64)
    for indices in match_groups.values():
        for fi in range(len(feature_names)):
            vals = X_raw[indices, fi]
            for idx in indices:
                v = X_raw[idx, fi]
                below = np.sum(vals < v)
                equal = np.sum(vals == v)
                X_pct[idx, fi] = (below + equal * 0.5) / len(vals)

    # 过滤零方差特征
    valid = np.std(X_pct, axis=0) > 1e-8
    removed = [f for f, v in zip(feature_names, valid) if not v]
    if removed:
        print(f"  ⚠️ 移除零方差: {', '.join(removed)}")
    feature_names = [f for f, v in zip(feature_names, valid) if v]
    X_pct = X_pct[:, valid]

    # ===== XGBoost 训练 =====
    from xgboost import XGBClassifier
    from sklearn.model_selection import cross_val_score

    model = XGBClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        random_state=42,
        use_label_encoder=False,
        eval_metric='logloss',
    )

    cv_scores = cross_val_score(model, X_pct, y, cv=5, scoring='accuracy')
    print(f"\n  XGBoost 5-fold CV: {cv_scores.mean():.4f} (±{cv_scores.std():.4f})")

    model.fit(X_pct, y)

    # ===== SHAP 分析 =====
    import shap
    print(f"\n  计算 SHAP 值中...")

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_pct)

    # shap_values 形状: (n_samples, n_features)
    # 正值 = 倾向胜利, 负值 = 倾向失败

    # ===== 全局特征重要性（平均 |SHAP|）=====
    mean_abs_shap = np.mean(np.abs(shap_values), axis=0)
    mean_shap = np.mean(shap_values, axis=0)  # 带方向的平均

    print(f"\n{'='*70}")
    print(f"🔫 全局 SHAP 特征重要性 (mean |SHAP|)")
    print(f"{'='*70}")

    importance = sorted(zip(feature_names, mean_abs_shap, mean_shap),
                       key=lambda x: -x[1])
    for fname, imp, direction in importance:
        bar = "█" * int(imp * 80)
        sign = "↑" if direction > 0 else "↓"
        print(f"  {sign} {fname:22s}: {imp:.4f}  {bar}")

    # ===== 分类别汇总 =====
    CATEGORIES = {
        '经济管理': ['totalSpawned', 'totalRefunded', 'refundRate', 'netInvestment',
                   'supplyConsumed'],
        '战斗效率': ['costEfficiency', 'damageTrade', 'dlRatio', 'survivalRate'],
        '火力输出': ['damageDealt', 'destructionScore', 'damageReceived'],
        '战场贡献': ['lossesScore', 'teamLossShare', 'teamDmgShare',
                   'teamDestShare', 'teamSpawnShare'],
        '战略目标': ['objectivesCaptured', 'supplyCaptured', 'buildingsDestroyed'],
        '团队协作': ['supplyFromAllies', 'supplyToAllies', 'uniqueUnits', 'unitCount'],
    }

    # 建立 feature_name -> index 映射
    fname_to_idx = {f: i for i, f in enumerate(feature_names)}

    print(f"\n{'='*70}")
    print(f"📊 分类别 SHAP 贡献 (用于雷达图)")
    print(f"{'='*70}")

    category_importance = {}
    for cat, features in CATEGORIES.items():
        cat_shap = 0
        cat_features = []
        for f in features:
            if f in fname_to_idx:
                idx = fname_to_idx[f]
                cat_shap += mean_abs_shap[idx]
                cat_features.append((f, mean_abs_shap[idx], mean_shap[idx]))
        category_importance[cat] = {
            'total': cat_shap,
            'features': cat_features,
        }

    # 归一化为百分比
    total_imp = sum(v['total'] for v in category_importance.values())
    print()
    for cat in sorted(category_importance, key=lambda c: -category_importance[c]['total']):
        info = category_importance[cat]
        pct = info['total'] / total_imp * 100 if total_imp > 0 else 0
        bar = "█" * int(pct * 0.6)
        print(f"  {cat:10s}: {pct:5.1f}%  {bar}")
        for f, imp, direction in sorted(info['features'], key=lambda x: -x[1]):
            sign = "+" if direction > 0 else "-"
            print(f"    {sign} {f:20s}: {imp:.4f}")

    # ===== 胜方 vs 败方的 SHAP 对比 =====
    print(f"\n{'='*70}")
    print(f"🏆 胜方 vs 败方的平均 SHAP 值")
    print(f"{'='*70}")

    win_mask = y == 1
    lose_mask = y == 0
    win_shap = np.mean(shap_values[win_mask], axis=0)
    lose_shap = np.mean(shap_values[lose_mask], axis=0)

    diffs = sorted(zip(feature_names, win_shap, lose_shap),
                  key=lambda x: -(x[1] - x[2]))
    print(f"\n  {'特征':22s}  {'胜方':>8s}  {'败方':>8s}  {'差异':>8s}")
    print(f"  {'-'*52}")
    for fname, w, l in diffs:
        diff = w - l
        indicator = "⬆️" if diff > 0.01 else ("⬇️" if diff < -0.01 else "  ")
        print(f"  {fname:22s}  {w:+.4f}  {l:+.4f}  {diff:+.4f} {indicator}")

    # ===== 生成 WCS 配置权重 =====
    print(f"\n{'='*70}")
    print(f"📋 WCS 配置建议 (基于 SHAP 分类别权重)")
    print(f"{'='*70}")

    # 正向类别 = SHAP mean > 0 的特征的重要性
    wcs_dims = {}
    for cat, info in category_importance.items():
        wcs_dims[cat] = info['total'] / total_imp if total_imp > 0 else 0

    print(f"\n  WCS 维度权重 (归一化, 留 15% 给 winBonus):")
    for cat in sorted(wcs_dims, key=lambda c: -wcs_dims[c]):
        w = wcs_dims[cat] * 0.85
        print(f"    {cat:12s}: {w:.4f}")
    print(f"    {'winBonus':12s}: 0.1500")

    # ===== SHAP 交互效应 (top 交互对) =====
    print(f"\n{'='*70}")
    print(f"🔗 SHAP 特征交互分析 (Top 10)")
    print(f"{'='*70}")

    # 使用特征重要性的协方差近似交互
    shap_cov = np.abs(np.corrcoef(shap_values.T))
    interactions = []
    for i in range(len(feature_names)):
        for j in range(i+1, len(feature_names)):
            interactions.append((feature_names[i], feature_names[j], shap_cov[i, j]))
    interactions.sort(key=lambda x: -x[2])

    print()
    for f1, f2, strength in interactions[:10]:
        bar = "█" * int(strength * 30)
        print(f"  {f1:20s} × {f2:20s}: {strength:.3f}  {bar}")

    # ===== 保存结果 =====
    result = {
        'method': 'XGBoost + SHAP',
        'cv_accuracy': float(cv_scores.mean()),
        'cv_std': float(cv_scores.std()),
        'global_shap_importance': {f: float(v) for f, v in zip(feature_names, mean_abs_shap)},
        'global_shap_direction': {f: float(v) for f, v in zip(feature_names, mean_shap)},
        'category_weights': {cat: float(info['total'] / total_imp) for cat, info in category_importance.items()},
        'win_vs_lose_shap': {
            f: {'win': float(w), 'lose': float(l), 'diff': float(w-l)}
            for f, w, l in diffs
        },
        'sample_count': len(dataset),
        'match_count': raw['metadata']['matchCount'],
    }

    out_path = Path(data_path).parent / 'wcs_shap_analysis.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    print(f"\n✅ 分析结果已保存到 {out_path}")

    # ===== SHAP Summary Plot =====
    try:
        print(f"\n📊 正在生成 SHAP Summary Plot...")
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(12, 8))
        shap.summary_plot(shap_values, X_pct, feature_names=feature_names,
                         show=False, max_display=20)
        plot_path = Path(data_path).parent / 'shap_summary.png'
        plt.tight_layout()
        plt.savefig(plot_path, dpi=150, bbox_inches='tight')
        plt.close()
        print(f"  📈 SHAP 图已保存到 {plot_path}")
    except Exception as e:
        print(f"  ⚠️ 图表生成失败 (可选): {e}")

if __name__ == '__main__':
    main()
