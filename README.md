# Terminal Webcam

A high-quality webcam viewer that runs directly in your terminal with dynamic zoom capabilities.

![Terminal Webcam Demo](demo.gif)

## Quick Start

```bash
npm install -g terminal-webcam
tcam
```

## Features

- 🎥 **Live webcam streaming** directly in your terminal
- 🔍 **Dynamic zoom** with automatic resolution adjustment for crisp details
- 🎨 **Multiple display modes**: Pixels, Blocks, Shades, ASCII art
- 📐 **Pan controls** when zoomed in to navigate the frame
- 🚀 **High performance** with optimized frame processing
- 📱 **Smart resolution scaling** - captures at higher resolution when zoomed

## Requirements

- [Bun](https://bun.sh) runtime (for running from source)
- [FFmpeg](https://ffmpeg.org) (for webcam capture)
- macOS (currently uses AVFoundation for camera access)
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
git clone https://github.com/yourusername/terminal-webcam.git
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

### Dynamic Resolution Scaling

The viewer automatically adjusts the camera capture resolution based on zoom level:
- **1x zoom**: Captures at ~10x terminal resolution for sharp base quality
- **2x-4x zoom**: Increases capture resolution proportionally
- **4x+ zoom**: Captures at maximum available resolution (up to 1920x1080)

This ensures you get real detail enhancement when zooming, not just pixel magnification.

### Intelligent Debouncing

Rapid zoom changes are intelligently batched with a 500ms debounce to prevent crashes and ensure smooth transitions.

### Optimized Rendering

- Efficient direct terminal rendering with ANSI escape codes
- Processes video frames in RGB24 format for optimal performance
- Smart pixel sampling with averaging at high zoom levels

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

## Future Improvements

- [ ] Linux support (V4L2)
- [ ] Windows support (DirectShow)
- [ ] Recording capabilities
- [ ] Filters and effects
- [ ] Multiple camera support
- [ ] Custom color palettes

## License

MIT

## Credits

Powered by [Bun](https://bun.sh) runtime and FFmpeg.