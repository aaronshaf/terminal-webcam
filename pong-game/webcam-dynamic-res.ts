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

// Get supported resolutions for camera
function getCameraResolutions(cameraIndex: string): string[] {
  try {
    // Try to get camera capabilities
    const output = execSync(`ffmpeg -f avfoundation -list_formats ${cameraIndex} -i "" 2>&1 || true`, { 
      encoding: 'utf8',
      shell: true 
    });
    
    // Common resolutions to try
    return [
      '1920x1080',
      '1280x720',
      '960x540',
      '640x480',
      '320x240'
    ];
  } catch (e) {
    // Default resolutions
    return ['1280x720', '640x480', '320x240'];
  }
}

class WebcamViewer {
  private renderer: CliRenderer
  private termWidth: number
  private termHeight: number
  private camera: { index: string; name: string }
  private ffmpeg: any
  private videoWidth: number  // Actual video buffer dimensions
  private videoHeight: number
  private captureWidth: number = 640  // Camera capture resolution
  private captureHeight: number = 480
  private frameSize: number
  private videoBuffer: Uint8Array
  private bufferPos: number = 0
  private frameCount: number = 0
  private fps: number = 0
  private textElements: Map<string, TextRenderable> = new Map()
  private displayMode: 'blocks' | 'shades' | 'ascii' | 'braille' | 'dots' | 'pixels' = 'pixels'
  private isRestarting: boolean = false
  private supportedResolutions: string[]
  
  // Zoom settings
  private zoomLevel: number = 1.0  // 1.0 = normal, 2.0 = 2x zoom, etc.
  private zoomX: number = 0.5  // Center X (0-1)
  private zoomY: number = 0.5  // Center Y (0-1)
  private panSpeed: number = 0.05  // How fast to pan
  private lastCaptureScale: number = 1.0  // Track when we need to change capture res
  
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
    
    // Our display buffer size (what we scale video to)
    this.videoWidth = this.termWidth * 2
    this.videoHeight = this.termHeight * 2
    
