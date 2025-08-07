# Terminal Webcam

View your webcam directly in the terminal with zoom capabilities.


## Quick Start

```bash
npm install -g terminal-webcam
tcam
```

## Features

- Live webcam streaming in your terminal
- Zoom in/out with resolution adjustment
- Multiple display modes (Pixels, Blocks, Shades, ASCII)
- Pan controls when zoomed
- Resolution scales with zoom level

## Requirements

- [Bun](https://bun.sh) runtime (for running from source)
- [FFmpeg](https://ffmpeg.org) (for webcam capture)
- macOS (tested on macOS, uses AVFoundation for camera access)
- Terminal with Unicode support and color capabilities

## Installation

### Install globally via npm (Recommended)

```bash
# Install globally
npm install -g terminal-webcam

# Run with the tcam command
tcam
```

### Install globally via bun

```bash
# Install globally with bun
bun install -g terminal-webcam

# Run with the tcam command
tcam
```

### Run from source

```bash
# Clone the repository
git clone https://github.com/aaronshaf/terminal-webcam.git
cd terminal-webcam

# Install dependencies
bun install

# Run directly
bun terminal-webcam.ts
```

## Usage

Once installed globally, simply run:

```bash
tcam
```

## Controls

| Key | Action |
|-----|--------|
| `1` | Pixels mode (full color blocks) |
| `2` | Blocks mode (gradient blocks) |
| `3` | Shades mode (shaded characters) |
| `4` | ASCII mode (ASCII art style) |
| `+`/`-` | Zoom in/out (increases capture resolution) |
| `↑`/`↓`/`←`/`→` | Pan when zoomed |
| `0` | Reset zoom to 1x |
| `Q` | Quit |

## How it Works

The viewer adjusts camera capture resolution based on zoom level - when you zoom in, it captures at higher resolution to show more detail. Uses FFmpeg for camera access and ANSI escape codes for terminal rendering.

## Technical Details

- Self-contained terminal UI implementation (no external dependencies)
- Uses FFmpeg's AVFoundation input for macOS camera access
- Written in TypeScript, runs on Bun runtime
- Captures at 30fps, displays at 15fps for balanced performance

## Troubleshooting

### Camera not found
Make sure to grant terminal/IDE camera permissions in macOS System Preferences → Privacy & Security → Camera.

### FFmpeg not installed
Install FFmpeg using Homebrew:
```bash
brew install ffmpeg
```

### Performance issues
- Reduce terminal window size for better performance
- Try ASCII or blocks mode instead of pixels mode
- Ensure no other applications are using the camera


## License

MIT

## Credits

Powered by [Bun](https://bun.sh) runtime and FFmpeg.