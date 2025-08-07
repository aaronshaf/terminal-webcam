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
  
  // Create renderer with minimal options
  const renderer = await createCliRenderer({
    targetFps: 15,
    useAlternateScreen: true,
    exitOnCtrlC: true
  });
  
  const width = Math.min(120, renderer.width);
  const height = Math.min(40, renderer.height);
  
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
  
  ffmpeg.stdout?.on('data', (chunk: Buffer) => {
    // Fill buffer
    while (pos < frameSize && chunk.length > 0) {
      const toRead = Math.min(frameSize - pos, chunk.length);
      chunk.copy(videoData, pos, 0, toRead);
      pos += toRead;
      
      // Frame complete
      if (pos >= frameSize) {
        frameCount++;
        updateFrame();
        pos = 0;
        
        // Handle remaining data
        if (toRead < chunk.length) {
          chunk = chunk.slice(toRead);
        } else {
          break;
        }
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
      
      // Add frame counter
      const text = `Frame: ${frameCount}`;
      const white = RGBA.fromRGB(255, 255, 255);
      for (let i = 0; i < text.length && i < width; i++) {
        buffer.setCell(i, 0, text[i], white, RGBA.fromRGB(50, 50, 50));
      }
      
      frameBuffer.needsUpdate = true;
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

main().catch(console.error);