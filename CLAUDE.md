# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TSokoban is a browser-based Sokoban puzzle game rebuilt from a JavaFX version, written in TypeScript with zero runtime dependencies. It uses canvas rendering, supports predefined and procedurally generated levels, and persists progress via localStorage.

## Commands

- `bun install` — install dependencies
- `bun run dev` — start Vite dev server
- `bun run build` — type-check with `tsc` then build with Vite
- `bun run preview` — preview production build

There are no test or lint commands configured. Type checking is done via `tsc` (strict mode with `noUnusedLocals` and `noUnusedParameters`).

## Architecture

Entry point: `src/main.ts` → instantiates `Menu` which owns the top-level UI.

### Core modules

- **`src/game/`** — game logic, exported as a barrel module via `index.ts`
  - `SokobanMap` — game state using a bitmask tile system (`WALL=1, BOX=2, PLAYER=4, GOAL=8`); tiles combine via bitwise OR
  - `GameController` — orchestrates input handling, move queue/animation, UI updates; tracks all event listeners for cleanup on destroy
  - `GameScene` — dual-canvas renderer (map canvas + UI overlay) with a camera system that follows the player and supports drag-to-pan
  - `AStarSolver` — pathfinding for the hint system
  - `LevelSelect` — world map with chunk-based terrain generation, A* pathfinding, and biome-aware rendering
  - `biomes` — biome system defining 4 terrain types (grassland, lake, highlands, dark forest) with per-biome colors, water/rock densities, sprites, and boundary blending via 60×60 tile units
  - `puzzleGenerator` — seed-based procedural level generation
  - `mapData` — predefined level definitions
  - `types` — `Coordinate`, `TileType`, `TILE_MASK`, `Equipment`

- **`src/menu.ts`** — main menu with animated elements (clouds, box, cat)
- **`src/settings.ts`** — `SettingsManager` with listener-based reactivity (move duration, volume, A* toggle, map seed)
- **`src/progress.ts`** — `ProgressManager` for save/load via localStorage with base64 export/import
- **`src/theme.ts`** — `ThemeManager` with 6 predefined themes (RGB color sets), listener-based reactivity
- **`src/ui/`** — dialog components (settings dialog, theme dialog, generic dialog)
- **`src/utils.ts`** — seeded PRNG, color utilities

### Key patterns

- **Observer/listener pattern**: `SettingsManager`, `ThemeManager`, and `ProgressManager` all use callback subscriptions for reactive updates.
- **Bitmask tiles**: tile state is composed with bitwise ops (e.g. a box on a goal = `BOX | GOAL`). Check tile properties with `& TILE_MASK.X`.
- **Animation queue**: moves are queued so rapid input doesn't drop commands; animations are throttled by the `moveAnimDuration` setting.
- **Event cleanup**: `GameController` registers all DOM listeners in a tracked list and removes them on `destroy()` to prevent leaks when switching between menu and game.
