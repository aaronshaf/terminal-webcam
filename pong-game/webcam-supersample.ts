#!/usr/bin/env bun
import {
  createCliRenderer,
  type CliRenderer,
  RGBA,
} from "@opentui/core"
import { spawn, execSync } from 'child_process';
import { ptr, toArrayBuffer } from 'bun:ffi';

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
    
    // Use 2x resolution for super sampling (2x2 pixels per character)
    this.videoWidth = this.width * 2
    this.videoHeight = this.height * 2
    
    this.camera = getFirstCamera()
    // RGBA format (4 bytes per pixel)
    this.frameSize = this.videoWidth * this.videoHeight * 4
    this.videoBuffer = new Uint8Array(this.frameSize)
  }

  init() {
    console.log(`Using camera: ${this.camera.name}`);
    console.log(`Terminal: ${this.width}x${this.height}`);
    console.log(`Super sampling: ${this.videoWidth}x${this.videoHeight} (4 pixels per char)`);
    console.log('\nPress Q to quit\n');
    
    this.renderer.start()
    this.renderer.setBackgroundColor("#000000")
    this.renderer.setCursorPosition(0, 0, false)

    // Create frame buffer
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
    // Request RGBA output at 2x resolution
    this.ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'avfoundation',
      '-framerate', '30',
      '-video_size', '640x480',
      '-i', this.camera.index,
      '-vf', `scale=${this.videoWidth}:${this.videoHeight}:flags=bilinear`,
      '-r', '30',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',  // RGBA format
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
    
    while (offset < chunk.length) {
      const toRead = Math.min(this.frameSize - this.bufferPos, chunk.length - offset)
      
      // Copy chunk data to our Uint8Array
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
      
      // Clear buffer first
      buffer.clear(RGBA.fromHex('#000000'))
      
      // The key is to properly align the bytes per row
      // For RGBA format: 4 bytes per pixel
      const bytesPerPixel = 4
      const unalignedBytesPerRow = this.videoWidth * bytesPerPixel
      // OpenTUI may expect aligned rows (typically to 256 bytes for GPU)
      const alignedBytesPerRow = unalignedBytesPerRow // Try without alignment first
      
      // Get pointer to our buffer
      const arrayBuffer = toArrayBuffer(this.videoBuffer)
      const bufferPtr = ptr(arrayBuffer)
      
      // Draw using super sampling
      // This should render 2x2 pixels per character
      buffer.drawSuperSampleBuffer(
        0, 0,                    // x, y position
        bufferPtr,               // pointer to pixel data
        this.videoBuffer.length, // total size in bytes
        "rgba8unorm",           // pixel format
        alignedBytesPerRow      // bytes per row (with alignment)
      )
      
      // Draw status overlay
      const statusText = `${this.camera.name} | ${this.videoWidth}x${this.videoHeight} | FPS: ${this.fps}`
      const statusColor = RGBA.fromRGB(255, 255, 255)
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
  
  const webcam = new WebcamViewer(renderer)
  webcam.init()
}

main().catch(console.error)