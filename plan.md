# TSokoban 大世界冒险模式设计方案

## Context

当前 TSokoban 有 16 个手工关卡、无限程序生成的世界地图、3 种装备（无/船/翅膀）。玩家拿到翅膀后游戏缺乏后续目标。本方案旨在将游戏演化为一个 Terraria 风格的永久世界冒险游戏，通过生态区系统、程序生成关卡、装备进度树和新谜题机制来创造持久的探索动力。

---

## 一、世界结构：生态区系统

在现有的 chunk 生成系统上叠加一层生态区（Biome）划分。利用已有的 `myRand` 确定性随机，按大区域（~60x60 tiles）分配生态区类型。

### 4 个生态区

| 生态区 | 视觉风格 | 地形特征 | 进入条件 | 谜题特色机制 |
|--------|---------|---------|---------|-------------|
| 草原 (Grassland) | 现有绿色 | 平衡地形 | 无 | 标准推箱子 |
| 湖区 (Lake District) | 蓝绿色调 | 大量水域、岛屿 | 船 | 冰面滑行 |
| 山地 (Highlands) | 棕灰色调 | 大量岩石、窄道 | 镐 | 重箱（推两次移一格）|
| 暗森林 (Dark Forest) | 深绿/紫色调 | 密集灌木、隐藏路径 | 灯笼 | 迷雾（只能看到玩家周围） |

### 生态区分布规则

- 出生点附近（距原点 < 2 个生态区单位）：固定为草原，安全区
- 中距离（2-5）：草原 40%、湖区 35%、山地 25%
- 远距离（>5）：四种均匀分布，暗森林只在远处出现
- 生态区边界用 CA 平滑过渡（复用现有 `generateChunk` 的 halo 机制）

### 实现要点

- 新建 `src/game/biomes.ts`，定义 `BiomeDef` 接口（颜色、地形权重、谜题机制类型）
- 修改 `LevelSelect.getInitialTileState()` —— 先查询当前坐标所属生态区，再用该生态区的参数生成地形
- 修改 `LevelSelect.drawGrass()` —— 根据生态区覆盖颜色（现有 `randColor` 读 theme，改为优先读 biome 颜色）
- 每个生态区使用不同的灌木精灵和水面颜色

### 关键文件
- `src/game/LevelSelect.ts` — 世界生成和渲染（主要修改）
- `src/game/biomes.ts` — 新建，生态区定义
- `src/utils.ts` — `myRand` 已有，无需修改

---

## 二、程序生成关卡系统

### 核心算法：反向推演生成

从已解决状态出发，反向模拟玩家操作来生成保证可解的谜题：

1. 创建 WxH 的空房间，按生态区风格放置墙壁
2. 随机放置 N 个箱子在目标点上（已解决状态）
3. 反向操作：随机选择一个箱子，将其"拉"离目标点（等价于玩家从另一侧推）
4. 执行 M 次反向操作（M 决定难度）
5. 用现有 `AStarSolver` 验证：解的步数在目标范围内则接受，否则重新生成

### 难度与生态区关联

| 生态区 | 房间大小 | 箱子数 | 目标解步数 | 特殊机制 |
|--------|---------|--------|-----------|---------|
| 草原 | 5x5~6x6 | 1-2 | 5-15 | 无 |
| 湖区 | 6x6~7x7 | 2-3 | 10-25 | 冰面滑行 |
| 山地 | 5x5~6x6 | 2-3 | 10-20 | 重箱 |
| 暗森林 | 7x7~8x8 | 2-4 | 15-30 | 迷雾视野 |

### 关卡在世界地图上的分布

- 现有 16 个手工关卡保留在出生点附近（"主线剧情"）
- 超出手工关卡范围后，世界地图上的关卡节点由程序生成
- 关卡节点的位置由 `myRand(worldX, worldY, seed)` 确定性决定
- 点击节点时，用 `(worldX, worldY, mapSeed)` 作为种子即时生成谜题
- 生成结果缓存在 `Map<string, number[][]>` 中，同一节点每次进入是同一关

### 新谜题机制（3 种）

**冰面滑行（湖区）：** 箱子被推到冰面 tile 上后会沿推动方向持续滑动，直到撞墙或撞到其他箱子。在 `SokobanMap.movePlayer()` 中，推箱子后检查目标格是否为冰面，如果是则循环移动箱子。

**重箱（山地）：** 特殊箱子需要推两次才移动一格。第一次推标记为"蓄力"状态，第二次同方向推才真正移动。在 `movePlayer` 中追踪上一次推动方向。

**迷雾视野（暗森林）：** 玩家只能看到周围 2 格范围内的 tile，其余显示为黑色。纯渲染层修改，在 `GameScene.draw()` 中根据玩家位置计算可见区域。不影响游戏逻辑，只影响信息量。

### 关键文件
- `src/game/puzzleGenerator.ts` — 新建，反向推演生成器
- `src/game/SokobanMap.ts` — 添加冰面滑行和重箱逻辑
- `src/game/GameScene.ts` — 添加迷雾渲染
- `src/game/GameController.ts` — 添加 `loadGeneratedLevel()` 方法
- `src/game/types.ts` — 添加新 tile 类型常量
- `src/game/AStarSolver.ts` — 可能需要适配新 tile 类型的寻路

---

## 三、装备进度树（4 种）

### 装备定义

| 装备 | 能力 | 获取方式 | 解锁区域 |
|------|------|---------|---------|
| 船 (boat) | 穿越水面 | 通关草原区域的 Boss 关 | 湖区 |
| 镐 (pickaxe) | 击碎岩石 | 通关草原区域的另一个 Boss 关 | 山地 |
| 翅膀 (wing) | 飞越任何地形 | 通关湖区的 Boss 关（湖心岛） | 暗森林外围 |
| 灯笼 (lantern) | 照亮暗区域 | 通关山地的 Boss 关（山洞深处） | 暗森林内部 |

