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

type Filter = 'none' | 'edge' | 'negative' | 'sepia' | 'blackwhite' | 'pixelate' | 'blur' | 'matrix' | 'thermal' | 'stickfigure'

interface Blob {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  pixels: number
}

interface StickFigure {
  head: { x: number, y: number, size: number }
  torso: { startY: number, endY: number }
  leftArm: { x: number, y: number }
  rightArm: { x: number, y: number }
  leftLeg: { x: number, y: number }
  rightLeg: { x: number, y: number }
  centerX: number
}

class WebcamViewer {
  private renderer: CliRenderer
  private width: number
  private height: number
  private camera: { index: string; name: string }
  private ffmpeg: any
  private frameSize: number
  private videoBuffer: Buffer
  private processedBuffer: Buffer
  private bufferPos: number = 0
  private frameCount: number = 0
  private fps: number = 0
  private textElements: Map<string, TextRenderable> = new Map()
  private displayMode: 'blocks' | 'shades' | 'ascii' | 'stickfigure' = 'blocks'
  private currentFilter: Filter = 'none'
  private filterIndex: number = 0
  private filters: Filter[] = ['none', 'edge', 'negative', 'sepia', 'blackwhite', 'pixelate', 'blur', 'matrix', 'thermal', 'stickfigure']
  private keyHandler: ((key: Buffer) => void) | null = null
  private detectedFigures: StickFigure[] = []
  
  // Character sets
  private readonly shadeChars = ' ░▒▓█'
  private readonly asciiChars = ' .,:;ox%#@'
  private readonly pixelChar = '█'
  
