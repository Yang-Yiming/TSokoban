# TSokoban 特殊关卡库与特殊建筑计划（V2）

## 1. 目标

本计划聚焦以下结果：

1) 保持主线关卡加载方式不变（现有 MAP_DATA 线性索引不改）。
2) 将 experiments/solver/levels.ts 中的 MEDIUM/HARD 关卡接入为“特殊关卡库”，而不是批量主线序列。
3) 新增可扩展的特殊建筑系统，并实现首个建筑：湖心岛（触发 HARD 特殊关卡）。

---

## 2. 架构决策（最终版）

### 2.1 双轨关卡系统

- 主线轨：继续使用 MAP_DATA + loadLevel(index)。
- 特殊轨：新增 SPECIAL_LEVEL_LIBRARY，通过 specialLevelId 按场景调用。

### 2.2 触发方式

- 普通主线节点：传 levelIndex，走主线加载。
- 特殊建筑节点：传 specialLevelId，走特殊加载。
- 生成谜题节点：保持现有 generatedData 路径。

### 2.3 地形管线（对原思路的修正）

推荐执行顺序：

1) 初始化基础地形
2) 运行基础 CA
3) 应用特殊建筑 stamp
4) 对建筑边缘做轻度融合（可选），并保护核心图案

原因：避免“先放建筑再跑通用 CA”导致建筑被侵蚀。

---

## 3. 代码改造范围

### 3.1 数据层

- 文件：src/game/mapData.ts
  - 保留 MAP_DATA（主线）
  - 新增 SPECIAL_LEVEL_LIBRARY
  - 将 levels.ts 的 MEDIUM/HARD 关卡迁入 SPECIAL_LEVEL_LIBRARY

建议结构：

- SpecialLevelEntry
  - id: string
  - difficulty: medium | hard
  - tags: string[]
  - data: number[][]

### 3.2 关卡路由层

- 文件：src/game/LevelSelect.ts
  - onLevelSelect 回调增加可选 specialLevelId
  - 特殊建筑节点使用 specialLevelId 进入关卡

- 文件：src/game/GameController.ts
  - 新增 loadSpecialLevel(specialLevelId)
  - 通过 SPECIAL_LEVEL_LIBRARY 查询并加载
  - UI 显示从 关卡 N 切换为 特殊关卡 名称/标签（最小实现可只显示“特殊关卡”）

### 3.3 特殊建筑层

- 新文件：src/game/worldStructures.ts
  - 定义 StructureDefinition
  - 定义 placement 计算与 stamp 接口
  - 暴露 getStructuresForChunk / applyStructuresToGrid

- 文件：src/game/LevelSelect.ts
  - 在 generateChunk 中接入结构系统（post-CA）
  - 保留中心与入口保护 mask

---

## 4. 首个结构：湖心岛（MVP 规格）

### 4.1 生成约束

- 仅在 lake biome 生成
- 远离新手区与主线走廊
- 基于 mapSeed + 大区块坐标确定，保证可复现

### 4.2 图案规则

- 外环：water
- 中环：浅滩/过渡（可先省略，做纯水环）
- 中心：可站立小岛
- 岛中心节点：绑定 1 个 HARD specialLevelId

### 4.3 随机性

- 半径小范围随机（例如 3-5）
- 岛内装饰稀疏随机（rock/bush，可选）
- HARD 关卡从 tags 包含 lake_island 的条目中按 seed 选取

### 4.4 可达性与门槛

- 无船时不可进入（沿用现有水域规则）
- 拿船后可进入岛并触发特殊关卡

---

## 5. 分阶段执行（像计划的任务拆分）

### Phase A：特殊关卡库接入

任务：

1) 在 mapData.ts 增加 SPECIAL_LEVEL_LIBRARY 类型与导出
2) 迁移 MEDIUM/HARD 关卡到库中（打标签 hard/medium）
3) 保持 MAP_DATA 与旧逻辑不变

完成标准：

- 编译通过
- 主线 1~16 关行为不变
- SPECIAL_LEVEL_LIBRARY 可按 id 正确取关

### Phase B：关卡路由打通

任务：

1) 扩展 LevelSelect -> GameController 关卡选择参数
2) 新增 loadSpecialLevel
3) 保持 generated level 路径不回归

完成标准：

- 可从代码中手动触发一个 specialLevelId 并进入
- loadLevel(index) 与 loadGeneratedLevel 不受影响

### Phase C：结构框架接入

任务：

1) 新建 worldStructures.ts 基础接口与注册表
2) generateChunk 增加 post-CA 结构应用点
3) 增加保护 mask，避免关键节点被覆盖

完成标准：

- 结构系统可注册但不启用时，地图结果与当前一致
- 启用后不会破坏 chunk 缓存和性能

### Phase D：湖心岛上线

任务：

1) 实现 LakeIslandStructure
2) 在岛中心放置特殊关卡入口节点
3) 绑定 hard specialLevelId 选择器

完成标准：

- 固定 seed 下位置稳定
- 玩家拿船可进入并触发 HARD 特殊关卡
- 不影响主线与生成谜题节点

---

## 6. 风险与防护

1) 索引耦合风险
- 防护：主线继续只认 MAP_DATA index；特殊关卡全部走 id，不复用主线 index。

2) 建筑被 CA 破坏
- 防护：建筑改为 post-CA stamp + 保护 mask。

3) 特殊节点编码冲突
- 防护：为“特殊入口 tile”保留独立值域，避免与 CHEST / GENERATED_LEVEL 冲突。

4) 进度存档混淆
- 防护：如需记录特殊关卡完成情况，新增 completedSpecialLevelIds，不混入 completedLevels。

---

## 7. 验收清单（最终）

- 主线完整可玩，旧流程无回归。
- 特殊关卡可按 specialLevelId 调用，不参与主线批量线性加载。
- 湖心岛可稳定生成、可识别、可进入、可触发 HARD 特殊关卡。
- bun run build 通过。

---

## 8. 下一步执行建议

按顺序先做 Phase A + Phase B（最小可用链路）：

1) 先把 MEDIUM/HARD 迁入 SPECIAL_LEVEL_LIBRARY
2) 打通 loadSpecialLevel
3) 用一个临时触发点验证特殊关卡流程

确认链路稳定后再上结构系统与湖心岛。
