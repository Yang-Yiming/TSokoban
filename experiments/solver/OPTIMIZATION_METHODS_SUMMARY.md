# Sokoban Solver 优化方法汇总（基于当前已阅读资料）

> 目的：把本轮已阅读到的代码与外部资料中的优化方法集中记录，便于在 `F3/V3` 上持续迭代，避免上下文丢失。

## 1. 已阅读的本仓库资料范围

- `experiments/solver/AStarSolverF1.ts`
- `experiments/solver/AStarSolverF2.ts`
- `experiments/solver/AStarSolverV2.ts`
- `experiments/solver/benchmark.ts`
- `experiments/solver/compare.ts`
- `experiments/solver/levels.ts`
- `experiments/solver/README.md`

### 1.1 从现有实现抽取出的已用方法

当前基线（F2/V2）已包含：

1. **Macro-move（只扩展推箱）**
2. **玩家可达区 canonical 化（同可达域合并）**
3. **整数格索引 + 二叉堆 open list**
4. **静态 dead-square（goal 反推 BFS）**
5. **启发式匹配（贪心 box-goal matching）**
   - V2/F1：曼哈顿
   - F2：push-distance（墙约束下更紧）
6. **2×2 deadlock**
7. **Frozen-box deadlock（递归+环保守处理）**
8. **Weighted A*（F1/F2）**

### 1.2 从现有实现识别的主要瓶颈

1. **重复状态去重偏晚**（仅 pop 后 closed 判重，导致 open 膨胀）
2. **后继生成热路径开销高**（每步 map+sort / 全图 2×2 扫描）
3. **启发式每状态重建大量临时结构**（triples + sort）
4. **死锁覆盖面仍有限**（缺 corral / bipartite / closed diagonal）

---

## 2. 已阅读的外部资料（本轮）

> 仅记录本轮已经检索和引用过的资料类别与结论，不新增未读结论。

1. **Sokobano deadlock 页面**
   - 重点：dead square、freeze、corral 等死锁类型与检测思路。
2. **Rolling Stone（Alberta）优化栈说明**
   - 重点：min-matching、transposition table、deadlock tables、relevance cuts 等组合策略。
3. **JSoko deadlock 分类说明**
   - 重点：dead square / freeze / corral / bipartite / closed diagonal 分类。
4. **Assignment problem 资料**
   - 重点：贪心匹配不保证全局最优；若要更紧下界应考虑精确最小费用匹配。

---

## 3. 可实施优化方法总表（按优先级）

> 评级维度：
> - 收益：对 HARD 可解率/超时率改善潜力
> - 复杂度：实现与调试成本
> - 风险：是否可能破坏完备性/正确性

## P0（优先先做，低风险高收益）

1. **Open 阶段 best-g 去重（前置判重）**
   - 思路：维护 `openBestG`，入堆前若 `nextG` 不优则丢弃；pop 时跳过 stale entry。
   - 收益：显著抑制 open 膨胀。
   - 风险：低（实现正确时不影响完备性）。

2. **局部 2×2 检查替代全图扫描**
   - 思路：只检查移动后箱子周围最多 4 个 2×2 子块。
   - 收益：显著降低热路径常数。
   - 风险：低（逻辑等价）。

3. **低分配后继构造（有序替换）**
   - 思路：对 `boxes` 做 remove + binary insert，替代 map+sort。
   - 收益：减少 GC 与 CPU 开销。
   - 风险：低。

4. **移动排序（push ordering）**
   - 思路：优先扩展“进目标区/下降启发值/更靠近目标区”的推法。
   - 收益：在限时场景下更快命中解。
   - 风险：低（只改扩展顺序，不剪枝）。

## P1（中等复杂度，通常高收益）

5. **更强死锁：Corral deadlock**
   - 思路：基于玩家不可达区域，分析区域内箱子是否无法被推出或无法满足目标需求。
   - 收益：对大图和密集箱子关卡通常非常有效。
   - 风险：中（实现细节复杂，需谨防误剪）。

6. **更强死锁：Bipartite deadlock（可达性匹配）**
   - 思路：构建“箱子可达目标”二分图；若无法完美匹配则必死。
   - 收益：对复杂布局很强。
   - 风险：中（计算代价与缓存策略要平衡）。

