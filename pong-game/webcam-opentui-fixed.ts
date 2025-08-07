#!/usr/bin/env bun
import { createCliRenderer, RGBA } from '@opentui/core';
import { spawn, execSync } from 'child_process';

async function main() {
  // Get first camera
  let cameraIndex = '0';
  let cameraName = 'Camera';
  
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
          cameraIndex = match[1];
          cameraName = match[2];
          break;
        }
      }
    }
  } catch (e) {
    console.log('Using default camera');
  }
  
  console.log(`Using: ${cameraName} (${cameraIndex})`);
  console.log('Starting OpenTUI color webcam...\n');
  
  // IMPORTANT: Make sure we pass the actual process stdin/stdout
  // that have the required methods
  const stdin = process.stdin as any;
  const stdout = process.stdout as any;
  
  // Ensure stdin has the required method
  if (!stdin.setRawMode) {
    console.error('Error: stdin.setRawMode not available. Running in non-TTY environment?');
    process.exit(1);
  }
  
  // Create renderer with proper stdin/stdout
  const renderer = await createCliRenderer({
    stdin: stdin,
    stdout: stdout,
    targetFps: 15,
    useAlternateScreen: true,
    exitOnCtrlC: true
  });
  
  const width = renderer.width;
  const height = renderer.height;
  
  console.log(`Size: ${width}x${height}`);
  
  // Create frame buffer
  const frameBuffer = renderer.createFrameBuffer('webcam', {
    x: 0,
    y: 0,
    width,
    height,
    zIndex: 1,
    visible: true
  });
  
  // Start ffmpeg
  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'avfoundation',
    '-framerate', '30',
    '-video_size', '640x480',
    '-i', cameraIndex,
    '-vf', `scale=${width}:${height}`,
    '-r', '15',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-'
  ]);
  
  const frameSize = width * height * 3;
  let videoData = Buffer.alloc(frameSize);
  let pos = 0;
  let frameCount = 0;
  let fps = 0;
  
  // FPS counter
  setInterval(() => {
    fps = frameCount;
    frameCount = 0;
  }, 1000);
  
  ffmpeg.stdout?.on('data', (chunk: Buffer) => {
    // Fill buffer
    let offset = 0;
    while (offset < chunk.length) {
      const toRead = Math.min(frameSize - pos, chunk.length - offset);
      chunk.copy(videoData, pos, offset, offset + toRead);
      pos += toRead;
      offset += toRead;
      
      // Frame complete
      if (pos >= frameSize) {
        updateFrame();
        pos = 0;
      }
    }
  });
  
  const asciiChars = ' .,:;ox%#@';
  
  function updateFrame() {
    try {
      const buffer = frameBuffer.buffer;
      const black = RGBA.fromHex('#000000');
      buffer.clear(black);
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 3;
          const r = videoData[idx] || 0;
          const g = videoData[idx + 1] || 0;
          const b = videoData[idx + 2] || 0;
          
          const brightness = (r + g + b) / 3;
          const charIdx = Math.floor((brightness / 255) * (asciiChars.length - 1));
          const char = asciiChars[Math.max(0, Math.min(charIdx, asciiChars.length - 1))];
          
          const color = RGBA.fromRGB(r, g, b);
          buffer.setCell(x, y, char, color, black);
        }
      }
      
      // Add status bar
      const text = `${cameraName} | FPS: ${fps}`;
      const white = RGBA.fromRGB(255, 255, 255);
      for (let i = 0; i < text.length && i < width; i++) {
        buffer.setCell(i, 0, text[i], white, RGBA.fromRGB(50, 50, 50));
      }
      
      frameBuffer.needsUpdate = true;
      frameCount++;
    } catch (e) {
      console.error('Frame error:', e);
    }
  }
  
  ffmpeg.stderr?.on('data', (data) => {
    console.error('FFmpeg:', data.toString());
  });
  
  ffmpeg.on('exit', (code) => {
    console.log(`FFmpeg exit: ${code}`);
    renderer.stop();
    process.exit(0);
  });
  
  // Start rendering
  renderer.start();
  
  // Cleanup
  process.on('SIGINT', () => {
    ffmpeg.kill();
    renderer.stop();
    process.exit(0);
  });
}

// Make sure we're running in a TTY
if (!process.stdin.isTTY) {
  console.error('Error: Must run in a terminal (TTY)');
  process.exit(1);
}

main().catch(console.error);