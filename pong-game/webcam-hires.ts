#!/usr/bin/env bun
import {
  createCliRenderer,
  type CliRenderer,
  RGBA,
  OptimizedBuffer
} from "@opentui/core"
import { spawn, execSync } from 'child_process';
import { toArrayBuffer } from 'bun:ffi';

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

type Filter = 'none' | 'edge' | 'negative' | 'sepia' | 'blackwhite' | 'matrix' | 'thermal'

class WebcamViewer {
  private renderer: CliRenderer
  private width: number
  private height: number
  private camera: { index: string; name: string }
  private ffmpeg: any
  private videoWidth: number
  private videoHeight: number
  private frameSize: number
  private videoBuffer: Uint8Array
  private processedBuffer: Uint8Array
  private bufferPos: number = 0
  private frameCount: number = 0
  private fps: number = 0
  private currentFilter: Filter = 'none'
  private filterIndex: number = 0
  private filters: Filter[] = ['none', 'edge', 'negative', 'sepia', 'blackwhite', 'matrix', 'thermal']
  private keyHandler: ((key: Buffer) => void) | null = null
  private frameBuffer: any // FrameBufferRenderable
  
  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.width = renderer.terminalWidth
    this.height = renderer.terminalHeight
    
    // Use 2x resolution for super sampling (2x2 pixels per character)
    this.videoWidth = this.width * 2
    this.videoHeight = this.height * 2
    