7. **状态编码优化（Zobrist + collision guard）**
   - 思路：减少字符串 key 构造与内存占用。
   - 收益：中高（时间+内存）。
   - 风险：中（需冲突防护，避免错误合并状态）。

## P2（偏研究性/高复杂度）

8. **精确最小费用匹配启发式（替代贪心匹配）**
   - 思路：Hungarian 或可控规模精确匹配，提升 `h` 紧度。
   - 收益：潜在高（节点减少），但每节点计算更重。
   - 风险：中（性能回退风险，需做缓存与增量）。

9. **增量启发式更新（单箱移动 delta）**
   - 思路：复用父状态匹配信息，仅更新受影响项。
   - 收益：高（理论上），实现难度高。
   - 风险：中高（复杂且易错）。

10. **Relevance cuts / 高级裁剪**
   - 思路：借鉴 Rolling Stone 的问题相关裁剪。
   - 收益：可能很高。
   - 风险：高（若证明不充分，可能丢解）。

---

## 4. 正确性风险分级（重要）

## 安全类（优先）

- openBestG 去重（含 stale skip）
- 局部 2×2
- 低分配后继构造
- 纯 move ordering

## 审慎类（需回归验证）

- corral deadlock
- bipartite deadlock
- zobrist（若无冲突保护则不安全）

## 高风险类（需严格证明）

- 侵略性 relevance cuts
- 任何会直接丢弃“看似不优”但无严格死锁证明的剪枝

---

## 5. 建议的迭代顺序（F3/V3）

1. 先在 `F3` 做：openBestG + stale skip + 局部 2×2 + 低分配后继 + move ordering
2. 再在 `F3` 加：corral deadlock（先保守版，宁可少剪）
3. 视收益加：bipartite deadlock（可缓存）
4. 稳定后把“安全类优化”同步到 `V3`（保持最优搜索语义）

---

## 6. 统一评测协议（避免误判）

1. 固定 `MAX_NODES`、`TIMEOUT_MS`、关卡集（尤其 HARD 全集）
2. 每次只启用一个增量优化做 A/B
3. 记录：
   - solved/limit-reached
   - nodesExpanded
   - timeMs
   - heap Δ
4. 至少重复多轮，使用中位数/分位数，避免单次噪声
5. 若某优化让 EASY/MEDIUM 明显退化，先回滚定位

---

## 7. 当前进展（截至本文件写入时）

已落地到 `F3/V3`：

- openBestG + stale-entry 跳过
- 局部 2×2 检测
- 低分配有序替换
- benchmark/compare 已接入 `F3/V3`

本轮新增（已落地到 `F3`）：

- Push ordering（按优先级排序推法：优先推向目标、优先降低最近 goal push-distance、降低“把箱子从目标上拉走”的优先级）
- 启发式缓存（`boxes.join(',') -> h`），减少重复匹配排序开销
- Bipartite deadlock（安全版）：基于 `pushDist` 的箱子-目标可达性二分匹配；无法完美匹配时直接剪枝（带缓存）
- `boxKey` 复用：在节点中缓存箱子布局字符串，复用于 stateKey/heuristic/bipartite cache，减少重复字符串构造
- 二阶段权重（轻量自适应）：搜索后段自动提升 `weight`（约 60% 预算后升到 1.8，约 82% 后升到 2.1），提高限时场景命中率
- Frozen deadlock 缓存：`boxKey -> frozenDeadlock(bool)`，减少重复递归冻结检测开销
- Corral-lite（保守安全版）：基于 wall-only 静态连通仓室（static chamber）容量约束的死锁剪枝
- Reachability BFS 热路径优化：复用 `Int32Array` 队列，减少 `computeReachable` 频繁分配
- 动态 corral v2（保守安全版，第一版）：基于“下一状态玩家可达域”对不可达区域做容量约束，并要求边界箱体全冻结才剪枝
- 动态 corral v2 门控：仅在“不可达区出现非目标箱且箱子容量超目标容量”等轻量条件满足时才调用完整 corral 检测
- 动态 corral v2 门控调参：仅在搜索中后段触发（约 45% 预算后）且提高阈值（不可达非目标箱至少 3 个）
- 动态 corral v2 门控调参（第 2 轮）：将阈值进一步提高为 `unreachableOffGoalBoxes >= 4`
- 结构门控实验（已回滚）：尝试追加“不可达区规模下限 + 边界箱数量下限”，5 轮中位数显示 HARD2 变差，已撤回

