#!/usr/bin/env bun
import {
  createCliRenderer,
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
  private videoWidth: number
  private videoHeight: number
  private frameSize: number
  private videoBuffer: Uint8Array
  private bufferPos: number = 0
  private frameCount: number = 0
  private totalFrames: number = 0
  private fps: number = 0
  private keyHandler: ((key: Buffer) => void) | null = null
  private frameBuffer: any
  private bytesReceived: number = 0
  private hasNonZeroPixels: boolean = false
  
  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.width = Math.min(renderer.terminalWidth, 80)  // Limit size for debugging
    this.height = Math.min(renderer.terminalHeight, 24)
    
    // Use 2x resolution
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
    console.log(`Video resolution: ${this.videoWidth}x${this.videoHeight}`);
    console.log(`Frame size: ${this.frameSize} bytes`);
    console.log('\nPress Q to quit\n');
    
    this.renderer.start()
    this.renderer.setBackgroundColor("#222222") // Dark gray to see if anything renders
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
      
      // Debug output
      console.log(`FPS: ${this.fps}, Total frames: ${this.totalFrames}, Bytes: ${this.bytesReceived}, Non-zero: ${this.hasNonZeroPixels}`)
    }, 1000)

    // Start ffmpeg
    this.startFFmpeg()

    // Setup keyboard
    this.setupKeyboard()
  }

  private startFFmpeg() {
    // Try simple RGB24 first
    const ffmpegCmd = [
      '-hide_banner',
      '-f', 'avfoundation',
      '-framerate', '15',
      '-video_size', '640x480',
      '-i', this.camera.index,
      '-vf', `scale=${this.videoWidth}:${this.videoHeight}`,
      '-r', '15',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',  // Simple RGB24 format
      '-'
    ]
    
    console.log('FFmpeg command:', 'ffmpeg', ffmpegCmd.join(' '))
    
    this.ffmpeg = spawn('ffmpeg', ffmpegCmd)

    this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      this.processVideoData(chunk)
    })

    this.ffmpeg.stderr?.on('data', (data: Buffer) => {
      const error = data.toString()
      if (!error.includes('Capture buffer') && !error.includes('VIDIOC')) {
        console.error('FFmpeg stderr:', error)
      }
    })

    this.ffmpeg.on('exit', (code: number) => {
      console.log(`FFmpeg exited with code: ${code}`)
      this.cleanup()
    })
  }

  private processVideoData(chunk: Buffer) {
    this.bytesReceived += chunk.length
    
    // For RGB24, frame size is width * height * 3
    const rgb24FrameSize = this.videoWidth * this.videoHeight * 3
    
    let offset = 0
    while (offset < chunk.length) {
      const toRead = Math.min(rgb24FrameSize - this.bufferPos, chunk.length - offset)
      
      // Convert RGB24 to RGBA as we copy
      for (let i = 0; i < toRead; i += 3) {
        if (this.bufferPos + i < rgb24FrameSize && offset + i + 2 < chunk.length) {
          const pixelIndex = Math.floor((this.bufferPos + i) / 3)
          const rgbaIndex = pixelIndex * 4
          
          if (rgbaIndex + 3 < this.videoBuffer.length) {
            this.videoBuffer[rgbaIndex] = chunk[offset + i]       // R
            this.videoBuffer[rgbaIndex + 1] = chunk[offset + i + 1] // G
            this.videoBuffer[rgbaIndex + 2] = chunk[offset + i + 2] // B
            this.videoBuffer[rgbaIndex + 3] = 255                   // A
            
            // Check if we have non-zero data
            if (chunk[offset + i] > 0 || chunk[offset + i + 1] > 0 || chunk[offset + i + 2] > 0) {
              this.hasNonZeroPixels = true
            }
          }
        }
      }
      
      this.bufferPos += toRead
      offset += toRead
      
      if (this.bufferPos >= rgb24FrameSize) {
        this.renderFrame()
        this.bufferPos = 0
        this.frameCount++
        this.totalFrames++
      }
    }
  }

  private renderFrame() {
    try {
      const buffer = this.frameBuffer.buffer
      
      // Clear with a visible color to debug
      buffer.clear(RGBA.fromHex('#111111'))
      
      // Simple rendering - just show raw pixels as colored blocks
      for (let cy = 0; cy < this.height; cy++) {
        for (let cx = 0; cx < this.width; cx++) {
          // Sample center pixel of each 2x2 block
          const px = cx * 2
          const py = cy * 2
          const idx = (py * this.videoWidth + px) * 4
          
          if (idx + 3 < this.videoBuffer.length) {
            const r = this.videoBuffer[idx]
            const g = this.videoBuffer[idx + 1]
            const b = this.videoBuffer[idx + 2]
            
            // Use full block character with the sampled color
            if (r > 0 || g > 0 || b > 0) {
              const color = RGBA.fromRGB(r, g, b)
              buffer.setCell(cx, cy, '█', color, RGBA.fromHex('#000000'))
            } else {
              // Show dim blocks for black pixels so we know rendering is working
              buffer.setCell(cx, cy, '░', RGBA.fromHex('#333333'), RGBA.fromHex('#000000'))
            }
          }
        }
      }
      
      // Debug info overlay
      const debugInfo = `Frames: ${this.totalFrames} | FPS: ${this.fps} | Data: ${this.hasNonZeroPixels ? 'YES' : 'NO'}`
      const debugColor = this.hasNonZeroPixels ? RGBA.fromHex('#00FF00') : RGBA.fromHex('#FF0000')
      
      for (let i = 0; i < debugInfo.length && i < this.width; i++) {
        buffer.setCell(i, 0, debugInfo[i], debugColor, RGBA.fromHex('#000000'))
      }
      
      // Show sample pixel values
      const sampleIdx = 1000 * 4  // Sample pixel 1000
      if (sampleIdx + 3 < this.videoBuffer.length) {
        const sampleText = `Sample pixel RGB: ${this.videoBuffer[sampleIdx]},${this.videoBuffer[sampleIdx+1]},${this.videoBuffer[sampleIdx+2]}`
        for (let i = 0; i < sampleText.length && i < this.width; i++) {
          buffer.setCell(i, 1, sampleText[i], RGBA.fromHex('#FFFF00'), RGBA.fromHex('#000000'))
        }
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
    console.log('\nCleaning up...')
    console.log(`Total bytes received: ${this.bytesReceived}`)
    console.log(`Total frames rendered: ${this.totalFrames}`)
    console.log(`Had non-zero pixels: ${this.hasNonZeroPixels}`)
    
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