#!/usr/bin/env bun
import {
  createCliRenderer,
  type CliRenderer,
  RGBA,
} from "@opentui/core"
import { spawn, execSync } from 'child_process';

// List all available cameras
function listCameras(): Array<{ index: string; name: string }> {
  try {
    const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', { 
      encoding: 'utf8',
      shell: true 
    });
    
    const cameras: Array<{ index: string; name: string }> = [];
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('[AVFoundation indev @')) {
        const match = line.match(/\[AVFoundation indev @ [^\]]+\]\s+\[(\d+)\]\s+(.+)/);
        if (match && !match[2].includes('Capture screen')) {
          cameras.push({ index: match[1], name: match[2] });
        }
      }
    }
    
    return cameras;
  } catch (e) {
    console.error('Error listing devices:', e);
    return [];
  }
}

class WebcamViewer {
  private renderer: CliRenderer
  private width: number
  private height: number
  private camera: { index: string; name: string } | null = null
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
  private useTestSource: boolean = false
  
  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.width = Math.min(renderer.terminalWidth, 120)
    this.height = Math.min(renderer.terminalHeight, 40)
    
    this.videoWidth = this.width
    this.videoHeight = this.height
    
    // RGB24 format (3 bytes per pixel)
    this.frameSize = this.videoWidth * this.videoHeight * 3
    this.videoBuffer = new Uint8Array(this.frameSize)
  }

  init() {
    console.log('\n=== OpenTUI Webcam Viewer ===\n');
    
    // List available cameras
    const cameras = listCameras();
    
    if (cameras.length === 0) {
      console.log('No cameras found! Using test source instead.');
      console.log('\nPossible reasons:');
      console.log('1. No camera connected');
      console.log('2. Camera permissions not granted');
      console.log('3. Camera in use by another application');
      console.log('\nOn macOS, you may need to grant Terminal/iTerm camera access.');
      console.log('Go to: System Settings > Privacy & Security > Camera\n');
      this.useTestSource = true;
    } else {
      console.log('Available cameras:');
      cameras.forEach(cam => {
        console.log(`  [${cam.index}] ${cam.name}`);
      });
      this.camera = cameras[0];
      console.log(`\nUsing: ${this.camera.name}`);
    }
    
    console.log(`Terminal: ${this.width}x${this.height}`);
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
    let ffmpegCmd: string[]
    
    if (this.useTestSource) {
      // Use test source
      ffmpegCmd = [
        '-hide_banner',
        '-loglevel', 'error',
        '-f', 'lavfi',
        '-i', `testsrc2=size=${this.videoWidth}x${this.videoHeight}:rate=30`,
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        '-'
      ]
      console.log('Using test source...');
    } else {
      // Use camera - try with "0:none" format for video only
      ffmpegCmd = [
        '-hide_banner',
        '-loglevel', 'warning',  // Show warnings
        '-f', 'avfoundation',
        '-framerate', '30',
        '-video_size', '640x480',
        '-i', `${this.camera!.index}:none`,  // video:audio format
        '-vf', `scale=${this.videoWidth}:${this.videoHeight}`,
        '-r', '30',
        '-f', 'rawvideo',
        '-pix_fmt', 'rgb24',
        '-'
      ]
      console.log(`Attempting to access camera ${this.camera!.index}...`);
    }
    
    this.ffmpeg = spawn('ffmpeg', ffmpegCmd)
    
    let hasData = false;

    this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      if (!hasData) {
        hasData = true;
        console.log('Receiving video data!');
      }
      this.processVideoData(chunk)
    })

    this.ffmpeg.stderr?.on('data', (data: Buffer) => {
      const error = data.toString()
      if (!error.includes('Capture buffer') && !error.includes('deprecated pixel format')) {
        console.error('FFmpeg:', error.trim())
      }
    })

    this.ffmpeg.on('exit', (code: number) => {
      console.log(`\nFFmpeg exited with code: ${code}`);
      if (code !== 0 && !this.useTestSource && this.camera) {
        console.log('\nCamera access failed! Common solutions:');
        console.log('1. Grant camera permissions to Terminal/iTerm');
        console.log('2. Close other apps using the camera');
        console.log('3. Try running: tccutil reset Camera');
        console.log('4. On macOS 14+, check System Settings > Privacy & Security > Camera');
      }
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
      buffer.clear(RGBA.fromHex('#000000'))
      
      // Render video with simple dithering
      for (let y = 0; y < this.height; y++) {
        for (let x = 0; x < this.width; x++) {
          const idx = (y * this.videoWidth + x) * 3
          
          if (idx + 2 < this.videoBuffer.length) {
            const r = this.videoBuffer[idx]
            const g = this.videoBuffer[idx + 1]
            const b = this.videoBuffer[idx + 2]
            
            const color = RGBA.fromRGB(r, g, b)
            
            // Use different characters based on brightness
            const brightness = (r + g + b) / 3
            let char: string
            
            if (brightness > 200) {
              char = '█' // Full block
            } else if (brightness > 150) {
              char = '▓' // Dark shade
            } else if (brightness > 100) {
              char = '▒' // Medium shade  
            } else if (brightness > 50) {
              char = '░' // Light shade
            } else {
              char = ' ' // Space
            }
            
            buffer.setCell(x, y, char, color, RGBA.fromHex('#000000'))
          }
        }
      }
      
      // Status overlay
      const source = this.useTestSource ? 'TEST SOURCE' : (this.camera?.name || 'UNKNOWN')
      const statusText = `${source} | FPS: ${this.fps} | Press Q to quit`
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