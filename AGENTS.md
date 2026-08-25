# AGENTS.md

This file provides guidance to AI coding agents (opencode, Claude Code, etc.) when working with code in this repository.

## Project Overview

TSokoban is a browser-based Sokoban puzzle game rebuilt from a JavaFX version, written in TypeScript with zero runtime dependencies. It uses canvas rendering, supports predefined and procedurally generated levels, LAN multiplayer, and persists progress via localStorage.

## Commands

- `bun install` — install dependencies
- `bun run dev` — start Vite dev server
- `bun run build` — type-check with `tsc` then build with Vite (multiplayer **enabled**)
- `bun run build:single` — single-player-only build (`MULTIPLAYER=0`); the multiplayer mode buttons compile down to a "run the local server" reminder dialog. Cloudflare Pages uses this build command.
- `bun run preview` — preview production build
- `bun run server` — start the LAN multiplayer relay + static host for `dist/` (port 8787, prints join URLs; run `bun run build` first)
- `bun run test:mp` — server protocol smoke test (`scripts/smoke_mp.ts`, spawns the server on :8791)

There are no lint commands. Type checking is done via `tsc` (strict mode with `noUnusedLocals`/`noUnusedParameters`, `verbatimModuleSyntax` — use `import type` for type-only imports, `erasableSyntaxOnly` — no enums/namespaces). `tsconfig.json` only includes `src/`; `server/` is plain Bun TypeScript, not typechecked by `tsc`.

## Architecture

Entry point: `src/main.ts` → instantiates `Menu` which owns the top-level UI.

### Core modules

- **`src/game/`** — game logic, exported as a barrel module via `index.ts`
  - `SokobanMap` — game state using a bitmask tile system (`WALL=1, BOX=2, PLAYER=4, GOAL=8`); tiles combine via bitwise OR
  - `GameController` — orchestrates input handling, move queue/animation, UI updates; tracks all event listeners for cleanup on destroy. Also hosts the multiplayer level mode (`MpContext`, `loadMultiplayerLevel`, peer-cat tracking)
  - `GameScene` — dual-canvas renderer (map canvas + UI overlay) with a camera system that follows the player and supports drag-to-pan; renders a second (peer) cat via `CatRenderState`/`peerImg` with CSS-filter tinting
  - `AStarSolver` — facade over `AStarSolverV2` (≤5 boxes, Manhattan heuristic) and `AStarSolverF2` (>5 boxes, BFS push-distance tables, weighted A*); used for hints, step-limit calibration, and puzzle validation
  - `LevelSelect` — world map with chunk-based terrain generation, A* pathfinding, and biome-aware rendering; in multiplayer also renders the peer cat and runs the level-entry/ready-check UI
  - `biomes` — biome system defining 4 terrain types (grassland, lake, highlands, dark forest) with per-biome colors, water/rock densities, sprites, and boundary blending via 120×120 tile units
  - `puzzleGenerator` — seed-based procedural level generation (reverse-play + A* validation)
  - `mapData` — predefined level definitions + `SPECIAL_LEVEL_LIBRARY`
  - `types` — `Coordinate`, `TileType`, `TILE_MASK`, `Equipment`

