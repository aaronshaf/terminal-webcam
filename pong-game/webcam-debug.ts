#!/usr/bin/env bun
import { createCliRenderer, RGBA } from '@opentui/core';
import { spawn, execSync } from 'child_process';

async function main() {
  // Get first camera
  const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', { 
    encoding: 'utf8',
    shell: true 
  });
  
  let cameraIndex = '0';
  let cameraName = 'Unknown Camera';
  
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
  
  console.error(`Using camera: ${cameraName} (index ${cameraIndex})`);
  console.error('Creating renderer...');
  
  // Create renderer WITHOUT alternate screen
  const renderer = await createCliRenderer({
    targetFps: 15,
    stdin: process.stdin,
    stdout: process.stdout,
    exitOnCtrlC: false,
    useAlternateScreen: false,  // Don't use alternate screen
    useMouse: false,
    useConsole: false
  });
  
  const width = Math.min(80, renderer.width);  // Limit size
  const height = Math.min(24, renderer.height);
  
  console.error(`Renderer size: ${width}x${height}`);
  
  // Create frame buffer
  const frameBuffer = renderer.createFrameBuffer('webcam', {
    x: 0,
    y: 0,
    width,
    height,
    zIndex: 1,
    visible: true
  });
  
  console.error('Starting ffmpeg...');
  
  // Start ffmpeg with error handling
  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'warning',
    '-f', 'avfoundation',
    '-framerate', '30',
    '-video_size', '640x480',
    '-i', cameraIndex,
    '-vf', `scale=${width}:${height}`,
    '-r', '10',  // Lower output fps
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  const frameSize = width * height;
  let videoData = Buffer.alloc(frameSize);
  let pos = 0;
  let frameCount = 0;
  
  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    let offset = 0;
    
    while (offset < chunk.length) {
      const remaining = frameSize - pos;
      const toCopy = Math.min(remaining, chunk.length - offset);
      
      chunk.copy(videoData, pos, offset, offset + toCopy);
      pos += toCopy;
      offset += toCopy;
      
      if (pos >= frameSize) {
        frameCount++;
        updateFrame();
        pos = 0;
        
        // Log progress
        if (frameCount % 10 === 0) {
          console.error(`Rendered ${frameCount} frames`);
        }
      }
    }
  });
  
  const asciiChars = ' .:-=+*#%@';
  
  function updateFrame() {
    try {
      const buffer = frameBuffer.buffer;
      const black = RGBA.fromHex('#000000');
      buffer.clear(black);
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const brightness = videoData[y * width + x] || 0;
          const charIdx = Math.floor((brightness / 255) * (asciiChars.length - 1));
          const char = asciiChars[Math.max(0, Math.min(charIdx, asciiChars.length - 1))];
          
          // Simple white on black
          const color = RGBA.fromRGB(brightness, brightness, brightness);
          
          buffer.setCell(x, y, char, color, black);
        }
      }
      
      // Add frame counter
      const text = `Frame: ${frameCount}`;
      for (let i = 0; i < text.length && i < width; i++) {
        buffer.setCell(i, 0, text[i], RGBA.fromRGB(255, 0, 0), black);
      }
      
      frameBuffer.needsUpdate = true;
      
      // Force render on first frames
      if (frameCount <= 5) {
        renderer.intermediateRender();
      }
    } catch (e) {
      console.error('Error in updateFrame:', e);
    }
  }
  
  ffmpeg.stderr.on('data', (data) => {
    console.error('FFmpeg warning:', data.toString());
  });
  
  ffmpeg.on('error', (err) => {
    console.error('FFmpeg error:', err);
    renderer.stop();
    process.exit(1);
  });
  
  ffmpeg.on('exit', (code) => {
    console.error(`FFmpeg exited with code: ${code}`);
    renderer.stop();
    process.exit(0);
  });
  
  // Start renderer
  console.error('Starting renderer...');
  renderer.start();
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    console.error('\nShutting down...');
    ffmpeg.kill();
    setTimeout(() => {
      renderer.stop();
      process.exit(0);
    }, 100);
  });
  
  // Keep process alive
  process.stdin.resume();
  
  console.error('Webcam viewer running. Press Ctrl+C to exit.');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});