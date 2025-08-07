#!/usr/bin/env bun
import {
  createCliRenderer,
  TextRenderable,
  type CliRenderer,
  RGBA,
} from "@opentui/core"
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
  private videoWidth: number  // Actual video buffer dimensions
  private videoHeight: number
  private frameSize: number
  private videoBuffer: Uint8Array
  private bufferPos: number = 0
  private frameCount: number = 0
  private fps: number = 0
  private textElements: Map<string, TextRenderable> = new Map()
  private displayMode: 'blocks' | 'shades' | 'ascii' | 'braille' | 'dots' | 'pixels' = 'pixels'
  
  // Zoom settings
  private zoomLevel: number = 1.0  // 1.0 = normal, 2.0 = 2x zoom, etc.
  private zoomX: number = 0.5  // Center X (0-1)
  private zoomY: number = 0.5  // Center Y (0-1)
  private panSpeed: number = 0.05  // How fast to pan
  
  // Different character sets for different styles
  private readonly blockChars = ' ▁▂▃▄▅▆▇█'  // Vertical blocks
  private readonly shadeChars = ' ░▒▓█'      // Shading blocks
  private readonly asciiChars = ' .,:;ox%#@' // Classic ASCII
  private readonly brailleChars = ' ⡀⡄⡆⡇⣇⣧⣷⣿'  // Braille patterns
  private readonly dotChars = ' ·∙●○◐◑◒◓◔◕◖◗◌◍◎◉'  // Dots and circles
  private readonly pixelChar = '█'  // Full block for pixel mode
  
  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.termWidth = renderer.terminalWidth
    this.termHeight = renderer.terminalHeight
    
    // Scale video to reasonable size while maintaining aspect
    // This matches what ffmpeg will output
    this.videoWidth = this.termWidth * 2  // Higher res for better quality
    this.videoHeight = this.termHeight * 2
    
    this.camera = getFirstCamera()
    this.frameSize = this.videoWidth * this.videoHeight * 3 // RGB24
    this.videoBuffer = new Uint8Array(this.frameSize)
  }

  init() {
    console.log(`Using camera: ${this.camera.name}`);
    console.log(`Terminal: ${this.termWidth}x${this.termHeight}`);
    console.log(`Video buffer: ${this.videoWidth}x${this.videoHeight}`);
    console.log('Starting webcam stream...\n');
    console.log('Controls:');
    console.log('  1-6: Change display mode');
    console.log('  +/-: Zoom in/out');
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

    // Start ffmpeg
    this.startFFmpeg()

    // Setup keyboard
    this.setupKeyboard()
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
      zIndex: 10,
    })
    this.renderer.add(status)

    // Add mode indicator
    const mode = new TextRenderable("mode", {
      content: `Mode: ${this.displayMode}`,
      x: this.termWidth - 25,
      y: 0,
      fg: "#00FF00",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(mode)
    
    // Add zoom indicator
    const zoom = new TextRenderable("zoom", {
      content: `Zoom: ${this.zoomLevel.toFixed(1)}x`,
      x: this.termWidth - 35,
      y: 0,
      fg: "#FFFF00",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(zoom)
    
    // Add help text
    const help = new TextRenderable("help", {
      content: "Press H for help",
      x: 2,
      y: this.termHeight - 1,
      fg: "#888888",
      bg: "#000000",
      zIndex: 10,
    })
    this.renderer.add(help)
  }

  private startFFmpeg() {
    // Request video at the exact size we need
    this.ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'avfoundation',
      '-framerate', '30',
      '-video_size', '640x480',  // Input from camera
      '-i', this.camera.index,
      '-vf', `scale=${this.videoWidth}:${this.videoHeight}`,  // Scale to our buffer size
      '-r', '15',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-'
    ])

    this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      this.processVideoData(chunk)
    })

    this.ffmpeg.stderr?.on('data', (data: Buffer) => {
      const error = data.toString()
      if (!error.includes('Capture buffer') && !error.includes('VIDIOC')) {
        console.error('FFmpeg:', error)
      }
    })

    this.ffmpeg.on('exit', (code: number) => {
      console.log(`FFmpeg exited: ${code}`)
      this.cleanup()
    })
  }

  private processVideoData(chunk: Buffer) {
    let offset = 0
    
    while (offset < chunk.length && this.bufferPos < this.frameSize) {
      const toRead = Math.min(this.frameSize - this.bufferPos, chunk.length - offset)
      
      // Copy data to our buffer
      for (let i = 0; i < toRead; i++) {
        this.videoBuffer[this.bufferPos + i] = chunk[offset + i]
      }
      
      this.bufferPos += toRead
      offset += toRead
      
      if (this.bufferPos >= this.frameSize) {
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
      
      case 'braille':
        const brailleIdx = Math.floor(normalizedBrightness * (this.brailleChars.length - 1))
        return this.brailleChars[brailleIdx]
      
      case 'dots':
        const dotIdx = Math.floor(normalizedBrightness * (this.dotChars.length - 1))
        return this.dotChars[dotIdx]
      
      case 'pixels':
        return this.pixelChar
        
      default:
        return this.pixelChar
    }
  }
  
  private sampleVideoPixel(termX: number, termY: number): { r: number, g: number, b: number } {
    // Calculate the zoomed viewport
    const viewWidth = this.videoWidth / this.zoomLevel
    const viewHeight = this.videoHeight / this.zoomLevel
    
    // Calculate top-left corner of zoomed area
    const startX = (this.videoWidth - viewWidth) * this.zoomX
    const startY = (this.videoHeight - viewHeight) * this.zoomY
    
    // Map terminal coordinates to video coordinates
    const videoX = Math.floor(startX + (termX / this.termWidth) * viewWidth)
    const videoY = Math.floor(startY + (termY / this.termHeight) * viewHeight)
    
    // Clamp to video bounds
    const x = Math.max(0, Math.min(videoX, this.videoWidth - 1))
    const y = Math.max(0, Math.min(videoY, this.videoHeight - 1))
    
    // Calculate buffer index (RGB24 format)
    const idx = (y * this.videoWidth + x) * 3
    
    if (idx + 2 < this.videoBuffer.length) {
      return {
        r: this.videoBuffer[idx],
        g: this.videoBuffer[idx + 1],
        b: this.videoBuffer[idx + 2]
      }
    }
    
    return { r: 0, g: 0, b: 0 }
  }

  private renderFrame() {
    // Update each character position
    for (let y = 0; y < this.termHeight; y++) {
      for (let x = 0; x < this.termWidth; x++) {
        // Sample video with zoom
        const { r, g, b } = this.sampleVideoPixel(x, y)
        
        // Calculate brightness for character selection
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114) // Proper luminance calculation
        
        // Get appropriate character based on mode
        const char = this.getCharForBrightness(brightness)
        
        // Get text element and update it
        const key = `${x}-${y}`
        const textEl = this.textElements.get(key)
        if (textEl) {
          textEl.content = char
          
          // Convert RGB to hex color
          const toHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0')
          const color = `#${toHex(r)}${toHex(g)}${toHex(b)}`
          
          // Set color based on display mode
          if (this.displayMode === 'pixels') {
            textEl.fg = color
            textEl.bg = color  // For solid blocks
          } else if (this.displayMode === 'blocks' || this.displayMode === 'shades') {
            textEl.fg = color
            textEl.bg = "#000000"
          } else {
            // For ASCII and others, use color but might want to adjust brightness
            textEl.fg = color
            textEl.bg = "#000000"
          }
        }
      }
    }

    // Update status
    const status = this.renderer.getRenderable("status") as TextRenderable
    if (status) {
      const effectiveRes = `${Math.round(this.videoWidth/this.zoomLevel)}x${Math.round(this.videoHeight/this.zoomLevel)}`
      status.content = `${this.camera.name} | View: ${effectiveRes} | FPS: ${this.fps}`
    }
    
    // Update zoom indicator
    const zoom = this.renderer.getRenderable("zoom") as TextRenderable
    if (zoom) {
      const zoomText = this.zoomLevel === 1 ? "1.0x" : `${this.zoomLevel.toFixed(1)}x`
      const panText = this.zoomLevel > 1 ? ` [${Math.round(this.zoomX*100)}%,${Math.round(this.zoomY*100)}%]` : ""
      zoom.content = `Zoom: ${zoomText}${panText}`
    }
  }

  private setDisplayMode(mode: typeof this.displayMode) {
    this.displayMode = mode
    const modeEl = this.renderer.getRenderable("mode") as TextRenderable
    if (modeEl) {
      modeEl.content = `Mode: ${mode}`
    }
  }
  
  private adjustZoom(delta: number) {
    const oldZoom = this.zoomLevel
    this.zoomLevel = Math.max(1.0, Math.min(10.0, this.zoomLevel + delta))
    
    // Adjust pan to keep center point stable
    if (this.zoomLevel !== oldZoom) {
      // Keep the center of view stable when zooming
      const ratio = oldZoom / this.zoomLevel
      this.zoomX = 0.5 + (this.zoomX - 0.5) * ratio
      this.zoomY = 0.5 + (this.zoomY - 0.5) * ratio
      
      // Ensure we stay in bounds
      this.zoomX = Math.max(0, Math.min(1, this.zoomX))
      this.zoomY = Math.max(0, Math.min(1, this.zoomY))
    }
  }
  
  private pan(dx: number, dy: number) {
    if (this.zoomLevel > 1) {
      const adjustedSpeed = this.panSpeed / this.zoomLevel
      this.zoomX = Math.max(0, Math.min(1, this.zoomX + dx * adjustedSpeed))
      this.zoomY = Math.max(0, Math.min(1, this.zoomY + dy * adjustedSpeed))
    }
  }
  
  private resetZoom() {
    this.zoomLevel = 1.0
    this.zoomX = 0.5
    this.zoomY = 0.5
  }
  
  private showHelp() {
    const help = this.renderer.getRenderable("help") as TextRenderable
    if (help) {
      if (help.content === "Press H for help") {
        help.content = "1-6:Mode +/-:Zoom Arrows:Pan 0:Reset Q:Quit H:Hide"
        help.fg = "#FFFF00"
      } else {
        help.content = "Press H for help"
        help.fg = "#888888"
      }
    }
  }

  private setupKeyboard() {
    // Use process.stdin directly for better key handling
    process.stdin.on("data", (key: Buffer) => {
      const keyStr = key.toString()
      
      switch(keyStr) {
        case '1':
          this.setDisplayMode('blocks')
          break
        case '2':
          this.setDisplayMode('shades')
          break
        case '3':
          this.setDisplayMode('ascii')
          break
        case '4':
          this.setDisplayMode('braille')
          break
        case '5':
          this.setDisplayMode('dots')
          break
        case '6':
          this.setDisplayMode('pixels')
          break
        case '+':
        case '=':
          this.adjustZoom(0.5)
          break
        case '-':
        case '_':
          this.adjustZoom(-0.5)
          break
        case '0':
          this.resetZoom()
          break
        case 'h':
        case 'H':
          this.showHelp()
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
    if (this.ffmpeg) {
      this.ffmpeg.kill()
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