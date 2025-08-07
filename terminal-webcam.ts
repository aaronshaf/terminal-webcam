#!/usr/bin/env bun
import {
  createCliRenderer,
  TextRenderable,
  type CliRenderer,
  RGBA,
} from "./opentui-core"
import { spawn, execSync } from 'child_process';

// Get first camera
function getFirstCamera(): { index: string; name: string } {
  try {
    const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', { 
      encoding: 'utf8',
      shell: true 
    });
    
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('[AVFoundation indev @') && !line.includes('Capture screen')) {
        const match = line.match(/\[AVFoundation indev @ [^\]]+\]\s+\[(\d+)\]\s+(.+)/);
        if (match) {
          return { index: match[1], name: match[2] };
        }
      }
    }
  } catch (e) {}
  
  return { index: '0', name: 'Default Camera' };
}

class WebcamViewer {
  private renderer: CliRenderer
  private termWidth: number
  private termHeight: number
  private camera: { index: string; name: string }
  private ffmpeg: any
  private captureWidth: number = 640  // Camera capture resolution
  private captureHeight: number = 480
  private videoBuffer: Uint8Array
  private bufferPos: number = 0
  private frameCount: number = 0
  private fps: number = 0
  private textElements: Map<string, TextRenderable> = new Map()
  private displayMode: 'blocks' | 'shades' | 'ascii' | 'pixels' = 'pixels'
  private isRestarting: boolean = false
  private restartTimer: any = null
  private pendingZoomLevel: number = 1.0
  private zoomQueue: number[] = []
  
  // Zoom settings
  private zoomLevel: number = 1.0
  private panX: number = 0.5  // Center X (0-1)
  private panY: number = 0.5  // Center Y (0-1)
  private panSpeed: number = 0.02
  
