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
  private width: number
  private height: number
  private camera: { index: string; name: string }
  private ffmpeg: any
  private videoWidth: number = 640  // Source video dimensions
  private videoHeight: number = 480
  private frameSize: number
  private videoBuffer: Buffer
  private bufferPos: number = 0
  private frameCount: number = 0
  private fps: number = 0
  private textElements: Map<string, TextRenderable> = new Map()
  private displayMode: 'blocks' | 'shades' | 'ascii' | 'braille' | 'dots' | 'pixels' = 'blocks'
  
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
    this.width = renderer.terminalWidth
    this.height = renderer.terminalHeight
    this.camera = getFirstCamera()
    this.frameSize = this.videoWidth * this.videoHeight * 3 // RGB
    this.videoBuffer = Buffer.alloc(this.frameSize)
  }

  init() {
    console.log(`Using camera: ${this.camera.name}`);
    console.log(`Terminal size: ${this.width}x${this.height}`);
    console.log(`Video resolution: ${this.videoWidth}x${this.videoHeight}`);
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
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
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
      x: this.width - 25,
      y: 0,
      fg: "#00FF00",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(mode)
    
    // Add zoom indicator
    const zoom = new TextRenderable("zoom", {
      content: `Zoom: ${this.zoomLevel.toFixed(1)}x`,
      x: this.width - 35,
      y: 0,
      fg: "#FFFF00",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(zoom)
  }

  private startFFmpeg() {
    this.ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'avfoundation',
      '-framerate', '30',
      '-video_size', `${this.videoWidth}x${this.videoHeight}`,
      '-i', this.camera.index,
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
      if (!error.includes('Capture buffer')) {
        console.error('FFmpeg:', error)
      }
    })

    this.ffmpeg.on('exit', (code: number) => {
      console.log(`FFmpeg exited: ${code}`)
      this.renderer.stop()
      process.exit(0)
    })
  }

  private processVideoData(chunk: Buffer) {
    let offset = 0
    
    while (offset < chunk.length) {
      const toRead = Math.min(this.frameSize - this.bufferPos, chunk.length - offset)
      chunk.copy(this.videoBuffer, this.bufferPos, offset, offset + toRead)
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
    const normalizedBrightness = brightness / 255
    
    switch (this.displayMode) {
      case 'blocks':
        const blockIdx = Math.floor(normalizedBrightness * (this.blockChars.length - 1))
        return this.blockChars[Math.max(0, Math.min(blockIdx, this.blockChars.length - 1))]
      
      case 'shades':
        const shadeIdx = Math.floor(normalizedBrightness * (this.shadeChars.length - 1))
        return this.shadeChars[Math.max(0, Math.min(shadeIdx, this.shadeChars.length - 1))]
      
      case 'ascii':
        const asciiIdx = Math.floor(normalizedBrightness * (this.asciiChars.length - 1))
        return this.asciiChars[Math.max(0, Math.min(asciiIdx, this.asciiChars.length - 1))]
      
      case 'braille':
        const brailleIdx = Math.floor(normalizedBrightness * (this.brailleChars.length - 1))
        return this.brailleChars[Math.max(0, Math.min(brailleIdx, this.brailleChars.length - 1))]
      
      case 'dots':
        const dotIdx = Math.floor(normalizedBrightness * (this.dotChars.length - 1))
        return this.dotChars[Math.max(0, Math.min(dotIdx, this.dotChars.length - 1))]
      
      case 'pixels':
        return this.pixelChar
        
      default:
        return this.pixelChar
    }
  }
  
  private sampleVideoBuffer(x: number, y: number): { r: number, g: number, b: number } {
    // Calculate the area to sample based on zoom
    const viewWidth = this.videoWidth / this.zoomLevel
    const viewHeight = this.videoHeight / this.zoomLevel
    
    // Calculate top-left corner of zoomed area
    const startX = Math.floor((this.videoWidth - viewWidth) * this.zoomX)
    const startY = Math.floor((this.videoHeight - viewHeight) * this.zoomY)
    
    // Map terminal coordinates to video coordinates
    const videoX = Math.floor(startX + (x / this.width) * viewWidth)
    const videoY = Math.floor(startY + (y / this.height) * viewHeight)
    
    // Clamp to video bounds
    const clampedX = Math.max(0, Math.min(videoX, this.videoWidth - 1))
    const clampedY = Math.max(0, Math.min(videoY, this.videoHeight - 1))
    
    // Get pixel from video buffer
    const idx = (clampedY * this.videoWidth + clampedX) * 3
    
    // For higher zoom levels, we can average nearby pixels for smoother result
    if (this.zoomLevel > 2) {
      let r = 0, g = 0, b = 0, count = 0
      const sampleRadius = Math.ceil(this.zoomLevel / 2)
      
      for (let dy = -sampleRadius; dy <= sampleRadius; dy++) {
        for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
          const sx = Math.max(0, Math.min(clampedX + dx, this.videoWidth - 1))
          const sy = Math.max(0, Math.min(clampedY + dy, this.videoHeight - 1))
          const sidx = (sy * this.videoWidth + sx) * 3
          
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
    if (idx + 2 < this.videoBuffer.length) {
      return {
        r: this.videoBuffer[idx] || 0,
        g: this.videoBuffer[idx + 1] || 0,
        b: this.videoBuffer[idx + 2] || 0
      }
    }
    
    return { r: 0, g: 0, b: 0 }
  }

  private renderFrame() {
    // Update each character position
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // Sample video with zoom
        const { r, g, b } = this.sampleVideoBuffer(x, y)
        
        // Calculate brightness
        const brightness = (r + g + b) / 3
        
        // Get appropriate character based on mode
        const char = this.displayMode === 'pixels' ? this.pixelChar : this.getCharForBrightness(brightness)
        
        // Get text element and update it
        const key = `${x}-${y}`
        const textEl = this.textElements.get(key)
        if (textEl) {
          textEl.content = char
          // Convert RGB to hex color
          const color = `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`
          
          if (this.displayMode === 'pixels' || this.displayMode === 'blocks') {
            // For blocks/pixels, use the color directly
            textEl.fg = color
          } else {
            // For other modes, use color with character
            textEl.fg = color
          }
        }
      }
    }

    // Update status
    const status = this.renderer.getRenderable("status") as TextRenderable
    if (status) {
      const effectiveRes = `${Math.round(this.videoWidth/this.zoomLevel)}x${Math.round(this.videoHeight/this.zoomLevel)}`
      status.content = `${this.camera.name} | ${effectiveRes} | FPS: ${this.fps}`
    }
    
    // Update zoom indicator
    const zoom = this.renderer.getRenderable("zoom") as TextRenderable
    if (zoom) {
      zoom.content = `Zoom: ${this.zoomLevel.toFixed(1)}x`
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
    this.zoomLevel = Math.max(1.0, Math.min(10.0, this.zoomLevel + delta))
  }
  
  private pan(dx: number, dy: number) {
    if (this.zoomLevel > 1) {
      this.zoomX = Math.max(0, Math.min(1, this.zoomX + dx * this.panSpeed / this.zoomLevel))
      this.zoomY = Math.max(0, Math.min(1, this.zoomY + dy * this.panSpeed / this.zoomLevel))
    }
  }
  
  private resetZoom() {
    this.zoomLevel = 1.0
    this.zoomX = 0.5
    this.zoomY = 0.5
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