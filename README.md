# 🎯 Broken Arrow Insight

**断箭战力洞察** — 数据驱动的《断箭》玩家表现分析工具

> 基于 XGBoost + SHAP 的 Win Contribution Score (WCS) 评分系统，提供六维战力画像、风格分析和团队协同效应诊断。

🌐 **在线体验**: [https://exusiaiwei.github.io/broken-arrow-insight/](https://exusiaiwei.github.io/broken-arrow-insight/)

---

## ✨ 功能特性

### 🏆 Win Contribution Score (WCS) — 胜局贡献分
基于机器学习模型，量化每个玩家对胜利的真实贡献度。不是简单看谁杀敌最多，而是分析哪些行为真正帮助赢得比赛。

**六维评分体系**（权重由 SHAP 数据驱动）：

| 维度 | 权重 | 衡量内容 |
|---|---|---|
| ⚔️ 战场贡献 | 29% | 队伍伤害/损失/部署占比 |
| 💎 战斗效率 | 18% | 存活率、费效比、交换比 |
| 🔥 火力输出 | 11% | 绝对伤害和摧毁值 |
| 💰 经济管理 | 11% | 资源投入产出、退款率 |
| 🤝 团队协作 | 10% | 兵种多样性、补给互助 |
| 🏁 战略目标 | 6% | 占点、建筑摧毁、物资控制 |
| 🎯 胜负修正 | 15% | 赢了额外加分 |

### 🎭 风格画像 (Playstyle Profile)
基于六维得分的雷达图，自动识别你的作战风格：
- **全能型** — 各项均衡
- **铁壁型** — 擅长防守/承伤
- **战术大师** — 注重目标和经济
- **火力狂人** — 输出为王
- 等 6 种风格...

### 🤝 团队协同分析 (Team Effect)
量化队友之间的化学反应：
- **配对效应** — 你和每个队友同队时胜率变化
- **多人组合** — 3-6 人阵容的协同效应
- **个人影响** — 你加入后队友赢更多还是更少
- **蛆指数排名** — 谁对团队贡献最大/拖累最大

---

## 🧬 技术架构

### 数据流
```
Barmory API → 原始对局数据 → 百分位归一化 → WCS 六维评分 → 用户界面
                               ↓
                    XGBoost 模型 → SHAP 分析 → 数据驱动权重
```

### 权重发现流程
1. **数据采集**: `scripts/collect-data.js` 从 Barmory API 收集对局数据
2. **特征工程**: 23 个原始特征 + 衍生比率 + 队内占比
3. **模型训练**: XGBoost 二分类（胜/败）
4. **SHAP 分析**: 计算每个特征对胜利的边际贡献
5. **分类聚合**: 将 SHAP 值按 6 个语义类别加权
6. **权重配置**: 归一化后写入 `src/config.js`

### 关键 bug 修复
在数据清洗中发现并修复了一个关键问题：API 的 `match.WinnerTeam` 字段与 `TeamId` 编号体系不一致，导致 **34% 的胜负标签被反转**。修复方法：改用个人 `ratingDelta` 正负判断胜负。

---

## 📁 项目结构

```
broken-arrow-insight/
├── index.html              # 主页面
├── src/
│   ├── main.js             # 入口
│   ├── config.js            # WCS 权重配置
│   ├── api/
│   │   └── fetcher.js       # API 调用（含 CORS 代理）
│   ├── engine/
│   │   └── analyzer.js      # WCS 计算 + 风格分析
│   ├── ui/
│   │   └── renderer.js      # 界面渲染
│   ├── i18n/                # 多语言 (en/zh/ru/ja)
│   └── styles/
│       └── main.css          # 样式
├── scripts/
│   ├── collect-data.js        # 数据采集（浏览器控制台运行）
│   ├── regress_weights.py     # XGBoost + SHAP 权重分析
│   ├── team_effect.py         # 团队协同效应分析
│   └── wcs_raw_data.json      # 原始训练数据
└── .github/workflows/
    └── deploy.yml             # GitHub Pages 自动部署
```

---

## 🚀 使用方法

### 在线使用
访问 [https://exusiaiwei.github.io/broken-arrow-insight/](https://exusiaiwei.github.io/broken-arrow-insight/)，输入你的 Steam64 ID 或游戏内数字 ID 即可。

### 本地开发
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### 运行数据分析脚本
```bash
# 需要 pixi 环境 (Python 3.10+)
pixi install

# 重新训练 WCS 权重
pixi run python scripts/regress_weights.py

# 运行团队效应分析
pixi run python scripts/team_effect.py
```

---

## 📊 WCS 分析方法论

### 为什么不用手动权重？
早期版本使用人工设定的权重，导致反直觉的结果（例如输了的玩家得高分）。v5.0 改用数据驱动方法：

1. **XGBoost** 学习"什么特征组合预测胜利"
2. **SHAP** 解释"每个特征对预测结果的贡献"
3. 将 23 个特征的 SHAP 贡献聚合到 6 个语义维度

### "50 分"的含义
每局比赛中所有 10 名玩家的数据做百分位归一化：
- **50 分** = 这场比赛的中位数表现
- **80+ 分** = 前 20%，传说级表现
- **< 35 分** = 后 35%，表现不佳

### 胜负修正 (winBonus)
赢了的玩家获得额外 15% 权重加分，避免"赢了比赛但 WCS 低"的尴尬情况。

---

## 🌍 多语言支持

- 🇨🇳 中文
- 🇬🇧 English
- 🇷🇺 Русский
- 🇯🇵 日本語

---

## 📄 License

MIT

---

## 🙏 致谢

- [Barmory.net](https://barmory.net/) — 对局数据 API
- [BATRace](https://batrace.aoeiaol.top/) — 玩家搜索 API
- [SHAP](https://github.com/shap/shap) — 可解释 AI 框架
- [XGBoost](https://xgboost.readthedocs.io/) — 梯度提升模型
