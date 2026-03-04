# Festival 3.1 — WebAssembly Build

Festival 3.1 is a state-of-the-art Sokoban solver by Yaron Shoham, originally written in C/C++ for Windows (MinGW64). This documents the changes made to compile it to WebAssembly via Emscripten.

## Source Code Changes

All changes are minimal `#ifdef` guards; no logic was altered.

| File | Change |
|---|---|
| `util.cpp` | Wrapped `<windows.h>` and `<sys/timeb.h>` in `#ifndef LINUX`; added LINUX path in `get_number_of_cores()` (returns 1 core); made `my_getch()` a no-op under `__EMSCRIPTEN__` |
| `sol.cpp` | Removed `#include <malloc.h>` (`<stdlib.h>` already provides `malloc`/`free`) |
| `io.cpp` | `save_debug_board()`: use relative path under LINUX instead of `c:\data\debug.txt` |
| `lurd.cpp` | `lurd_tests()`: use relative path under LINUX instead of `c:\sokoban\lurd.txt` |
| `debug.cpp` | `save_status()`: added `#ifndef LINUX`/`#else` for path separator (`\` vs `/`) |
| `sokoban_solver.cpp` | Added `#ifdef __EMSCRIPTEN__` to reduce `log_size` from 23 (~1.5GB) to 20 (~128MB) per core |

## Build

### Prerequisites

```bash
# Install Emscripten SDK (one-time)
cd /tmp
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk && ./emsdk install latest && ./emsdk activate latest
source emsdk_env.sh
```

### Compile to WASM (Node.js, with real filesystem access)

```bash
source /tmp/emsdk/emsdk_env.sh

emcc -O3 *.cpp -DLINUX -o festival.js \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=256mb \
    -s MAXIMUM_MEMORY=4gb \
    -s EXIT_RUNTIME=1 \
    -s NODERAWFS=1
```

### Compile to WASM (browser, with bundled levels)

```bash
emcc -O3 *.cpp -DLINUX -o festival.js \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=256mb \
    -s MAXIMUM_MEMORY=4gb \
    -s EXIT_RUNTIME=1 \
    --preload-file levels/
```

### Compile native (macOS/Linux)

```bash
g++ -O3 *.cpp -DLINUX -o festival
```

### Key flags

- `-DLINUX` activates POSIX code paths (forward slashes, ANSI colors, no `windows.h`)
- No `-DTHREADS` = single-threaded mode (WASM threading via SharedArrayBuffer adds complexity)
- `-s NODERAWFS=1` gives Node.js direct filesystem access (reads/writes real files)
- `-s ALLOW_MEMORY_GROWTH=1` lets WASM heap grow dynamically up to 4GB

## Usage

```bash
# Place level files in levels/ directory
node festival.js XSokoban -level 1 -cores 1 -time 60
```

Output: `solutions.sok` in the current directory.

### Options

| Flag | Description |
|---|---|
| `-level N` | Solve only level N |
| `-from N -to M` | Solve levels N through M |
| `-cores 1` | Number of cores (always use 1 for WASM) |
| `-time S` | Time limit in seconds (default: 600) |
| `-out_file path` | Custom output file path |
| `-extra_mem N` | Adjust memory: log_size += N |

## Output Files

- `festival.js` (66K) — JS glue code
- `festival.wasm` (250K) — compiled binary
- `festival.data` (browser build only) — bundled level files
