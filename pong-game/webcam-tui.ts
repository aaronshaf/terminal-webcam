#!/usr/bin/env bun
import { createCliRenderer, RGBA } from '@opentui/core';
import { spawn, execSync } from 'child_process';

// Get list of cameras
function getCameras() {
  try {
    const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', { 
      encoding: 'utf8',
      shell: true 
    });
    
    const devices: { index: string; name: string }[] = [];
    const lines = output.split('\n');
    
    let capturing = false;
    for (const line of lines) {
      if (line.includes('AVFoundation video devices:')) {
        capturing = true;
        continue;
      }
      if (line.includes('AVFoundation audio devices:')) break;
      
      if (capturing && line.includes('[AVFoundation indev @')) {
        const match = line.match(/\[AVFoundation indev @ [^\]]+\]\s+\[(\d+)\]\s+(.+)/);
        if (match && !match[2].includes('Capture screen')) {
          devices.push({ index: match[1], name: match[2] });
        }
      }
    }
    return devices;
  } catch (e: any) {
    console.error('Error getting cameras:', e.message);
    return [];
  }
}

async function main() {
  const cameras = getCameras();
  
  if (cameras.length === 0) {
    console.error('No cameras found!');
    process.exit(1);
  }
  
  console.log('Available cameras:');
  cameras.forEach((cam, i) => {
    console.log(`  ${i + 1}. ${cam.name}`);
  });
  
  // For simplicity, use the first camera
  const selectedCamera = cameras[0];
  console.log(`\nUsing: ${selectedCamera.name}`);
  console.log('Starting webcam stream...\n');
  
  // Create OpenTUI renderer
  const renderer = await createCliRenderer({
    targetFps: 30,
    stdin: process.stdin,
    stdout: process.stdout,
    exitOnCtrlC: true,
    useAlternateScreen: true,
    useMouse: false
  });
  
  const width = renderer.width;
  const height = renderer.height;
  
  // Create frame buffer for webcam
  const webcamBuffer = renderer.createFrameBuffer('webcam', {
    x: 0,
    y: 0,
    width,
    height,
    zIndex: 1,
    visible: true
  });
  
  // ASCII characters for brightness mapping
  const asciiChars = ' .,:;i1tfLCG08@';
  
  // Start ffmpeg
  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'avfoundation',
    '-framerate', '30',
    '-video_size', '640x480',
    '-i', selectedCamera.index,
    '-vf', `scale=${width}:${height}:flags=fast_bilinear,fps=30`,
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  const frameSize = width * height;
  let videoBuffer = Buffer.alloc(frameSize);
  let bufferPos = 0;
  let frameCount = 0;
  let fps = 0;
  
  // Update FPS counter
  setInterval(() => {
    fps = frameCount;
    frameCount = 0;
  }, 1000);
  
  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    let chunkPos = 0;
    
    while (chunkPos < chunk.length) {
      const remaining = frameSize - bufferPos;
      const toCopy = Math.min(remaining, chunk.length - chunkPos);
      
      chunk.copy(videoBuffer, bufferPos, chunkPos, chunkPos + toCopy);
      bufferPos += toCopy;
      chunkPos += toCopy;
      
      // Complete frame received
      if (bufferPos >= frameSize) {
        renderFrame();
        bufferPos = 0;
        frameCount++;
      }
    }
  });
  
  function renderFrame() {
    const buffer = webcamBuffer.buffer;
    const bg = RGBA.fromHex('#000000');
    buffer.clear(bg);
    
    // Render ASCII art
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const brightness = videoBuffer[idx];
        
        // Map to ASCII character
        const charIdx = Math.min(
          asciiChars.length - 1,
          Math.floor((brightness / 255) * asciiChars.length)
        );
        const char = asciiChars[charIdx];
        
        // Green matrix effect
        const level = Math.floor((brightness / 255) * 255);
        const color = RGBA.fromRGB(0, level, Math.floor(level * 0.2));
        
        buffer.setCell(x, y, char, color, bg);
      }
    }
    
    // Add FPS counter
    const fpsText = `FPS: ${fps} | ${selectedCamera.name}`;
    const textColor = RGBA.fromRGB(0, 255, 0);
    for (let i = 0; i < fpsText.length && i < width; i++) {
      buffer.setCell(i, 0, fpsText[i], textColor, bg);
    }
    
    // Add instructions at bottom
    const helpText = 'Press Ctrl+C to exit';
    for (let i = 0; i < helpText.length && i < width; i++) {
      buffer.setCell(i, height - 1, helpText[i], RGBA.fromRGB(100, 100, 100), bg);
    }
    
    webcamBuffer.needsUpdate = true;
  }
  
  ffmpeg.stderr.on('data', (data) => {
    const error = data.toString();
    if (error.includes('Input/output error')) {
      console.error('\nCamera error - device may be in use or disconnected');
      ffmpeg.kill();
    }
  });
  
  ffmpeg.on('error', (err) => {
    console.error('FFmpeg error:', err.message);
    renderer.stop();
    process.exit(1);
  });
  
  ffmpeg.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`FFmpeg exited with code ${code}`);
    }
    renderer.stop();
    process.exit(0);
  });
  
  // Start rendering
  renderer.start();
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    ffmpeg.kill();
    setTimeout(() => {
      renderer.stop();
      process.exit(0);
    }, 100);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});