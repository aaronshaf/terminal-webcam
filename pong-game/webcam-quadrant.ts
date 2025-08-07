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
  private fps: number = 0
  private keyHandler: ((key: Buffer) => void) | null = null
  private frameBuffer: any
  
  // Quadrant characters for 2x2 pixel blocks
  private quadrantChars = [
    ' ',      // 0000 - all light
    '\u2597', // 0001 - BR ▗
    '\u2596', // 0010 - BL ▖
    '\u2584', // 0011 - Lower half ▄
    '\u259d', // 0100 - TR ▝
    '\u2590', // 0101 - Right half ▐
    '\u259e', // 0110 - TR+BL ▞
    '\u259f', // 0111 - TR+BL+BR ▟
    '\u2598', // 1000 - TL ▘
    '\u259a', // 1001 - TL+BR ▚
    '\u258c', // 1010 - Left half ▌
    '\u2599', // 1011 - TL+BL+BR ▙
    '\u2580', // 1100 - Upper half ▀
    '\u259c', // 1101 - TL+TR+BR ▜
    '\u259b', // 1110 - TL+TR+BL ▛
    '\u2588'  // 1111 - Full block █
  ]
  
  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.width = renderer.terminalWidth
    this.height = renderer.terminalHeight
    
    // Use 2x resolution for quadrant rendering
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
    console.log(`Video resolution: ${this.videoWidth}x${this.videoHeight} (2x for quadrants)`);
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
      '-pix_fmt', 'rgba',
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

  private getPixel(x: number, y: number): {r: number, g: number, b: number} {
    if (x >= this.videoWidth || y >= this.videoHeight) {
      return {r: 0, g: 0, b: 0}
    }
    
    const idx = (y * this.videoWidth + x) * 4
    return {
      r: this.videoBuffer[idx],
      g: this.videoBuffer[idx + 1],
      b: this.videoBuffer[idx + 2]
    }
  }

  private renderQuadrant(pixels: Array<{r: number, g: number, b: number}>): {
    char: string,
    fg: RGBA,
    bg: RGBA
  } {
    // Calculate luminance for each pixel
    const luminances = pixels.map(p => 0.299 * p.r + 0.587 * p.g + 0.114 * p.b)
    
    // Find average luminance
    const avgLum = luminances.reduce((a, b) => a + b) / 4
    
    // Determine which quadrants are "dark" (below average)
    const isDark = luminances.map(l => l < avgLum)
    
    // Build quadrant bits (TL=8, TR=4, BL=2, BR=1)
    const bits = (isDark[0] ? 8 : 0) + (isDark[1] ? 4 : 0) + 
                 (isDark[2] ? 2 : 0) + (isDark[3] ? 1 : 0)
    
    const char = this.quadrantChars[bits]
    
    // Calculate average colors for dark and light pixels
    let darkColor = {r: 0, g: 0, b: 0, count: 0}
    let lightColor = {r: 0, g: 0, b: 0, count: 0}
    
    pixels.forEach((p, i) => {
      if (isDark[i]) {
        darkColor.r += p.r
        darkColor.g += p.g
        darkColor.b += p.b
        darkColor.count++
      } else {
        lightColor.r += p.r
        lightColor.g += p.g
        lightColor.b += p.b
        lightColor.count++
      }
    })
    
    // Average the colors
    if (darkColor.count > 0) {
      darkColor.r = Math.round(darkColor.r / darkColor.count)
      darkColor.g = Math.round(darkColor.g / darkColor.count)
      darkColor.b = Math.round(darkColor.b / darkColor.count)
    }
    if (lightColor.count > 0) {
      lightColor.r = Math.round(lightColor.r / lightColor.count)
      lightColor.g = Math.round(lightColor.g / lightColor.count)
      lightColor.b = Math.round(lightColor.b / lightColor.count)
    } else {
      // If all pixels are dark, use a contrasting light color
      lightColor = {r: 255, g: 255, b: 255, count: 1}
    }
    
    return {
      char,
      fg: RGBA.fromRGB(darkColor.r, darkColor.g, darkColor.b),
      bg: RGBA.fromRGB(lightColor.r, lightColor.g, lightColor.b)
    }
  }

  private renderFrame() {
    try {
      const buffer = this.frameBuffer.buffer
      
      // Clear buffer
      buffer.clear(RGBA.fromHex('#000000'))
      
      // Process each character cell
      for (let cy = 0; cy < this.height; cy++) {
        for (let cx = 0; cx < this.width; cx++) {
          // Get the 2x2 pixel block for this character
          const px = cx * 2
          const py = cy * 2
          
          const quadPixels = [
            this.getPixel(px, py),        // TL
            this.getPixel(px + 1, py),    // TR
            this.getPixel(px, py + 1),    // BL
            this.getPixel(px + 1, py + 1) // BR
          ]
          
          const result = this.renderQuadrant(quadPixels)
          buffer.setCell(cx, cy, result.char, result.fg, result.bg)
        }
      }
      
      // Draw status overlay
      const statusText = `${this.camera.name} | FPS: ${this.fps} | Quadrant Rendering`
      const statusColor = RGBA.fromRGB(0, 255, 0)
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