### 分支结构

```
        [起点: 无装备]
          /         \
      [船]          [镐]
       |              |
    [翅膀]          [灯笼]
       \              /
      [暗森林深处 - 终极挑战]
```

玩家选择先拿船还是先拿镐，形成两条路线。翅膀和灯笼分别是两条线的终点。两条线汇合后可以进入暗森林最深处的终极挑战区域。

### 装备切换机制

- 玩家同一时间只能装备一件（保持现有 UI 的循环切换）
- 翅膀不再是"万能"的 —— 翅膀可以飞越水和岩石，但不能照亮暗区域
- 这意味着即使拿到翅膀，暗森林内部仍然需要灯笼

### Boss 关设计

Boss 关是手工设计的多房间地牢，由 3-4 个小谜题房间串联：
- 每个房间 5x5，解开后门打开通往下一房间
- 最后一个房间难度最高
- 通关奖励对应装备

### 数据结构变更

```typescript
// types.ts
export type EquipmentId = 'none' | 'boat' | 'wing' | 'pickaxe' | 'lantern';

// progress.ts - Progress 接口
export interface Progress {
    completedLevels: number[];
    itemCounts: { hint: number; plus: number; undo: number };
    chestOpened: boolean;
    // 替换原有 equipment: Equipment
    unlockedEquipment: EquipmentId[];   // 已解锁的装备列表
    activeEquipment: EquipmentId;       // 当前佩戴的装备
    // 新增
    completedDungeons: string[];        // 已通关的地牢 ID
    discoveredBiomes: string[];         // 已发现的生态区
    totalStars: number;                 // 星级总数
}
```

旧存档兼容：`ProgressManager` 构造函数中检测旧格式并迁移。

### 关键文件
- `src/game/types.ts` — 扩展 Equipment 类型
- `src/progress.ts` — Progress 接口变更 + 迁移逻辑
- `src/game/LevelSelect.ts` — 装备切换 UI、移动能力判断
- `src/game/dungeons.ts` — 新建，地牢关卡定义

---

## 四、星级评价与重玩性

### 星级系统

每关通关后根据步数评分：
- 3 星：步数 ≤ 最优解 × 1.0（完美通关）
- 2 星：步数 ≤ 最优解 × 1.5
- 1 星：通关即可

星级记录在 `progressManager` 中，世界地图上的关卡节点显示已获星级。总星数可以解锁额外奖励（道具补给、猫咪皮肤等）。

### 程序生成关卡的无限性

由于关卡是程序生成的，世界地图上散布着无限的关卡节点。玩家永远有新的谜题可以挑战。不同生态区的关卡有不同的机制，保持新鲜感。

### 探索日志

记录玩家的探索成就：已发现生态区、已通关关卡数、总星数、已获装备、最远探索距离。作为一个可从菜单访问的"日志"界面。

---

## 五、实施路线

### Phase 1：程序生成关卡引擎

目标：让世界地图上出现无限的可玩关卡。

1. 新建 `src/game/puzzleGenerator.ts` — 实现反向推演算法
2. 修改 `src/game/types.ts` — 添加新 tile 类型常量（ICE, HEAVY_BOX 等）
3. 修改 `src/game/GameController.ts` — 添加 `loadGeneratedLevel(data, meta)` 方法
4. 修改 `src/game/LevelSelect.ts` — 在手工关卡之外的区域生成程序关卡节点
5. 添加星级评价到通关流程

### Phase 2：生态区系统

目标：世界不再是单一的绿色草原。

1. 新建 `src/game/biomes.ts` — 定义 4 个生态区
2. 修改 `src/game/LevelSelect.ts` — 生态区分配 + 地形生成参数化 + 渲染颜色覆盖
3. 关卡生成器根据生态区调整难度和房间参数

### Phase 3：新谜题机制

目标：不同生态区的关卡玩起来不一样。

1. 修改 `src/game/SokobanMap.ts` — 冰面滑行逻辑
2. 修改 `src/game/SokobanMap.ts` — 重箱逻辑
3. 修改 `src/game/GameScene.ts` — 迷雾视野渲染
4. 修改 `src/game/AStarSolver.ts` — 适配新机制的寻路（hint 系统需要理解新规则）
5. 修改 `puzzleGenerator.ts` — 生成包含新机制 tile 的关卡

### Phase 4：装备进度树

目标：探索有明确目标和动力。

1. 修改 `src/game/types.ts` — 扩展 EquipmentId
2. 修改 `src/progress.ts` — 新 Progress 结构 + 旧存档迁移
3. 新建 `src/game/dungeons.ts` — 4 个 Boss 地牢定义
4. 修改 `src/game/LevelSelect.ts` — 装备能力判断、地牢入口渲染
5. 添加镐和灯笼的精灵资源

### Phase 5：打磨

1. 探索日志 UI
2. 星级奖励系统
3. 各生态区 BGM（复用已有未使用的音乐文件）
4. 生态区过渡动画

---

## 六、验证方式

1. **程序生成质量**：生成 100 个关卡，用 AStarSolver 验证全部可解，检查解步数分布是否合理
2. **生态区渲染**：在世界地图上移动，确认不同区域颜色/地形明显不同，过渡自然
3. **新机制正确性**：手动测试冰面滑行、重箱、迷雾各 3 个关卡，确认逻辑无 bug
4. **装备门控**：不带船无法进入湖区关卡节点，不带镐无法进入山地关卡节点
5. **存档兼容**：用旧格式存档加载，确认自动迁移成功且不丢失进度
6. **性能**：关卡生成应在 < 100ms 内完成，不造成可感知的卡顿