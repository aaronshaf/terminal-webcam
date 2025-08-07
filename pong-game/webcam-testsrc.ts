#!/usr/bin/env bun
import {
  createCliRenderer,
  type CliRenderer,
  RGBA,
} from "@opentui/core"
import { spawn } from 'child_process';

class TestVideoViewer {
  private renderer: CliRenderer
  private width: number
  private height: number
  private ffmpeg: any
  private videoWidth: number
  private videoHeight: number
  private frameSize: number
  private videoBuffer: Uint8Array
  private bufferPos: number = 0
  private frameCount: number = 0
  private fps: number = 0
  private keyHandler: ((key: Buffer) => void) | null = null
  private frameBuffer: any
  
  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.width = renderer.terminalWidth
    this.height = renderer.terminalHeight
    
    // Match terminal size
    this.videoWidth = this.width
    this.videoHeight = this.height
    
    // RGB24 format (3 bytes per pixel)
    this.frameSize = this.videoWidth * this.videoHeight * 3
    this.videoBuffer = new Uint8Array(this.frameSize)
  }

  init() {
    console.log('=== TEST VIDEO SOURCE ===');
    console.log(`Terminal: ${this.width}x${this.height}`);
    console.log(`Video: ${this.videoWidth}x${this.videoHeight}`);
    console.log('This uses ffmpeg test source to verify rendering works');
    console.log('\nPress Q to quit\n');
    
    this.renderer.start()
    this.renderer.setBackgroundColor("#000000")
    this.renderer.setCursorPosition(0, 0, false)

    // Create frame buffer
    this.frameBuffer = this.renderer.createFrameBuffer('video', {
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

    // Start ffmpeg with test source
    this.startFFmpeg()

    // Setup keyboard
    this.setupKeyboard()
  }

  private startFFmpeg() {
    // Use test source instead of camera
    const ffmpegCmd = [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'lavfi',
      '-i', `testsrc2=size=${this.videoWidth}x${this.videoHeight}:rate=30`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-'
    ]
    
    console.log('Starting ffmpeg with test source...');
    
    this.ffmpeg = spawn('ffmpeg', ffmpegCmd)

    this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      this.processVideoData(chunk)
    })

    this.ffmpeg.stderr?.on('data', (data: Buffer) => {
      const error = data.toString()
      console.error('FFmpeg error:', error)
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
      
      // Copy chunk data to our buffer
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

  private renderFrame() {
    try {
      const buffer = this.frameBuffer.buffer
      
      // Clear buffer
      buffer.clear(RGBA.fromHex('#000000'))
      
      // Render each pixel
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = (y * this.videoWidth + x) * 3
          
          if (idx + 2 < this.videoBuffer.length) {
            const r = this.videoBuffer[idx]
            const g = this.videoBuffer[idx + 1]
            const b = this.videoBuffer[idx + 2]
            
            const color = RGBA.fromRGB(r, g, b)
            buffer.setCell(x, y, '█', color, RGBA.fromHex('#000000'))
          }
        }
      }
      
      // Draw status overlay
      const statusText = `TEST SOURCE | FPS: ${this.fps}`
      const statusColor = RGBA.fromRGB(255, 255, 0)
      const statusBg = RGBA.fromRGB(0, 0, 0)
      
      for (let i = 0; i < statusText.length && i < this.width; i++) {
        buffer.setCell(i, 0, statusText[i], statusColor, statusBg)
      }
      
      this.frameBuffer.needsUpdate = true
    } catch (e) {
      console.error('Render error:', e)
    }
  }

  private setupKeyboard() {
    this.keyHandler = (key: Buffer) => {
      const keyStr = key.toString()
      
      if (keyStr === 'q' || keyStr === 'Q' || keyStr === '\u0003') {
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
  
  const viewer = new TestVideoViewer(renderer)
  viewer.init()
}

main().catch(console.error)