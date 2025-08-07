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

type Filter = 'none' | 'edge' | 'negative' | 'sepia' | 'blackwhite' | 'pixelate' | 'blur' | 'matrix' | 'thermal'

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
  private displayMode: 'blocks' | 'shades' | 'ascii' = 'blocks'
  private currentFilter: Filter = 'none'
  private filterIndex: number = 0
  private filters: Filter[] = ['none', 'edge', 'negative', 'sepia', 'blackwhite', 'pixelate', 'blur', 'matrix', 'thermal']
  private keyHandler: ((key: Buffer) => void) | null = null
  
  // Character sets
  private readonly shadeChars = ' ░▒▓█'
  private readonly asciiChars = ' .,:;ox%#@'
  private readonly pixelChar = '█'
  
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
    console.log('\n=== WEBCAM FILTERS ===');
    console.log('F: Next filter | D: Previous filter');
    console.log('M: Change display mode | Q: Quit\n');
    
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

    // Setup keyboard with process.stdin like space.ts does
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

    // Add status bar elements
    const status = new TextRenderable("status", {
      content: `FPS: 0`,
      x: 2,
      y: 0,
      fg: "#FFFFFF",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(status)

    const filter = new TextRenderable("filter", {
      content: `Filter: none`,
      x: Math.floor(this.width / 2) - 10,
      y: 0,
      fg: "#00FF00",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(filter)

    const mode = new TextRenderable("mode", {
      content: `Mode: blocks`,
      x: this.width - 15,
      y: 0,
      fg: "#FFFF00",
      bg: "#333333",
      zIndex: 10,
    })
    this.renderer.add(mode)

    const help = new TextRenderable("help", {
      content: `[F]ilter [D]Prev [M]ode [Q]uit`,
      x: Math.floor(this.width / 2) - 15,
      y: this.height - 1,
      fg: "#888888",
      bg: "#222222",
      zIndex: 10,
    })
    this.renderer.add(help)
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
      this.cleanup()
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
        this.applyFilter()
        this.renderFrame()
        this.bufferPos = 0
        this.frameCount++
      }
    }
  }

  private applyFilter() {
    switch (this.currentFilter) {
      case 'edge':
        this.applyEdgeDetection()
        break
      case 'negative':
        this.applyNegative()
        break
      case 'sepia':
        this.applySepia()
        break
      case 'blackwhite':
        this.applyBlackWhite()
        break
      case 'pixelate':
        this.applyPixelate()
        break
      case 'blur':
        this.applyBlur()
        break
      case 'matrix':
        this.applyMatrix()
        break
      case 'thermal':
        this.applyThermal()
        break
    }
  }

  private applyEdgeDetection() {
    const newBuffer = Buffer.alloc(this.frameSize)
    
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const idx = (y * this.width + x) * 3
        
        let gx = 0, gy = 0
        
        for (let c = 0; c < 3; c++) {
          gx += -this.videoBuffer[((y-1) * this.width + (x-1)) * 3 + c]
          gx += -2 * this.videoBuffer[(y * this.width + (x-1)) * 3 + c]
          gx += -this.videoBuffer[((y+1) * this.width + (x-1)) * 3 + c]
          gx += this.videoBuffer[((y-1) * this.width + (x+1)) * 3 + c]
          gx += 2 * this.videoBuffer[(y * this.width + (x+1)) * 3 + c]
          gx += this.videoBuffer[((y+1) * this.width + (x+1)) * 3 + c]
          
          gy += -this.videoBuffer[((y-1) * this.width + (x-1)) * 3 + c]
          gy += -2 * this.videoBuffer[((y-1) * this.width + x) * 3 + c]
          gy += -this.videoBuffer[((y-1) * this.width + (x+1)) * 3 + c]
          gy += this.videoBuffer[((y+1) * this.width + (x-1)) * 3 + c]
          gy += 2 * this.videoBuffer[((y+1) * this.width + x) * 3 + c]
          gy += this.videoBuffer[((y+1) * this.width + (x+1)) * 3 + c]
        }
        
        const magnitude = Math.sqrt(gx * gx + gy * gy) / 3
        const edge = Math.min(255, magnitude)
        
        newBuffer[idx] = edge
        newBuffer[idx + 1] = edge
        newBuffer[idx + 2] = edge
      }
    }
    
    newBuffer.copy(this.videoBuffer)
  }

  private applyNegative() {
    for (let i = 0; i < this.frameSize; i++) {
      this.videoBuffer[i] = 255 - this.videoBuffer[i]
    }
  }

  private applySepia() {
    for (let i = 0; i < this.frameSize; i += 3) {
      const r = this.videoBuffer[i]
      const g = this.videoBuffer[i + 1]
      const b = this.videoBuffer[i + 2]
      
      this.videoBuffer[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189))
      this.videoBuffer[i + 1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168))
      this.videoBuffer[i + 2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131))
    }
  }

  private applyBlackWhite() {
    for (let i = 0; i < this.frameSize; i += 3) {
      const gray = (this.videoBuffer[i] + this.videoBuffer[i + 1] + this.videoBuffer[i + 2]) / 3
      const bw = gray > 128 ? 255 : 0
      this.videoBuffer[i] = bw
      this.videoBuffer[i + 1] = bw
      this.videoBuffer[i + 2] = bw
    }
  }

  private applyPixelate() {
    const blockSize = 3
    
    for (let y = 0; y < this.height; y += blockSize) {
      for (let x = 0; x < this.width; x += blockSize) {
        let r = 0, g = 0, b = 0, count = 0
        
        for (let dy = 0; dy < blockSize && y + dy < this.height; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < this.width; dx++) {
            const idx = ((y + dy) * this.width + (x + dx)) * 3
            r += this.videoBuffer[idx]
            g += this.videoBuffer[idx + 1]
            b += this.videoBuffer[idx + 2]
            count++
          }
        }
        
        r = Math.floor(r / count)
        g = Math.floor(g / count)
        b = Math.floor(b / count)
        
        for (let dy = 0; dy < blockSize && y + dy < this.height; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < this.width; dx++) {
            const idx = ((y + dy) * this.width + (x + dx)) * 3
            this.videoBuffer[idx] = r
            this.videoBuffer[idx + 1] = g
            this.videoBuffer[idx + 2] = b
          }
        }
      }
    }
  }

  private applyBlur() {
    const newBuffer = Buffer.alloc(this.frameSize)
    
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        const idx = (y * this.width + x) * 3
        
        for (let c = 0; c < 3; c++) {
          let sum = 0
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              sum += this.videoBuffer[((y + dy) * this.width + (x + dx)) * 3 + c]
            }
          }
          newBuffer[idx + c] = Math.floor(sum / 9)
        }
      }
    }
    
    newBuffer.copy(this.videoBuffer)
  }

  private applyMatrix() {
    for (let i = 0; i < this.frameSize; i += 3) {
      const brightness = (this.videoBuffer[i] + this.videoBuffer[i + 1] + this.videoBuffer[i + 2]) / 3
      this.videoBuffer[i] = 0
      this.videoBuffer[i + 1] = brightness
      this.videoBuffer[i + 2] = 0
    }
  }

  private applyThermal() {
    for (let i = 0; i < this.frameSize; i += 3) {
      const brightness = (this.videoBuffer[i] + this.videoBuffer[i + 1] + this.videoBuffer[i + 2]) / 3
      const heat = brightness / 255
      
      if (heat < 0.33) {
        this.videoBuffer[i] = 0
        this.videoBuffer[i + 1] = Math.floor(heat * 3 * 255)
        this.videoBuffer[i + 2] = 255
      } else if (heat < 0.66) {
        const t = (heat - 0.33) * 3
        this.videoBuffer[i] = Math.floor(t * 255)
        this.videoBuffer[i + 1] = 255
        this.videoBuffer[i + 2] = Math.floor((1 - t) * 255)
      } else {
        const t = (heat - 0.66) * 3
        this.videoBuffer[i] = 255
        this.videoBuffer[i + 1] = Math.floor((1 - t) * 255)
        this.videoBuffer[i + 2] = 0
      }
    }
  }

  private getCharForBrightness(brightness: number): string {
    const normalizedBrightness = brightness / 255
    
    switch (this.displayMode) {
      case 'blocks':
        return this.pixelChar
      
      case 'shades':
        const shadeIdx = Math.floor(normalizedBrightness * (this.shadeChars.length - 1))
        return this.shadeChars[Math.max(0, Math.min(shadeIdx, this.shadeChars.length - 1))]
      
      case 'ascii':
        const asciiIdx = Math.floor(normalizedBrightness * (this.asciiChars.length - 1))
        return this.asciiChars[Math.max(0, Math.min(asciiIdx, this.asciiChars.length - 1))]
      
      default:
        return this.pixelChar
    }
  }

  private renderFrame() {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = (y * this.width + x) * 3
        const r = this.videoBuffer[idx] || 0
        const g = this.videoBuffer[idx + 1] || 0
        const b = this.videoBuffer[idx + 2] || 0
        
        const brightness = (r + g + b) / 3
        const char = this.getCharForBrightness(brightness)
        
        const key = `${x}-${y}`
        const textEl = this.textElements.get(key)
        if (textEl) {
          textEl.content = char
          const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
          textEl.fg = color
        }
      }
    }

    const status = this.renderer.getRenderable("status") as TextRenderable
    if (status) {
      status.content = `FPS: ${this.fps}`
    }
  }

  private nextFilter() {
    this.filterIndex = (this.filterIndex + 1) % this.filters.length
    this.currentFilter = this.filters[this.filterIndex]
    
    const filterEl = this.renderer.getRenderable("filter") as TextRenderable
    if (filterEl) {
      filterEl.content = `Filter: ${this.currentFilter}`
    }
  }

  private prevFilter() {
    this.filterIndex = this.filterIndex - 1
    if (this.filterIndex < 0) this.filterIndex = this.filters.length - 1
    this.currentFilter = this.filters[this.filterIndex]
    
    const filterEl = this.renderer.getRenderable("filter") as TextRenderable
    if (filterEl) {
      filterEl.content = `Filter: ${this.currentFilter}`
    }
  }

  private cycleDisplayMode() {
    const modes: Array<'blocks' | 'shades' | 'ascii'> = ['blocks', 'shades', 'ascii']
    const currentIndex = modes.indexOf(this.displayMode)
    this.displayMode = modes[(currentIndex + 1) % modes.length]
    
    const modeEl = this.renderer.getRenderable("mode") as TextRenderable
    if (modeEl) {
      modeEl.content = `Mode: ${this.displayMode}`
    }
  }

  private setupKeyboard() {
    // Use process.stdin directly like space.ts does
    this.keyHandler = (key: Buffer) => {
      const keyStr = key.toString()
      
      // Handle both lowercase and uppercase
      if (keyStr === 'f' || keyStr === 'F') {
        this.nextFilter()
      } else if (keyStr === 'd' || keyStr === 'D') {
        this.prevFilter()
      } else if (keyStr === 'm' || keyStr === 'M') {
        this.cycleDisplayMode()
      } else if (keyStr === 'q' || keyStr === 'Q' || keyStr === '\u0003') {
        this.cleanup()
      }
    }
    
    process.stdin.on("data", this.keyHandler)
  }

  private cleanup() {
    if (this.keyHandler) {
      process.stdin.removeListener("data", this.keyHandler)
    }
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