    this.camera = getFirstCamera()
    this.supportedResolutions = getCameraResolutions(this.camera.index)
    this.updateFrameSize()
  }
  
  private updateFrameSize() {
    this.frameSize = this.videoWidth * this.videoHeight * 3 // RGB24
    this.videoBuffer = new Uint8Array(this.frameSize)
    this.bufferPos = 0
  }
  
  private selectCaptureResolution() {
    // Select capture resolution based on zoom level
    // Higher zoom = higher capture resolution for more detail
    let targetWidth: number
    let targetHeight: number
    
    if (this.zoomLevel >= 4) {
      // Ultra high resolution for 4x+ zoom
      targetWidth = 1920
      targetHeight = 1080
    } else if (this.zoomLevel >= 2.5) {
      // High resolution for 2.5x+ zoom
      targetWidth = 1280
      targetHeight = 720
    } else if (this.zoomLevel >= 1.5) {
      // Medium-high resolution
      targetWidth = 960
      targetHeight = 540
    } else {
      // Standard resolution for normal view
      targetWidth = 640
      targetHeight = 480
    }
    
    // Find the best matching supported resolution
    for (const res of this.supportedResolutions) {
      const [w, h] = res.split('x').map(Number)
      if (w >= targetWidth * 0.8 && h >= targetHeight * 0.8) {
        this.captureWidth = w
        this.captureHeight = h
        return
      }
    }
    
    // Fallback to 640x480 if nothing matches
    this.captureWidth = 640
    this.captureHeight = 480
  }

  init() {
    console.log(`Using camera: ${this.camera.name}`);
    console.log(`Terminal: ${this.termWidth}x${this.termHeight}`);
    console.log(`Display buffer: ${this.videoWidth}x${this.videoHeight}`);
    console.log(`Supported resolutions: ${this.supportedResolutions.join(', ')}`);
    console.log('Starting webcam stream...\n');
    console.log('Controls:');
    console.log('  1-6: Change display mode');
    console.log('  +/-: Zoom in/out (dynamically adjusts camera resolution)');
    console.log('  Arrows: Pan when zoomed');
    console.log('  0: Reset zoom');
    console.log('  R: Force restart camera');
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
      x: this.termWidth - 30,
      y: 0,
      fg: "#00FF00",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(mode)
    
    // Add zoom indicator
    const zoom = new TextRenderable("zoom", {
      content: `Zoom: ${this.zoomLevel.toFixed(1)}x`,
      x: this.termWidth - 45,
      y: 0,
      fg: "#FFFF00",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(zoom)
    
    // Add capture resolution indicator
    const capture = new TextRenderable("capture", {
      content: `Capture: ${this.captureWidth}x${this.captureHeight}`,
      x: 2,
      y: this.termHeight - 1,
      fg: "#00FFFF",
      bg: "#000000",
      zIndex: 10,
    })
    this.renderer.add(capture)
  }

  private async startFFmpeg() {
    // Kill existing ffmpeg if running
    if (this.ffmpeg) {
      this.ffmpeg.kill()
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // Select appropriate capture resolution
    this.selectCaptureResolution()
    
    // Update capture indicator
    const captureEl = this.renderer.getRenderable("capture") as TextRenderable
    if (captureEl) {
      captureEl.content = `Capture: ${this.captureWidth}x${this.captureHeight}`
    }
    
    console.log(`Starting capture at ${this.captureWidth}x${this.captureHeight}...`)
    
    // Start ffmpeg with selected resolution
    this.ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'avfoundation',
      '-framerate', '30',
      '-video_size', `${this.captureWidth}x${this.captureHeight}`,  // Dynamic capture resolution
      '-i', this.camera.index,
      '-vf', `scale=${this.videoWidth}:${this.videoHeight}`,  // Scale to our display buffer
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
      if (!this.isRestarting) {
        console.log(`FFmpeg exited: ${code}`)
        this.cleanup()
      }
    })
    
    this.isRestarting = false
  }
  
  private async restartCameraIfNeeded() {
    // Check if we need to change capture resolution
    const targetScale = this.zoomLevel >= 4 ? 4 : 
                       this.zoomLevel >= 2.5 ? 2.5 : 
                       this.zoomLevel >= 1.5 ? 1.5 : 1.0
    
    if (Math.abs(targetScale - this.lastCaptureScale) > 0.5) {
      this.lastCaptureScale = targetScale
      this.isRestarting = true
      
      // Show restarting message
      const status = this.renderer.getRenderable("status") as TextRenderable
      if (status) {
        status.content = "Restarting camera with higher resolution..."
        status.fg = "#FFFF00"
      }
      
      await this.startFFmpeg()
      
      // Reset status color
      if (status) {
        status.fg = "#FFFFFF"
      }
    }
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
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114)
        
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
            textEl.bg = color
          } else if (this.displayMode === 'blocks' || this.displayMode === 'shades') {
            textEl.fg = color
            textEl.bg = "#000000"
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
      status.content = `${this.camera.name} | FPS: ${this.fps} | Capture: ${this.captureWidth}x${this.captureHeight}`
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
  
  private async adjustZoom(delta: number) {
    const oldZoom = this.zoomLevel
    this.zoomLevel = Math.max(1.0, Math.min(10.0, this.zoomLevel + delta))
    
    // Adjust pan to keep center point stable
    if (this.zoomLevel !== oldZoom) {
      const ratio = oldZoom / this.zoomLevel
      this.zoomX = 0.5 + (this.zoomX - 0.5) * ratio
      this.zoomY = 0.5 + (this.zoomY - 0.5) * ratio
      
      // Ensure we stay in bounds
      this.zoomX = Math.max(0, Math.min(1, this.zoomX))
      this.zoomY = Math.max(0, Math.min(1, this.zoomY))
      
      // Check if we need to restart camera with different resolution
      await this.restartCameraIfNeeded()
    }
  }
  
  private pan(dx: number, dy: number) {
    if (this.zoomLevel > 1) {
      const adjustedSpeed = this.panSpeed / this.zoomLevel
      this.zoomX = Math.max(0, Math.min(1, this.zoomX + dx * adjustedSpeed))
      this.zoomY = Math.max(0, Math.min(1, this.zoomY + dy * adjustedSpeed))
    }
  }
  
  private async resetZoom() {
    this.zoomLevel = 1.0
    this.zoomX = 0.5
    this.zoomY = 0.5
    await this.restartCameraIfNeeded()
  }

  private setupKeyboard() {
    // Use process.stdin directly for better key handling
    process.stdin.on("data", async (key: Buffer) => {
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
          await this.adjustZoom(0.5)
          break
        case '-':
        case '_':
          await this.adjustZoom(-0.5)
          break
        case '0':
          await this.resetZoom()
          break
        case 'r':
        case 'R':
          this.isRestarting = true
          await this.startFFmpeg()
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