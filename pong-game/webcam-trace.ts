#!/usr/bin/env bun
import {
  createCliRenderer,
  type CliRenderer,
  RGBA,
} from "@opentui/core"
import { spawn, execSync } from 'child_process';
import { writeFileSync } from 'fs';

// Get first camera
function getFirstCamera(): { index: string; name: string } {
  try {
    const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', { 
      encoding: 'utf8',
      shell: true 
    });
    
    const lines = output.split('\n');
    for (const line of lines) {
      if (line.includes('[AVFoundation indev @')) {
        const match = line.match(/\[AVFoundation indev @ [^\]]+\]\s+\[(\d+)\]\s+(.+)/);
        if (match && !match[2].includes('Capture screen')) {
          console.log(`Found camera: [${match[1]}] ${match[2]}`);
          return { index: match[1], name: match[2] };
        }
      }
    }
  } catch (e) {
    console.error('Error listing devices:', e)
  }
  
  return { index: '0', name: 'Default Camera' };
}

class WebcamViewer {
  private renderer: CliRenderer
  private width: number
  private height: number
  private camera: { index: string; name: string }
  private ffmpeg: any
  private videoWidth: number = 80
  private videoHeight: number = 24
  private frameSize: number
  private videoBuffer: Uint8Array
  private bufferPos: number = 0
  private frameCount: number = 0
  private fps: number = 0
  private keyHandler: ((key: Buffer) => void) | null = null
  private frameBuffer: any
  private totalBytes: number = 0
  private firstFrameSaved: boolean = false
  private pixelStats = { min: 255, max: 0, avg: 0, nonZero: 0 }
  
  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.width = renderer.terminalWidth
    this.height = renderer.terminalHeight
    
    // Use small fixed size for debugging
    this.videoWidth = 80
    this.videoHeight = 24
    
    this.camera = getFirstCamera()
    // RGB24 format (3 bytes per pixel)
    this.frameSize = this.videoWidth * this.videoHeight * 3
    this.videoBuffer = new Uint8Array(this.frameSize)
    
