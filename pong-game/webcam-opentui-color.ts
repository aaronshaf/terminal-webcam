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
  
  console.error('Available cameras:');
  cameras.forEach((cam, i) => {
    console.error(`  ${i + 1}. ${cam.name}`);
  });
  
  const selectedCamera = cameras[0];
  console.error(`\nUsing: ${selectedCamera.name}`);
  console.error('Starting COLOR webcam with OpenTUI...');
  console.error('Press Ctrl+C to exit\n');
  
  // Wait a moment before starting
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Create OpenTUI renderer
  const renderer = await createCliRenderer({
    targetFps: 30,
    stdin: process.stdin,
    stdout: process.stdout,
    exitOnCtrlC: true,
    useAlternateScreen: true,
    useMouse: false,
    useConsole: false
  });
  
  // Get terminal dimensions
  const width = renderer.width;
  const height = renderer.height;
  
  console.error(`OpenTUI size: ${width}x${height}`);
  
  // Create frame buffer for webcam
  const webcamBuffer = renderer.createFrameBuffer('webcam', {
    x: 0,
    y: 0,
    width,
    height,
    zIndex: 1,
    visible: true
  });
  
  let ffmpeg: any = null;
  
  function startFFmpeg() {
    // Kill existing ffmpeg if running
    if (ffmpeg) {
      ffmpeg.kill();
    }
    
    // Start ffmpeg with RGB output
    ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'avfoundation',
      '-framerate', '30',
      '-video_size', '640x480',
      '-i', selectedCamera.index,
      '-vf', `scale=${width}:${height}:flags=fast_bilinear,fps=30`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',  // RGB color output
      '-'
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    const frameSize = width * height * 3; // 3 bytes per pixel (RGB)
    let videoBuffer = Buffer.alloc(frameSize);
    let bufferPos = 0;
    let frameCount = 0;
    let fps = 0;
    
    // FPS counter
    const fpsInterval = setInterval(() => {
      fps = frameCount;
      frameCount = 0;
    }, 1000);
    
    // ASCII characters for different brightness levels
    const asciiChars = ' .,:;ox%#@';
    
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
      
      // Clear buffer
      buffer.clear(bg);
      
      // Render ASCII art with full color
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 3;
          const r = videoBuffer[idx];
          const g = videoBuffer[idx + 1];
          const b = videoBuffer[idx + 2];
          
          // Calculate brightness for ASCII character selection
          const brightness = (r + g + b) / 3;
          
          // Map brightness to ASCII character
          const charIdx = Math.min(
            asciiChars.length - 1,
            Math.floor((brightness / 255) * asciiChars.length)
          );
          const char = asciiChars[charIdx];
          
          // Create color from RGB values
          const color = RGBA.fromRGB(r, g, b);
          
          // Set the cell with the character and its color
          buffer.setCell(x, y, char, color, bg);
        }
      }
      
      // Add status bar at top
      const statusText = `${selectedCamera.name} | ${width}x${height} | FPS: ${fps}`;
      const statusBg = RGBA.fromRGB(40, 40, 40);
      const statusFg = RGBA.fromRGB(255, 255, 255);
      
      for (let x = 0; x < width; x++) {
        buffer.setCell(x, 0, ' ', statusFg, statusBg);
      }
      
      for (let i = 0; i < statusText.length && i < width; i++) {
        buffer.setCell(i + 2, 0, statusText[i], statusFg, statusBg);
      }
      
      // Mark buffer as needing update
      webcamBuffer.needsUpdate = true;
    }
    
    ffmpeg.stderr.on('data', (data: Buffer) => {
      console.error('FFmpeg:', data.toString());
    });
    
    ffmpeg.on('error', (err: Error) => {
      console.error('FFmpeg error:', err.message);
      clearInterval(fpsInterval);
      renderer.stop();
      process.exit(1);
    });
    
    ffmpeg.on('exit', (code: number) => {
      clearInterval(fpsInterval);
      if (code !== null && code !== 0) {
        console.error(`FFmpeg exited with code ${code}`);
      }
      renderer.stop();
      process.exit(code || 0);
    });
  }
  
  // Start ffmpeg
  startFFmpeg();
  
  // Start renderer
  renderer.start();
  
  // Handle terminal resize
  renderer.on('resize', (newWidth: number, newHeight: number) => {
    console.error(`\nTerminal resized to ${newWidth}x${newHeight}, restarting stream...`);
    
    // Update the frame buffer size
    renderer.remove('webcam');
    const newBuffer = renderer.createFrameBuffer('webcam', {
      x: 0,
      y: 0,
      width: newWidth,
      height: newHeight,
      zIndex: 1,
      visible: true
    });
    
    // Restart ffmpeg with new dimensions
    startFFmpeg();
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.error('\nStopping webcam...');
    if (ffmpeg) {
      ffmpeg.kill();
    }
    setTimeout(() => {
      renderer.stop();
      process.exit(0);
    }, 100);
  });
  
  // Keep process alive
  process.stdin.resume();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});