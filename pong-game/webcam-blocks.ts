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
  private frameSize: number
  private videoBuffer: Buffer
  private bufferPos: number = 0
  private frameCount: number = 0
  private fps: number = 0
  private textElements: Map<string, TextRenderable> = new Map()
  private displayMode: 'blocks' | 'shades' | 'ascii' | 'braille' | 'dots' = 'blocks'
  
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
    this.frameSize = this.width * this.height * 3 // RGB
    this.videoBuffer = Buffer.alloc(this.frameSize)
  }

  init() {
    console.log(`Using camera: ${this.camera.name}`);
    console.log(`Terminal size: ${this.width}x${this.height}`);
    console.log('Starting webcam stream...\n');
    console.log('Press 1-5 to change display mode, Q to quit\n');
    
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
      x: this.width - 20,
      y: 0,
      fg: "#00FF00",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(mode)
  }

  private startFFmpeg() {
    this.ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'avfoundation',
      '-framerate', '30',
      '-video_size', '640x480',
      '-i', this.camera.index,
      '-vf', `scale=${this.width}:${this.height}`,
      '-r', '15',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-'
    ])

    this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      this.processVideoData(chunk)
    })

    this.ffmpeg.stderr?.on('data', (data: Buffer) => {
      console.error('FFmpeg:', data.toString())
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
      
      default:
        return this.pixelChar
    }
  }

  private renderFrame() {
    // Update each character position
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = (y * this.width + x) * 3
        const r = this.videoBuffer[idx] || 0
        const g = this.videoBuffer[idx + 1] || 0
        const b = this.videoBuffer[idx + 2] || 0
        
        // Calculate brightness
        const brightness = (r + g + b) / 3
        
        // Get appropriate character based on mode
        const char = this.displayMode === 'blocks' ? this.pixelChar : this.getCharForBrightness(brightness)
        
        // Get text element and update it
        const key = `${x}-${y}`
        const textEl = this.textElements.get(key)
        if (textEl) {
          textEl.content = char
          // Convert RGB to hex color
          const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
          
          if (this.displayMode === 'blocks') {
            // For blocks, use the color directly
            textEl.fg = color
          } else {
            // For other modes, you might want to adjust the color
            textEl.fg = color
          }
        }
      }
    }

    // Update status
    const status = this.renderer.getRenderable("status") as TextRenderable
    if (status) {
      status.content = `${this.camera.name} | ${this.width}x${this.height} | FPS: ${this.fps}`
    }
  }

  private setDisplayMode(mode: typeof this.displayMode) {
    this.displayMode = mode
    const modeEl = this.renderer.getRenderable("mode") as TextRenderable
    if (modeEl) {
      modeEl.content = `Mode: ${mode}`
    }
  }

  private setupKeyboard() {
    this.renderer.on("key", (key: Buffer) => {
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
        case 'q':
        case 'Q':
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
    exitOnCtrlC: true,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const webcam = new WebcamViewer(renderer)
  webcam.init()
}

main().catch(console.error)