# Pong Game

A classic Pong game implementation using TypeScript and Bun.

## Files

- `pong.ts` - Full OpenTUI-based implementation (requires building OpenTUI's native library)
- `simple-pong.ts` - Simplified terminal-based version that works out of the box

## Running the Game

### Simple Version (Recommended)
```bash
bun run simple-pong.ts
```

### OpenTUI Version
Requires building OpenTUI's native library first:
```bash
cd ../opentui
# Install zig first: https://ziglang.org/download/
bun run build:prod
cd ../pong-game
bun run pong.ts
```

## How to Play

### Controls
- **W/S** - Move left paddle up/down
- **I/K** - Move right paddle up/down  
- **SPACE** - Start/pause game
- **R** - Reset game
- **Q** - Quit

### Rules
- First player to score 5 points wins
- Ball speeds up slightly after each paddle hit
- Hitting the ball with the edge of the paddle adds spin

## Game Features
- Classic Pong gameplay
- Score tracking
- Win condition (first to 5 points)
- Ball physics with spin
- Pause/resume functionality
- Clean terminal-based graphics

Enjoy playing Pong!