    this.camera = getFirstCamera()
    // RGBA format for super sampling
    this.frameSize = this.videoWidth * this.videoHeight * 4
    this.videoBuffer = new Uint8Array(this.frameSize)
    this.processedBuffer = new Uint8Array(this.frameSize)
  }

  init() {
    console.log(`Using camera: ${this.camera.name}`);
    console.log(`Terminal: ${this.width}x${this.height} | Video: ${this.videoWidth}x${this.videoHeight}`);
    console.log('\n=== HIGH-RES WEBCAM (Super Sampling) ===');
    console.log('F: Next filter | D: Previous filter | Q: Quit\n');
    
    this.renderer.start()
    this.renderer.setBackgroundColor("#000000")
    this.renderer.setCursorPosition(0, 0, false)

    // Create frame buffer for super sampled rendering
    this.frameBuffer = this.renderer.createFrameBuffer('webcam', {
      x: 0,
      y: 0,
      width: this.width,
      height: this.height,
      zIndex: 1,
      visible: true,
      respectAlpha: false
    })

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

  private startFFmpeg() {
    // Request RGBA output at 2x resolution for super sampling
    this.ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'avfoundation',
      '-framerate', '30',
      '-video_size', '1280x720',
      '-i', this.camera.index,
      '-vf', `scale=${this.videoWidth}:${this.videoHeight}:flags=bicubic`,
      '-r', '30',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',  // RGBA format for super sampling
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
      
      // Copy to our Uint8Array buffer
      for (let i = 0; i < toRead; i++) {
        this.videoBuffer[this.bufferPos + i] = chunk[offset + i]
      }
      
      this.bufferPos += toRead
      offset += toRead
      
      if (this.bufferPos >= this.frameSize) {
        // Copy to processed buffer
        this.processedBuffer.set(this.videoBuffer)
        
        // Apply filter if needed
        if (this.currentFilter !== 'none') {
          this.applyFilter()
        }
        
        // Render using super sampling
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
      case 'matrix':
        this.applyMatrix()
        break
      case 'thermal':
        this.applyThermal()
        break
    }
  }

  private applyEdgeDetection() {
    const newBuffer = new Uint8Array(this.frameSize)
    const w = this.videoWidth
    const h = this.videoHeight
    
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4
        
        let gx = 0, gy = 0
        
        // Sobel operator on luminance
        for (let c = 0; c < 3; c++) {
          gx += -this.processedBuffer[((y-1) * w + (x-1)) * 4 + c]
          gx += -2 * this.processedBuffer[(y * w + (x-1)) * 4 + c]
          gx += -this.processedBuffer[((y+1) * w + (x-1)) * 4 + c]
          gx += this.processedBuffer[((y-1) * w + (x+1)) * 4 + c]
          gx += 2 * this.processedBuffer[(y * w + (x+1)) * 4 + c]
          gx += this.processedBuffer[((y+1) * w + (x+1)) * 4 + c]
          
          gy += -this.processedBuffer[((y-1) * w + (x-1)) * 4 + c]
          gy += -2 * this.processedBuffer[((y-1) * w + x) * 4 + c]
          gy += -this.processedBuffer[((y-1) * w + (x+1)) * 4 + c]
          gy += this.processedBuffer[((y+1) * w + (x-1)) * 4 + c]
          gy += 2 * this.processedBuffer[((y+1) * w + x) * 4 + c]
          gy += this.processedBuffer[((y+1) * w + (x+1)) * 4 + c]
        }
        
        const magnitude = Math.sqrt(gx * gx + gy * gy) / 3
        const edge = Math.min(255, magnitude)
        
        newBuffer[idx] = edge
        newBuffer[idx + 1] = edge
        newBuffer[idx + 2] = edge
        newBuffer[idx + 3] = 255
      }
    }
    
    this.processedBuffer.set(newBuffer)
  }

  private applyNegative() {
    for (let i = 0; i < this.frameSize; i += 4) {
      this.processedBuffer[i] = 255 - this.processedBuffer[i]
      this.processedBuffer[i + 1] = 255 - this.processedBuffer[i + 1]
      this.processedBuffer[i + 2] = 255 - this.processedBuffer[i + 2]
      // Keep alpha unchanged
    }
  }

  private applySepia() {
    for (let i = 0; i < this.frameSize; i += 4) {
      const r = this.processedBuffer[i]
      const g = this.processedBuffer[i + 1]
      const b = this.processedBuffer[i + 2]
      
      this.processedBuffer[i] = Math.min(255, (r * 0.393) + (g * 0.769) + (b * 0.189))
      this.processedBuffer[i + 1] = Math.min(255, (r * 0.349) + (g * 0.686) + (b * 0.168))
      this.processedBuffer[i + 2] = Math.min(255, (r * 0.272) + (g * 0.534) + (b * 0.131))
    }
  }

  private applyBlackWhite() {
    for (let i = 0; i < this.frameSize; i += 4) {
      const gray = (this.processedBuffer[i] + this.processedBuffer[i + 1] + this.processedBuffer[i + 2]) / 3
      const bw = gray > 128 ? 255 : 0
      this.processedBuffer[i] = bw
      this.processedBuffer[i + 1] = bw
      this.processedBuffer[i + 2] = bw
    }
  }

  private applyMatrix() {
    for (let i = 0; i < this.frameSize; i += 4) {
      const brightness = (this.processedBuffer[i] + this.processedBuffer[i + 1] + this.processedBuffer[i + 2]) / 3
      this.processedBuffer[i] = 0
      this.processedBuffer[i + 1] = brightness
      this.processedBuffer[i + 2] = 0
    }
  }

  private applyThermal() {
    for (let i = 0; i < this.frameSize; i += 4) {
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

  private renderFrame() {
    const buffer = this.frameBuffer.buffer as OptimizedBuffer
    
    // Clear the buffer first
    buffer.clear(RGBA.fromHex('#000000'))
    
    // Use drawSuperSampleBuffer for high-quality rendering
    // This takes RGBA pixel data and renders it at 2x2 pixels per character
    const pixelDataPtr = toArrayBuffer(this.processedBuffer).ptr
    const alignedBytesPerRow = this.videoWidth * 4 // RGBA = 4 bytes per pixel
    
    buffer.drawSuperSampleBuffer(
      0, 0,
      pixelDataPtr,
      this.processedBuffer.length,
      "rgba8unorm",
      alignedBytesPerRow
    )
    
    // Draw status overlay
    const statusText = `${this.camera.name} | ${this.videoWidth}x${this.videoHeight} | FPS: ${this.fps} | Filter: ${this.currentFilter}`
    const statusColor = RGBA.fromRGB(255, 255, 255)
    const statusBg = RGBA.fromRGB(0, 0, 0)
    
    for (let i = 0; i < statusText.length && i < this.width; i++) {
      buffer.setCell(i, 0, statusText[i], statusColor, statusBg)
    }
    
    this.frameBuffer.needsUpdate = true
  }

  private nextFilter() {
    this.filterIndex = (this.filterIndex + 1) % this.filters.length
    this.currentFilter = this.filters[this.filterIndex]
  }

  private prevFilter() {
    this.filterIndex = this.filterIndex - 1
    if (this.filterIndex < 0) this.filterIndex = this.filters.length - 1
    this.currentFilter = this.filters[this.filterIndex]
  }

  private setupKeyboard() {
    this.keyHandler = (key: Buffer) => {
      const keyStr = key.toString()
      
      if (keyStr === 'f' || keyStr === 'F') {
        this.nextFilter()
      } else if (keyStr === 'd' || keyStr === 'D') {
        this.prevFilter()
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