已尝试并回滚：

- 动态 bipartite（把“其他箱子固定为障碍”后做匹配）会误剪可解状态，已确认不安全并已回滚

现状结论：

- HARD 第 1 关：`F3` 相比 `F2` 明显提速（约 `823.79ms -> 382.07ms`，节点 `45255 -> 23335`）
- HARD 第 2 关：15s 预算下仍未解出；加入 bipartite 后 `F3` 约扩展 `327168` 节点（同预算 `F2` 约 `319488`），仍未命中解
- 加入 `boxKey` 复用后（HARD2, 15s），`F3` 约扩展 `340992` 节点，仍未命中解
- 加入二阶段权重后（HARD2, 15s），`F3` 约扩展 `351744` 节点，仍未命中解
- 加入 frozen 缓存后（HARD2, 15s），`F3` 约扩展 `355328` 节点，仍未命中解
- 加入 corral-lite 后（HARD2, 15s），`F3` 约扩展 `346112` 节点，仍未命中解
- 动态 bipartite 方案已回滚后（HARD2, 15s），`F3` 回到稳定区间，约扩展 `342528` 节点
- 加入 reachability 队列复用后（HARD2, 15s），`F3` 约扩展 `360448` 节点，仍未命中解
- 加入动态 corral v2 后（HARD2, 15s），`F3` 约扩展 `309760` 节点，仍未命中解（当前版本开销/剪枝收益比有待优化）
- 加入动态 corral v2 门控后（HARD2, 15s，本轮快照），`F3` 约扩展 `216576` 节点（同轮 `F2` 约 `159232`），保持更深探索但仍未命中解
- 加入门控调参后（HARD2, 15s，本轮快照），`F3` 约扩展 `213504` 节点（同轮 `F2` 约 `142848`），仍保持更深探索但未命中解
- 5 轮中位数评测（HARD 1/2, 15s）：
   - HARD1：`F2` 中位 `45255` 节点 / `1670.26ms`，`F3` 中位 `23335` 节点 / `775.99ms`（均 solved）
   - HARD2：`F2` 中位 `162304` 节点，`F3` 中位 `217600` 节点（均 limit-reached）
- 5 轮中位数评测（阈值 `>=4` 版本，HARD 1/2, 15s）：
   - HARD1：`F2` 中位 `45255` 节点 / `1698.92ms`，`F3` 中位 `23335` 节点 / `811.81ms`（均 solved）
   - HARD2：`F2` 中位 `159744` 节点，`F3` 中位 `216576` 节点（均 limit-reached）
   - 结论：与上一版门控中位数基本持平，`F3` 仍显著深于 `F2`，但尚未突破到 solved
- 5 轮中位数评测（结构门控实验）：
   - HARD1：`F2` 中位 `45255` / `1635.97ms`，`F3` 中位 `23335` / `778.65ms`
   - HARD2：`F2` 中位 `166400`，`F3` 中位 `174592`
   - 结论：相较 `>=4` 阈值基线（`F3` 中位 `216576`）明显退化，已回滚
- 权重扫描（HARD2，15s）：`w=1.7` 扩展量最高（约 `475136`），但在 HARD1 上比 `w=1.5` 更慢（`423ms -> 594ms`）
- 当前默认仍保留 `w=1.5`（整体更稳），后续可按关卡实验性使用更高权重
- 下一步建议：保持 `>=4` 门控基线，转向低风险高收益方向（例如启发式匹配增量更新或局部候选复用）

---

## 8. 后续实现入口建议

- 主实现文件：`experiments/solver/AStarSolverF3.ts`
- 对照实现文件：`experiments/solver/AStarSolverV3.ts`
- 跑分入口：`experiments/solver/benchmark.ts`
- 对比入口：`experiments/solver/compare.ts`