  // Character sets
  private readonly blockChars = ' ▁▂▃▄▅▆▇█'
  private readonly shadeChars = ' ░▒▓█'
  private readonly asciiChars = ' .,:;ox%#@'
  private readonly pixelChar = '█'
  
  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.termWidth = renderer.terminalWidth
    this.termHeight = renderer.terminalHeight
    this.camera = getFirstCamera()
  }
  
  private updateCaptureResolution() {
    // Set capture resolution based on zoom
    // The key is to capture enough pixels for the zoomed area
    // Increased base multiplier from 4 to 10 for much better quality at 1x zoom
    const baseWidth = this.termWidth * 10  // Higher base quality multiplier
    const baseHeight = this.termHeight * 10
    
    // Calculate the resolution we need for current zoom
    // We want to capture enough to fill the terminal at current zoom
    this.captureWidth = Math.min(1920, Math.round(baseWidth * this.zoomLevel))
    this.captureHeight = Math.min(1080, Math.round(baseHeight * this.zoomLevel))
    
    // Round to even numbers for video encoding
    this.captureWidth = Math.round(this.captureWidth / 2) * 2
    this.captureHeight = Math.round(this.captureHeight / 2) * 2
    
    // Ensure minimum resolution (increased from 320x240 to 640x480)
    this.captureWidth = Math.max(640, this.captureWidth)
    this.captureHeight = Math.max(480, this.captureHeight)
    
    // Update buffer size to match what we'll receive
    const frameSize = this.captureWidth * this.captureHeight * 3
    if (!this.videoBuffer || this.videoBuffer.length !== frameSize) {
      this.videoBuffer = new Uint8Array(frameSize)
      this.bufferPos = 0
    }
  }

  init() {
    console.log(`Using camera: ${this.camera.name}`);
    console.log(`Terminal: ${this.termWidth}x${this.termHeight}`);
    console.log('\nTrue Zoom Mode - Camera resolution scales with zoom level');
    console.log('\nControls:');
    console.log('  1-4: Change display mode');
    console.log('  +/-: Zoom in/out (increases actual capture resolution)');
    console.log('  Arrows: Pan when zoomed');
    console.log('  0: Reset zoom');
    console.log('  Q: Quit\n');
    
    this.renderer.start()
    this.renderer.setBackgroundColor("#000000")
    this.renderer.setCursorPosition(0, 0, false)

    // Create initial text grid
    this.initTextGrid()

    // Start FPS counter
    setInterval(() => {
      this.fps = this.frameCount
      this.frameCount = 0
    }, 1000)

    // Setup keyboard first
    this.setupKeyboard()
    
    // Start ffmpeg
    this.startFFmpeg()
  }

  private initTextGrid() {
    // Create text renderables for each position
    for (let y = 0; y < this.termHeight; y++) {
      for (let x = 0; x < this.termWidth; x++) {
        const key = `${x}-${y}`
        const text = new TextRenderable(key, {
          content: ' ',
          x: x,
          y: y,
          fg: "#000000",
          zIndex: 1,
        })
        this.renderer.add(text)
        this.textElements.set(key, text)
      }
    }

    // Add status bar
    const status = new TextRenderable("status", {
      content: `${this.camera.name} | FPS: 0`,
      x: 2,
      y: 0,
      fg: "#FFFFFF",
      bg: "#333333",
      zIndex: 1000,
    })
    this.renderer.add(status)

    // Add mode indicator
    const mode = new TextRenderable("mode", {
      content: `Mode: ${this.displayMode}`,
      x: this.termWidth - 20,
      y: 0,
      fg: "#00FF00",
      bg: "#333333",
      zIndex: 1000,
    })
    this.renderer.add(mode)
    
    // Add resolution indicator at bottom
    const resolution = new TextRenderable("resolution", {
      content: `Capture: ${this.captureWidth}x${this.captureHeight} | Zoom: 1.0x`,
      x: 2,
      y: this.termHeight - 1,
      fg: "#00FFFF",
      bg: "#111111",
      zIndex: 1000,
    })
    this.renderer.add(resolution)
  }

  private async startFFmpeg() {
    // Prevent concurrent restarts
    if (this.isRestarting) {
      console.log('Already restarting, skipping...')
      return
    }
    
    this.isRestarting = true
    
    // Kill existing ffmpeg if running
    if (this.ffmpeg) {
      try {
        this.ffmpeg.stdout?.removeAllListeners()
        this.ffmpeg.stderr?.removeAllListeners()
        this.ffmpeg.removeAllListeners()
        this.ffmpeg.kill('SIGTERM')
        // Give it time to clean up
        await new Promise(resolve => setTimeout(resolve, 300))
      } catch (e) {
        console.error('Error killing ffmpeg:', e)
      }
    }
    
    // Use pending zoom level if available
    if (this.pendingZoomLevel !== this.zoomLevel) {
      this.zoomLevel = this.pendingZoomLevel
    }
    
    // Update capture resolution based on zoom
    this.updateCaptureResolution()
    
    // Update resolution indicator
    const resEl = this.renderer.getRenderable("resolution") as TextRenderable
    if (resEl) {
      const pixels = (this.captureWidth * this.captureHeight / 1000).toFixed(0)
      resEl.content = `Capture: ${this.captureWidth}x${this.captureHeight} (${pixels}K pixels) | Zoom: ${this.zoomLevel.toFixed(1)}x`
    }
    
    console.log(`Starting capture at ${this.captureWidth}x${this.captureHeight} for zoom ${this.zoomLevel.toFixed(1)}x`)
    
    try {
      // Start ffmpeg - NO SCALING, capture at exact resolution we need
      this.ffmpeg = spawn('ffmpeg', [
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'avfoundation',
        '-framerate', '30',
        '-video_size', '1280x720',  // Input from camera (fixed high res)
        '-i', this.camera.index,
        '-vf', `scale=${this.captureWidth}:${this.captureHeight}`,  // Scale to exact size we need
        '-r', '15',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        '-'
      ])

      this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
        if (!this.isRestarting) {
          this.processVideoData(chunk)
        }
      })

      this.ffmpeg.stderr?.on('data', (data: Buffer) => {
        const error = data.toString()
        if (!error.includes('Capture buffer') && !error.includes('VIDIOC')) {
          console.error('FFmpeg:', error)
        }
      })

      this.ffmpeg.on('exit', (code: number) => {
        if (!this.isRestarting) {
          console.log(`FFmpeg exited unexpectedly: ${code}`)
          // Don't call cleanup here to avoid exit during zoom
        }
      })
      
      this.ffmpeg.on('error', (err: Error) => {
        console.error('FFmpeg spawn error:', err)
        this.isRestarting = false
      })
      
      // Mark as ready after a short delay
      await new Promise(resolve => setTimeout(resolve, 100))
      this.isRestarting = false
      
      // Update resolution indicator back to normal color
      const resEl = this.renderer.getRenderable("resolution") as TextRenderable
      if (resEl) {
        resEl.fg = "#00FFFF"
        const pixels = (this.captureWidth * this.captureHeight / 1000).toFixed(0)
        resEl.content = `Capture: ${this.captureWidth}x${this.captureHeight} (${pixels}K pixels) | Zoom: ${this.zoomLevel.toFixed(1)}x`
      }
      
      // Process any queued zoom changes
      if (this.pendingZoomLevel !== this.zoomLevel) {
        this.scheduleRestart()
      }
      
    } catch (e) {
      console.error('Failed to start ffmpeg:', e)
      this.isRestarting = false
    }
  }
  
  private scheduleRestart() {
    // Cancel any pending restart
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
    }
    
    // Schedule a restart after a short delay to batch rapid changes
    this.restartTimer = setTimeout(async () => {
      this.restartTimer = null
      if (this.pendingZoomLevel !== this.zoomLevel && !this.isRestarting) {
        await this.startFFmpeg()
      }
    }, 500) // Wait 500ms to batch rapid zoom changes
  }

  private processVideoData(chunk: Buffer) {
    const expectedSize = this.captureWidth * this.captureHeight * 3
    let offset = 0
    
    while (offset < chunk.length && this.bufferPos < expectedSize) {
      const toRead = Math.min(expectedSize - this.bufferPos, chunk.length - offset)
      
      // Copy data to our buffer
      for (let i = 0; i < toRead; i++) {
        this.videoBuffer[this.bufferPos + i] = chunk[offset + i]
      }
      
      this.bufferPos += toRead
      offset += toRead
      
      if (this.bufferPos >= expectedSize) {
        this.renderFrame()
        this.bufferPos = 0
        this.frameCount++
      }
    }
  }

  private getCharForBrightness(brightness: number): string {
    const normalizedBrightness = Math.min(1, Math.max(0, brightness / 255))
    
    switch (this.displayMode) {
      case 'blocks':
        const blockIdx = Math.floor(normalizedBrightness * (this.blockChars.length - 1))
        return this.blockChars[blockIdx]
      
      case 'shades':
        const shadeIdx = Math.floor(normalizedBrightness * (this.shadeChars.length - 1))
        return this.shadeChars[shadeIdx]
      
      case 'ascii':
        const asciiIdx = Math.floor(normalizedBrightness * (this.asciiChars.length - 1))
        return this.asciiChars[asciiIdx]
      
      case 'pixels':
      default:
        return this.pixelChar
    }
  }
  
  private sampleVideoPixel(termX: number, termY: number): { r: number, g: number, b: number } {
    // When zoomed, we show a portion of the captured video
    // The capture resolution is already adjusted for zoom level
    
    // Adjust for the fact that we're using termHeight-2 for display (skip top and bottom rows)
    const displayHeight = this.termHeight - 2
    const adjustedY = termY - 1 // Shift down by 1 since we skip row 0
    
    // Calculate viewport in the captured image
    const viewWidth = this.captureWidth / this.zoomLevel
    const viewHeight = this.captureHeight / this.zoomLevel
    
    // Calculate top-left corner based on pan
    const startX = (this.captureWidth - viewWidth) * this.panX
    const startY = (this.captureHeight - viewHeight) * this.panY
    
    // Map terminal position to video position
    const videoX = Math.floor(startX + (termX / this.termWidth) * viewWidth)
    const videoY = Math.floor(startY + (adjustedY / displayHeight) * viewHeight)
    
    // Clamp to bounds
    const x = Math.max(0, Math.min(videoX, this.captureWidth - 1))
    const y = Math.max(0, Math.min(videoY, this.captureHeight - 1))
    
    // Get pixel from buffer
    const idx = (y * this.captureWidth + x) * 3
    
    if (idx + 2 < this.videoBuffer.length) {
      // For better quality at high zoom, we can average nearby pixels
      if (this.zoomLevel > 3) {
        let r = 0, g = 0, b = 0, count = 0
        const radius = 1
        
        for (let dy = -radius; dy <= radius; dy++) {
          for (let dx = -radius; dx <= radius; dx++) {
            const sx = Math.max(0, Math.min(x + dx, this.captureWidth - 1))
            const sy = Math.max(0, Math.min(y + dy, this.captureHeight - 1))
            const sidx = (sy * this.captureWidth + sx) * 3
            
            if (sidx + 2 < this.videoBuffer.length) {
              r += this.videoBuffer[sidx]
              g += this.videoBuffer[sidx + 1]
              b += this.videoBuffer[sidx + 2]
              count++
            }
          }
        }
        
        if (count > 0) {
          return { r: r / count, g: g / count, b: b / count }
        }
      }
      
      // Normal sampling
      return {
        r: this.videoBuffer[idx],
        g: this.videoBuffer[idx + 1],
        b: this.videoBuffer[idx + 2]
      }
    }
    
    return { r: 0, g: 0, b: 0 }
  }

  private renderFrame() {
    // Render each terminal character, but skip status bar rows
    for (let y = 0; y < this.termHeight; y++) {
      // Skip the top row (status bar) and bottom row (resolution indicator)
      if (y === 0 || y === this.termHeight - 1) {
        continue
      }
      
      for (let x = 0; x < this.termWidth; x++) {
        // Sample video
        const { r, g, b } = this.sampleVideoPixel(x, y)
        
        // Calculate brightness
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114)
        
        // Get character
        const char = this.getCharForBrightness(brightness)
        
        // Update text element
        const key = `${x}-${y}`
        const textEl = this.textElements.get(key)
        if (textEl) {
          textEl.content = char
          
          // Convert to hex
          const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
          const color = `#${toHex(r)}${toHex(g)}${toHex(b)}`
          
          if (this.displayMode === 'pixels') {
            textEl.fg = color
            textEl.bg = color
          } else {
            textEl.fg = color
            textEl.bg = "#000000"
          }
        }
      }
    }

    // Update status
    const status = this.renderer.getRenderable("status") as TextRenderable
    if (status && !this.isRestarting) {
      const pixelsPerChar = Math.round((this.captureWidth * this.captureHeight) / (this.termWidth * this.termHeight * this.zoomLevel * this.zoomLevel))
      status.content = `${this.camera.name} | FPS: ${this.fps} | ${pixelsPerChar} pixels/char`
    }
  }

  private setDisplayMode(mode: typeof this.displayMode) {
    this.displayMode = mode
    const modeEl = this.renderer.getRenderable("mode") as TextRenderable
    if (modeEl) {
      modeEl.content = `Mode: ${mode}`
    }
  }
  
  private async adjustZoom(delta: number) {
    const oldZoom = this.pendingZoomLevel
    this.pendingZoomLevel = Math.max(1.0, Math.min(8.0, this.pendingZoomLevel + delta))
    
    if (this.pendingZoomLevel !== oldZoom) {
      // Keep view centered when zooming
      const ratio = oldZoom / this.pendingZoomLevel
      this.panX = 0.5 + (this.panX - 0.5) * ratio
      this.panY = 0.5 + (this.panY - 0.5) * ratio
      
      // Clamp pan
      this.panX = Math.max(0, Math.min(1, this.panX))
      this.panY = Math.max(0, Math.min(1, this.panY))
      
      // Update UI immediately
      const resEl = this.renderer.getRenderable("resolution") as TextRenderable
      if (resEl) {
        const tempWidth = Math.min(1920, Math.round(this.termWidth * 10 * this.pendingZoomLevel))
        const tempHeight = Math.min(1080, Math.round(this.termHeight * 10 * this.pendingZoomLevel))
        const pixels = (tempWidth * tempHeight / 1000).toFixed(0)
        resEl.content = `Capture: ${tempWidth}x${tempHeight} (${pixels}K pixels) | Zoom: ${this.pendingZoomLevel.toFixed(1)}x (pending...)`
        resEl.fg = "#FFFF00" // Yellow to indicate pending
      }
      
      // Schedule restart with debouncing
      this.scheduleRestart()
    }
  }
  
  private pan(dx: number, dy: number) {
    if (this.zoomLevel > 1) {
      const adjustedSpeed = this.panSpeed
      this.panX = Math.max(0, Math.min(1, this.panX + dx * adjustedSpeed))
      this.panY = Math.max(0, Math.min(1, this.panY + dy * adjustedSpeed))
    }
  }
  
  private async resetZoom() {
    if (this.pendingZoomLevel !== 1.0 || this.zoomLevel !== 1.0) {
      this.pendingZoomLevel = 1.0
      this.panX = 0.5
      this.panY = 0.5
      
      // Update UI
      const resEl = this.renderer.getRenderable("resolution") as TextRenderable
      if (resEl) {
        resEl.fg = "#00FFFF" // Reset color
      }
      
      this.scheduleRestart()
    }
  }

  private setupKeyboard() {
    process.stdin.on("data", async (key: Buffer) => {
      const keyStr = key.toString()
      
      switch(keyStr) {
        case '1':
          this.setDisplayMode('pixels')
          break
        case '2':
          this.setDisplayMode('blocks')
          break
        case '3':
          this.setDisplayMode('shades')
          break
        case '4':
          this.setDisplayMode('ascii')
          break
        case '+':
        case '=':
          await this.adjustZoom(0.5)
          break
        case '-':
        case '_':
          await this.adjustZoom(-0.5)
          break
        case '0':
          await this.resetZoom()
          break
        case '\x1b[A': // Up arrow
          this.pan(0, -1)
          break
        case '\x1b[B': // Down arrow
          this.pan(0, 1)
          break
        case '\x1b[C': // Right arrow
          this.pan(1, 0)
          break
        case '\x1b[D': // Left arrow
          this.pan(-1, 0)
          break
        case 'q':
        case 'Q':
        case '\x03': // Ctrl+C
          this.cleanup()
          break
      }
    })
  }

  private cleanup() {
    this.isRestarting = true
    
    // Cancel any pending restarts
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    
    // Kill ffmpeg safely
    if (this.ffmpeg) {
      try {
        this.ffmpeg.stdout?.removeAllListeners()
        this.ffmpeg.stderr?.removeAllListeners()
        this.ffmpeg.removeAllListeners()
        this.ffmpeg.kill('SIGTERM')
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    
    this.renderer.stop()
    process.exit(0)
  }
}

async function main() {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const webcam = new WebcamViewer(renderer)
  webcam.init()
}

main().catch(console.error)