    console.log('Buffer size:', this.frameSize, 'bytes')
  }

  init() {
    console.log('\n=== WEBCAM TRACE DEBUG ===');
    console.log(`Camera: ${this.camera.name} (index: ${this.camera.index})`);
    console.log(`Terminal: ${this.width}x${this.height}`);
    console.log(`Video: ${this.videoWidth}x${this.videoHeight}`);
    console.log(`Frame size: ${this.frameSize} bytes`);
    console.log('\nPress Q to quit\n');
    
    this.renderer.start()
    this.renderer.setBackgroundColor("#444444") // Gray background to see if rendering works
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

    // Debug timer
    setInterval(() => {
      this.fps = this.frameCount
      this.frameCount = 0
      
      console.log(`\n[${new Date().toISOString()}]`)
      console.log(`FPS: ${this.fps} | Total bytes: ${this.totalBytes}`)
      console.log(`Pixel stats - Min: ${this.pixelStats.min}, Max: ${this.pixelStats.max}, Avg: ${Math.round(this.pixelStats.avg)}, NonZero: ${this.pixelStats.nonZero}`)
    }, 1000)

    // Start ffmpeg
    this.startFFmpeg()

    // Setup keyboard
    this.setupKeyboard()
    
    // Test rendering immediately
    this.testRender()
  }
  
  private testRender() {
    console.log('\nTesting render with fake data...')
    const buffer = this.frameBuffer.buffer
    buffer.clear(RGBA.fromHex('#000000'))
    
    // Draw test pattern
    for (let y = 0; y < Math.min(10, this.height); y++) {
      for (let x = 0; x < Math.min(40, this.width); x++) {
        const r = (x * 255 / 40) | 0
        const g = (y * 255 / 10) | 0
        const b = 128
        buffer.setCell(x, y + 5, '█', RGBA.fromRGB(r, g, b), RGBA.fromHex('#000000'))
      }
    }
    
    buffer.drawText('TEST PATTERN - You should see colors above', 0, 16, RGBA.fromHex('#FFFF00'))
    this.frameBuffer.needsUpdate = true
    console.log('Test pattern rendered')
  }

  private startFFmpeg() {
    // Try the simplest possible ffmpeg command
    const ffmpegCmd = [
      '-f', 'avfoundation',
      '-framerate', '10',
      '-video_size', '320x240',  // Small input size
      '-i', this.camera.index,
      '-vf', `scale=${this.videoWidth}:${this.videoHeight}`,
      '-r', '10',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-'
    ]
    
    console.log('\nFFmpeg command:', 'ffmpeg', ffmpegCmd.join(' '))
    
    this.ffmpeg = spawn('ffmpeg', ffmpegCmd)

    this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      this.totalBytes += chunk.length
      console.log(`Received chunk: ${chunk.length} bytes`)
      this.processVideoData(chunk)
    })

    this.ffmpeg.stderr?.on('data', (data: Buffer) => {
      const error = data.toString()
      // Log ALL stderr output for debugging
      console.error('FFmpeg stderr:', error.trim())
    })

    this.ffmpeg.on('exit', (code: number) => {
      console.log(`\nFFmpeg exited with code: ${code}`)
      this.cleanup()
    })
    
    this.ffmpeg.on('error', (err: Error) => {
      console.error('FFmpeg spawn error:', err)
      this.cleanup()
    })
  }

  private processVideoData(chunk: Buffer) {
    let offset = 0
    
    while (offset < chunk.length) {
      const toRead = Math.min(this.frameSize - this.bufferPos, chunk.length - offset)
      
      // Copy and analyze data
      for (let i = 0; i < toRead; i++) {
        const byte = chunk[offset + i]
        this.videoBuffer[this.bufferPos + i] = byte
        
        // Update stats
        if (byte < this.pixelStats.min) this.pixelStats.min = byte
        if (byte > this.pixelStats.max) this.pixelStats.max = byte
        if (byte > 0) this.pixelStats.nonZero++
      }
      
      this.bufferPos += toRead
      offset += toRead
      
      if (this.bufferPos >= this.frameSize) {
        console.log(`Frame complete! (${this.frameSize} bytes)`)
        
        // Save first frame for analysis
        if (!this.firstFrameSaved) {
          this.saveFirstFrame()
        }
        
        this.renderFrame()
        this.bufferPos = 0
        this.frameCount++
        
        // Reset stats
        this.pixelStats = { min: 255, max: 0, avg: 0, nonZero: 0 }
      }
    }
  }
  
  private saveFirstFrame() {
    this.firstFrameSaved = true
    const filename = 'first_frame_debug.txt'
    
    // Calculate average
    let sum = 0
    for (let i = 0; i < this.videoBuffer.length; i++) {
      sum += this.videoBuffer[i]
    }
    const avg = sum / this.videoBuffer.length
    
    // Sample some pixels
    const samples: string[] = []
    for (let i = 0; i < Math.min(30, this.videoBuffer.length); i += 3) {
      const r = this.videoBuffer[i]
      const g = this.videoBuffer[i + 1]
      const b = this.videoBuffer[i + 2]
      samples.push(`RGB(${r},${g},${b})`)
    }
    
    const debugInfo = [
      `First frame received at ${new Date().toISOString()}`,
      `Size: ${this.videoBuffer.length} bytes`,
      `Average value: ${avg}`,
      `First 10 pixels:`,
      samples.join('\n'),
    ].join('\n')
    
    writeFileSync(filename, debugInfo)
    console.log(`\nFirst frame saved to ${filename}`)
    console.log(`Average pixel value: ${avg}`)
  }

  private renderFrame() {
    try {
      const buffer = this.frameBuffer.buffer
      buffer.clear(RGBA.fromHex('#000000'))
      
      // Render video
      let renderedPixels = 0
      for (let y = 0; y < Math.min(this.videoHeight, this.height); y++) {
        for (let x = 0; x < Math.min(this.videoWidth, this.width); x++) {
          const idx = (y * this.videoWidth + x) * 3
          
          if (idx + 2 < this.videoBuffer.length) {
            const r = this.videoBuffer[idx]
            const g = this.videoBuffer[idx + 1]
            const b = this.videoBuffer[idx + 2]
            
            // Always render something, even if black
            const color = RGBA.fromRGB(r || 10, g || 10, b || 10) // Minimum visibility
            buffer.setCell(x, y, '█', color, RGBA.fromHex('#000000'))
            renderedPixels++
          }
        }
      }
      
      // Status
      const status = `FPS: ${this.fps} | Pixels: ${renderedPixels}`
      for (let i = 0; i < status.length && i < this.width; i++) {
        buffer.setCell(i, this.height - 1, status[i], RGBA.fromHex('#FFFF00'), RGBA.fromHex('#000000'))
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
    console.log(`\nFinal stats:`)
    console.log(`Total bytes received: ${this.totalBytes}`)
    console.log(`Frames rendered: ${this.frameCount}`)
    
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