  // Stick figure characters
  private readonly stickChars = {
    head: 'O',
    body: '|',
    armDiag: '/',
    armDiagBack: '\\',
    armHoriz: '-',
    leg: '/',
    legBack: '\\',
    joint: '+'
  }
  
  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.width = renderer.terminalWidth
    this.height = renderer.terminalHeight
    this.camera = getFirstCamera()
    this.frameSize = this.width * this.height * 3 // RGB
    this.videoBuffer = Buffer.alloc(this.frameSize)
    this.processedBuffer = Buffer.alloc(this.frameSize)
  }

  init() {
    console.log(`Using camera: ${this.camera.name}`);
    console.log(`Terminal size: ${this.width}x${this.height}`);
    console.log('\n=== WEBCAM FILTERS + STICK FIGURE ===');
    console.log('F: Next filter | D: Previous filter');
    console.log('M: Change display mode | S: Stick figure mode');
    console.log('Q: Quit\n');
    
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
      x: this.width - 20,
      y: 0,
      fg: "#FFFF00",
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
        // Copy to processed buffer
        this.videoBuffer.copy(this.processedBuffer)
        
        // Apply filter
        this.applyFilter()
        
        // Detect stick figures if in that mode
        if (this.currentFilter === 'stickfigure' || this.displayMode === 'stickfigure') {
          this.detectHumanFigures()
        }
        
        // Render
        this.renderFrame()
        this.bufferPos = 0
        this.frameCount++
      }
    }
  }

  private detectHumanFigures() {
    this.detectedFigures = []
    
    // Simple blob detection for human-like shapes
    const threshold = 100 // Brightness threshold
    const minBlobSize = (this.width * this.height) / 100 // Minimum 1% of screen
    const maxBlobSize = (this.width * this.height) / 4 // Maximum 25% of screen
    
    // Create binary image
    const binary = new Uint8Array(this.width * this.height)
    for (let i = 0; i < this.width * this.height; i++) {
      const idx = i * 3
      const brightness = (this.processedBuffer[idx] + this.processedBuffer[idx + 1] + this.processedBuffer[idx + 2]) / 3
      binary[i] = brightness > threshold ? 1 : 0
    }
    
    // Find connected components (blobs)
    const blobs = this.findBlobs(binary)
    
    // Filter blobs by size and aspect ratio (human-like)
    const humanBlobs = blobs.filter(blob => {
      const aspectRatio = blob.height / blob.width
      return blob.pixels > minBlobSize && 
             blob.pixels < maxBlobSize &&
             aspectRatio > 1.5 && aspectRatio < 4 // Humans are taller than wide
    })
    
    // Convert blobs to stick figures
    for (const blob of humanBlobs) {
      const figure = this.blobToStickFigure(blob)
      if (figure) {
        this.detectedFigures.push(figure)
      }
    }
  }

  private findBlobs(binary: Uint8Array): Blob[] {
    const visited = new Uint8Array(this.width * this.height)
    const blobs: Blob[] = []
    
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = y * this.width + x
        
        if (binary[idx] === 1 && visited[idx] === 0) {
          // Start flood fill
          const blob = this.floodFill(binary, visited, x, y)
          if (blob.pixels > 0) {
            blobs.push(blob)
          }
        }
      }
    }
    
    return blobs
  }

  private floodFill(binary: Uint8Array, visited: Uint8Array, startX: number, startY: number): Blob {
    const stack: [number, number][] = [[startX, startY]]
    let minX = startX, maxX = startX
    let minY = startY, maxY = startY
    let pixels = 0
    let sumX = 0, sumY = 0
    
    while (stack.length > 0) {
      const [x, y] = stack.pop()!
      const idx = y * this.width + x
      
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue
      if (visited[idx] === 1 || binary[idx] === 0) continue
      
      visited[idx] = 1
      pixels++
      sumX += x
      sumY += y
      
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      
      // Add neighbors
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1])
    }
    
    return {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      centerX: Math.floor(sumX / pixels),
      centerY: Math.floor(sumY / pixels),
      pixels
    }
  }

  private blobToStickFigure(blob: Blob): StickFigure | null {
    // Estimate body parts based on blob proportions
    const headSize = Math.max(2, Math.floor(blob.width / 4))
    const headY = blob.y + headSize
    
    // Assume head is at top 20% of blob
    const torsoStart = blob.y + Math.floor(blob.height * 0.2)
    const torsoEnd = blob.y + Math.floor(blob.height * 0.6)
    
    // Arms at 30% height
    const armY = blob.y + Math.floor(blob.height * 0.3)
    const armSpread = Math.floor(blob.width / 2)
    
    // Legs at bottom
    const legY = blob.y + blob.height - 1
    const legSpread = Math.floor(blob.width / 3)
    
    return {
      head: { x: blob.centerX, y: headY, size: headSize },
      torso: { startY: torsoStart, endY: torsoEnd },
      leftArm: { x: blob.centerX - armSpread, y: armY },
      rightArm: { x: blob.centerX + armSpread, y: armY },
      leftLeg: { x: blob.centerX - legSpread, y: legY },
      rightLeg: { x: blob.centerX + legSpread, y: legY },
      centerX: blob.centerX
    }
  }

  private drawStickFigure(figure: StickFigure) {
    // Clear area first with dimmed video
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = (y * this.width + x) * 3
        const r = Math.floor(this.processedBuffer[idx] * 0.3)
        const g = Math.floor(this.processedBuffer[idx + 1] * 0.3)
        const b = Math.floor(this.processedBuffer[idx + 2] * 0.3)
        
        const key = `${x}-${y}`
        const textEl = this.textElements.get(key)
        if (textEl) {
          textEl.content = ' '
          const color = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
          textEl.fg = color
        }
      }
    }
    
    // Draw stick figure in bright color
    const figureColor = '#00FF00'
    
    // Draw head
    this.setChar(figure.centerX, figure.head.y, this.stickChars.head, figureColor)
    
    // Draw torso
    for (let y = figure.torso.startY; y <= figure.torso.endY; y++) {
      this.setChar(figure.centerX, y, this.stickChars.body, figureColor)
    }
    
    // Draw arms
    this.drawLine(figure.centerX, figure.torso.startY + 2, figure.leftArm.x, figure.leftArm.y, figureColor)
    this.drawLine(figure.centerX, figure.torso.startY + 2, figure.rightArm.x, figure.rightArm.y, figureColor)
    
    // Draw legs
    this.drawLine(figure.centerX, figure.torso.endY, figure.leftLeg.x, figure.leftLeg.y, figureColor)
    this.drawLine(figure.centerX, figure.torso.endY, figure.rightLeg.x, figure.rightLeg.y, figureColor)
  }

  private drawLine(x0: number, y0: number, x1: number, y1: number, color: string) {
    // Bresenham's line algorithm
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const sx = x0 < x1 ? 1 : -1
    const sy = y0 < y1 ? 1 : -1
    let err = dx - dy
    
    while (true) {
      // Determine character based on line direction
      let char = '+'
      if (dx > dy * 2) {
        char = '-'
      } else if (dy > dx * 2) {
        char = '|'
      } else if ((x1 - x0) * (y1 - y0) > 0) {
        char = '\\'
      } else {
        char = '/'
      }
      
      this.setChar(x0, y0, char, color)
      
      if (x0 === x1 && y0 === y1) break
      
      const e2 = 2 * err
      if (e2 > -dy) {
        err -= dy
        x0 += sx
      }
      if (e2 < dx) {
        err += dx
        y0 += sy
      }
    }
  }

  private setChar(x: number, y: number, char: string, color: string) {
    if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
      const key = `${x}-${y}`
      const textEl = this.textElements.get(key)
      if (textEl) {
        textEl.content = char
        textEl.fg = color
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
      case 'stickfigure':
        // Preprocessing for better human detection
        this.applyEdgeDetection()
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
          gx += -this.processedBuffer[((y-1) * this.width + (x-1)) * 3 + c]
          gx += -2 * this.processedBuffer[(y * this.width + (x-1)) * 3 + c]
          gx += -this.processedBuffer[((y+1) * this.width + (x-1)) * 3 + c]
          gx += this.processedBuffer[((y-1) * this.width + (x+1)) * 3 + c]
          gx += 2 * this.processedBuffer[(y * this.width + (x+1)) * 3 + c]
          gx += this.processedBuffer[((y+1) * this.width + (x+1)) * 3 + c]
          
          gy += -this.processedBuffer[((y-1) * this.width + (x-1)) * 3 + c]
          gy += -2 * this.processedBuffer[((y-1) * this.width + x) * 3 + c]
          gy += -this.processedBuffer[((y-1) * this.width + (x+1)) * 3 + c]
          gy += this.processedBuffer[((y+1) * this.width + (x-1)) * 3 + c]
          gy += 2 * this.processedBuffer[((y+1) * this.width + x) * 3 + c]
          gy += this.processedBuffer[((y+1) * this.width + (x+1)) * 3 + c]
        }
        
        const magnitude = Math.sqrt(gx * gx + gy * gy) / 3
        const edge = Math.min(255, magnitude)
        
        newBuffer[idx] = edge
        newBuffer[idx + 1] = edge
        newBuffer[idx + 2] = edge
      }
    }
    
    newBuffer.copy(this.processedBuffer)
  }

  private applyNegative() {
    for (let i = 0; i < this.frameSize; i++) {
      this.processedBuffer[i] = 255 - this.processedBuffer[i]
    }
  }

  private applySepia() {
    for (let i = 0; i < this.frameSize; i += 3) {
      const r = this.processedBuffer[i]
      const g = this.processedBuffer[i + 1]
      const b = this.processedBuffer[i + 2]
      
      this.processedBuffer[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189))
      this.processedBuffer[i + 1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168))
      this.processedBuffer[i + 2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131))
    }
  }

  private applyBlackWhite() {
    for (let i = 0; i < this.frameSize; i += 3) {
      const gray = (this.processedBuffer[i] + this.processedBuffer[i + 1] + this.processedBuffer[i + 2]) / 3
      const bw = gray > 128 ? 255 : 0
      this.processedBuffer[i] = bw
      this.processedBuffer[i + 1] = bw
      this.processedBuffer[i + 2] = bw
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
            r += this.processedBuffer[idx]
            g += this.processedBuffer[idx + 1]
            b += this.processedBuffer[idx + 2]
            count++
          }
        }
        
        r = Math.floor(r / count)
        g = Math.floor(g / count)
        b = Math.floor(b / count)
        
        for (let dy = 0; dy < blockSize && y + dy < this.height; dy++) {
          for (let dx = 0; dx < blockSize && x + dx < this.width; dx++) {
            const idx = ((y + dy) * this.width + (x + dx)) * 3
            this.processedBuffer[idx] = r
            this.processedBuffer[idx + 1] = g
            this.processedBuffer[idx + 2] = b
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
              sum += this.processedBuffer[((y + dy) * this.width + (x + dx)) * 3 + c]
            }
          }
          newBuffer[idx + c] = Math.floor(sum / 9)
        }
      }
    }
    
    newBuffer.copy(this.processedBuffer)
  }

  private applyMatrix() {
    for (let i = 0; i < this.frameSize; i += 3) {
      const brightness = (this.processedBuffer[i] + this.processedBuffer[i + 1] + this.processedBuffer[i + 2]) / 3
      this.processedBuffer[i] = 0
      this.processedBuffer[i + 1] = brightness
      this.processedBuffer[i + 2] = 0
    }
  }

  private applyThermal() {
    for (let i = 0; i < this.frameSize; i += 3) {
      const brightness = (this.processedBuffer[i] + this.processedBuffer[i + 1] + this.processedBuffer[i + 2]) / 3
      const heat = brightness / 255
      
      if (heat < 0.33) {
        this.processedBuffer[i] = 0
        this.processedBuffer[i + 1] = Math.floor(heat * 3 * 255)
        this.processedBuffer[i + 2] = 255
      } else if (heat < 0.66) {
        const t = (heat - 0.33) * 3
        this.processedBuffer[i] = Math.floor(t * 255)
        this.processedBuffer[i + 1] = 255
        this.processedBuffer[i + 2] = Math.floor((1 - t) * 255)
      } else {
        const t = (heat - 0.66) * 3
        this.processedBuffer[i] = 255
        this.processedBuffer[i + 1] = Math.floor((1 - t) * 255)
        this.processedBuffer[i + 2] = 0
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
    if (this.displayMode === 'stickfigure' || this.currentFilter === 'stickfigure') {
      // Render stick figures
      for (const figure of this.detectedFigures) {
        this.drawStickFigure(figure)
      }
      
      // Add detection info
      const detectionInfo = `Detected: ${this.detectedFigures.length} figure(s)`
      const infoEl = this.renderer.getRenderable("filter") as TextRenderable
      if (infoEl) {
        infoEl.content = detectionInfo
      }
    } else {
      // Normal rendering
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = (y * this.width + x) * 3
          const r = this.processedBuffer[idx] || 0
          const g = this.processedBuffer[idx + 1] || 0
          const b = this.processedBuffer[idx + 2] || 0
          
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
    if (filterEl && this.currentFilter !== 'stickfigure') {
      filterEl.content = `Filter: ${this.currentFilter}`
    }
  }

  private prevFilter() {
    this.filterIndex = this.filterIndex - 1
    if (this.filterIndex < 0) this.filterIndex = this.filters.length - 1
    this.currentFilter = this.filters[this.filterIndex]
    
    const filterEl = this.renderer.getRenderable("filter") as TextRenderable
    if (filterEl && this.currentFilter !== 'stickfigure') {
      filterEl.content = `Filter: ${this.currentFilter}`
    }
  }

  private cycleDisplayMode() {
    const modes: Array<'blocks' | 'shades' | 'ascii' | 'stickfigure'> = ['blocks', 'shades', 'ascii', 'stickfigure']
    const currentIndex = modes.indexOf(this.displayMode)
    this.displayMode = modes[(currentIndex + 1) % modes.length]
    
    const modeEl = this.renderer.getRenderable("mode") as TextRenderable
    if (modeEl) {
      modeEl.content = `Mode: ${this.displayMode}`
    }
  }

  private setupKeyboard() {
    this.keyHandler = (key: Buffer) => {
      const keyStr = key.toString()
      
      if (keyStr === 'f' || keyStr === 'F') {
        this.nextFilter()
      } else if (keyStr === 'd' || keyStr === 'D') {
        this.prevFilter()
      } else if (keyStr === 'm' || keyStr === 'M') {
        this.cycleDisplayMode()
      } else if (keyStr === 's' || keyStr === 'S') {
        // Quick toggle to stick figure
        if (this.currentFilter !== 'stickfigure') {
          this.currentFilter = 'stickfigure'
          this.filterIndex = this.filters.indexOf('stickfigure')
        } else {
          this.currentFilter = 'none'
          this.filterIndex = 0
        }
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