- **`src/net/`** — multiplayer client layer
  - `protocol.ts` — message types (transport + game payloads), `LevelRef` (handcrafted/special/generated reference), `WorldFlags`, `PEER_TINT` (CSS filter for the guest cat)
  - `NetClient.ts` — thin WebSocket wrapper for the `/room` endpoint (same origin as the page)
  - `MultiplayerSession.ts` — one room session: roles (host/guest), peer overworld state, the ready-check handshake FSM, `computeSpawns` (BFS for the guest's connected spawn tile), and payload routing via public callback fields

- **`server/room.ts`** — Bun WebSocket relay + static file server for `dist/`. Intentionally a "dumb relay": it only manages room membership (max 2 players) and broadcasts opaque payloads. Host leaving dissolves the room. All game logic lives in the clients because everything is deterministic from a seed (see Multiplayer design).

- **`src/menu.ts`** — main menu with animated elements (clouds, box, cat), mode select (经典模式 / 创建房间 / 加入房间, icons `choice1-3.png`), create/join room dialogs, and `?room=XXXX` direct-link auto-join
- **`src/settings.ts`** — `SettingsManager` with listener-based reactivity (move duration, volume, A* toggle, map seed)
- **`src/progress.ts`** — `ProgressManager` for save/load via localStorage with base64 export/import. Tracks completed levels, item counts (hint/plus/undo), equipment, discovered structures, 小鱼干 (fish currency), and completed generated levels.
- **`src/theme.ts`** — `ThemeManager` with 6 predefined themes (RGB color sets), listener-based reactivity
- **`src/ui/`** — dialog components (settings dialog, theme dialog, generic `createDialog` with optional `onClose`)
- **`src/utils.ts`** — seeded PRNG (`myRand` — all procedural decoration derives from it), color utilities

### Multiplayer design (v1)

- **Determinism is the core trick**: world chunks (seed + cellular automata), handcrafted/special levels (static data), and generated puzzles (`generatePuzzle(worldX, worldY, seed, difficulty)`) are all byte-identical on every client. The server never syncs game state — only player intents (`pos`, `move`, `enter`, `exit`, `readyReq`…).
- **Roles**: host = room creator. `levelStart` is always sent by the host; both sides enter the level upon receiving/sending it. The guest's cat wears the tint on **both** screens.
- **Level entry**: solo entry broadcasts `enter` (the peer renders that cat standing on the tile); both cats on the same tile + Enter triggers the ready-check handshake (确认 1/2, 15 s timeout, walking away cancels). Shared spawns: host at the map's default player tile, guest at the nearest connected free tile (overlap fallback).
- **In-level**: the peer cat is tracked **outside** `SokobanMap` (`GameController.peerPos`) — remote moves apply optimistically and are validated against walls/boxes. Rules: step limit = optimalSteps + 25 with a shared counter, undo/hint disabled (plus works), A* deadlock check off (corner deadlock still loses).
- **World vs player state**: on join, the host sends `WorldFlags` (completedLevels, chestOpened, completedGeneratedLevels). The guest renders the **host's world truth** (`LevelSelect.mpWorldFlags`) while fish/items/equipment stay personal. This is the stopgap for the future Terraria-style world/player save split.
- **Disconnect = session void**: host-left / peer-left / connection-lost all route to `Menu.handleMpDisconnect`, which tears down whatever is on screen and returns to the menu.
- **Callback ownership**: `MultiplayerSession` exposes public callback fields. Menu owns `onLevelStart`/`onJoined`/`onPeerJoined`/`onDisconnected`; LevelSelect owns `onPeerWorldUpdate`/ready prompts; GameController owns `onPeerMove`/`onPeerWin`/`onPeerRestart`/`onPeerExitLevel`. The active screen assigns them; `destroy()` resets them to no-ops.
- **Build flag**: `__MULTIPLAYER__` (Vite `define`, set `MULTIPLAYER=0` for single builds). Dead branches at call sites are eliminated by the bundler; class methods stay in the bundle but are unreachable.
- Known v1 limitations: no desync repair if both players push the same box in the same frame (LAN-latency rare); no reconnect (disconnect voids the session); star rating uses the combined step count.

### Key patterns

- **Observer/listener pattern**: `SettingsManager`, `ThemeManager`, and `ProgressManager` all use callback subscriptions for reactive updates.
- **Bitmask tiles**: tile state is composed with bitwise ops (e.g. a box on a goal = `BOX | GOAL`). Check tile properties with `& TILE_MASK.X`.
- **Animation queue**: moves are queued so rapid input doesn't drop commands; animations are throttled by the `moveAnimDuration` setting.
- **Event cleanup**: `GameController` registers all DOM listeners in a tracked list and removes them on `destroy()` to prevent leaks when switching between menu and game.
- **Deterministic decoration**: all grass/flower/butterfly placement derives from `myRand(cell coords, salt)` — no stored decoration state.

### Reward system

- **小鱼干 (dried fish)**: lightweight currency earned by completing generated levels. Drop formula: base 1 + 1 if 3-star + 1 if difficulty ≥ 4 (range 1–3 per level). Stored in `Progress.fishCount`. In multiplayer both clients settle rewards locally.
- **Generated level completion**: tracked via `Progress.completedGeneratedLevels` (keys: `"worldX,worldY"`). Completed levels render as `DECORATION` tiles (golden 🌸) on the world map and cannot be re-entered.
- **World map tile constants** in `LevelSelect`: `WATER=-3, ROCK=-2, CHEST=-1, SPECIAL_LEVEL=-4, DECORATION=-5, GENERATED_LEVEL=50`. Positive values = handcrafted level index + 1.
