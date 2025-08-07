#!/usr/bin/env bun
import {
  createCliRenderer,
  type CliRenderer,
  RGBA,
} from "@opentui/core"
import { spawn, execSync } from 'child_process';
import { ptr } from 'bun:ffi';

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
  private videoBuffer: ArrayBuffer
  private videoUint8: Uint8Array
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
    // Use ArrayBuffer directly for better FFI compatibility
    this.videoBuffer = new ArrayBuffer(this.frameSize)
    this.videoUint8 = new Uint8Array(this.videoBuffer)
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
      
      // Copy chunk data to our ArrayBuffer
      for (let i = 0; i < toRead; i++) {
        this.videoUint8[this.bufferPos + i] = chunk[offset + i]
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
      
      // Calculate bytes per row - must match actual data layout
      const bytesPerRow = this.videoWidth * 4
      
      // Get pointer directly from ArrayBuffer
      const bufferPtr = ptr(this.videoBuffer)
      
      // Verify we have valid data
      if (!bufferPtr) {
        console.error('Invalid buffer pointer')
        return
      }
      
      // Try drawing with super sampling
      try {
        buffer.drawSuperSampleBuffer(
          0, 0,                    // x, y position
          bufferPtr,               // pointer to pixel data
          this.frameSize,          // total size in bytes
          "rgba8unorm",           // pixel format
          bytesPerRow             // bytes per row
        )
      } catch (e) {
        console.error('drawSuperSampleBuffer error:', e)
        // Fallback to regular rendering if super sampling fails
        this.renderFallback()
        return
      }
      
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
  
  private renderFallback() {
    // Fallback rendering using manual quadrant blocks
    const buffer = this.frameBuffer.buffer
    
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        // Sample 2x2 pixels for this character cell
        const px = x * 2
        const py = y * 2
        
        // Get the 4 pixels (TL, TR, BL, BR)
        const pixels = [
          this.getPixel(px, py),       // TL
          this.getPixel(px + 1, py),   // TR
          this.getPixel(px, py + 1),   // BL
          this.getPixel(px + 1, py + 1) // BR
        ]
        
        // Calculate average colors
        const avgColor = {
          r: pixels.reduce((sum, p) => sum + p.r, 0) / 4,
          g: pixels.reduce((sum, p) => sum + p.g, 0) / 4,
          b: pixels.reduce((sum, p) => sum + p.b, 0) / 4
        }
        
        // Find darkest and lightest pixels
        const luminances = pixels.map(p => 0.299 * p.r + 0.587 * p.g + 0.114 * p.b)
        const darkIdx = luminances.indexOf(Math.min(...luminances))
        const lightIdx = luminances.indexOf(Math.max(...luminances))
        
        const darkColor = pixels[darkIdx]
        const lightColor = pixels[lightIdx]
        
        // Determine which quadrants are "dark"
        const quadrants = pixels.map(p => {
          const lum = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b
          const avgLum = 0.299 * avgColor.r + 0.587 * avgColor.g + 0.114 * avgColor.b
          return lum < avgLum
        })
        
        // Select appropriate quadrant character
        const quadrantChars = [
          ' ',    // 0000 - all light
          '▗', // 0001 - BR
          '▖', // 0010 - BL
          '▄', // 0011 - Lower half
          '▝', // 0100 - TR
          '▐', // 0101 - Right half
          '▞', // 0110 - TR+BL
          '▟', // 0111 - TR+BL+BR
          '▘', // 1000 - TL
          '▚', // 1001 - TL+BR
          '▌', // 1010 - Left half
          '▙', // 1011 - TL+BL+BR
          '▀', // 1100 - Upper half
          '▜', // 1101 - TL+TR+BR
          '▛', // 1110 - TL+TR+BL
          '█'  // 1111 - Full block
        ]
        
        const bits = (quadrants[0] ? 8 : 0) + (quadrants[1] ? 4 : 0) + 
                     (quadrants[2] ? 2 : 0) + (quadrants[3] ? 1 : 0)
        const char = quadrantChars[bits]
        
        const fg = RGBA.fromRGB(darkColor.r, darkColor.g, darkColor.b)
        const bg = RGBA.fromRGB(lightColor.r, lightColor.g, lightColor.b)
        
        buffer.setCell(x, y, char, fg, bg)
      }
    }
  }
  
  private getPixel(x: number, y: number): {r: number, g: number, b: number} {
    if (x >= this.videoWidth || y >= this.videoHeight) {
      return {r: 0, g: 0, b: 0}
    }
    
    const idx = (y * this.videoWidth + x) * 4
    return {
      r: this.videoUint8[idx],
      g: this.videoUint8[idx + 1],
      b: this.videoUint8[idx + 2]
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