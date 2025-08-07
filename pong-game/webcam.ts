#!/usr/bin/env bun
import { createCliRenderer, RGBA } from '@opentui/core';
import { spawn, execSync } from 'child_process';
import * as readline from 'readline';

async function getVideoDevices(): Promise<{ index: number; name: string }[]> {
  try {
    const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1', { 
      encoding: 'utf8' 
    });
    
    const devices: { index: number; name: string }[] = [];
    const lines = output.split('\n');
    let inVideoSection = false;
    
    for (const line of lines) {
      if (line.includes('AVFoundation video devices:')) {
        inVideoSection = true;
        continue;
      }
      if (line.includes('AVFoundation audio devices:')) {
        break;
      }
      if (inVideoSection) {
        const match = line.match(/\[(\d+)\]\s+(.+)/);
        if (match) {
          devices.push({
            index: parseInt(match[1]),
            name: match[2].trim()
          });
        }
      }
    }
    
    return devices.filter(d => !d.name.includes('Capture screen'));
  } catch (error) {
    console.error('Failed to list devices:', error);
    return [];
  }
}

async function selectDevice(devices: { index: number; name: string }[]): Promise<number> {
  console.log('\nAvailable cameras:');
  devices.forEach((device, i) => {
    console.log(`  ${i + 1}. ${device.name}`);
  });
  
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  
  return new Promise((resolve) => {
    rl.question('\nSelect camera (enter number): ', (answer) => {
      rl.close();
      const selection = parseInt(answer);
      if (selection >= 1 && selection <= devices.length) {
        resolve(devices[selection - 1].index);
      } else {
        console.log('Invalid selection, using first camera');
        resolve(devices[0].index);
      }
    });
  });
}

async function main() {
  // Get available video devices
  const devices = await getVideoDevices();
  
  if (devices.length === 0) {
    console.error('No video devices found!');
    process.exit(1);
  }
  
  // Let user select device
  const deviceIndex = await selectDevice(devices);
  const selectedDevice = devices.find(d => d.index === deviceIndex);
  
  console.log(`\nUsing camera: ${selectedDevice?.name}\n`);
  
  // Create renderer
  const renderer = await createCliRenderer({
    targetFps: 15,
    stdin: process.stdin,
    stdout: process.stdout,
    exitOnCtrlC: true,
    useAlternateScreen: true
  });

  const width = Math.floor(renderer.width);
  const height = Math.floor(renderer.height);
  
  // Create a frame buffer
  const frameBuffer = renderer.createFrameBuffer('webcam', {
    x: 0,
    y: 0,
    width,
    height,
    zIndex: 1,
    visible: true
  });

  // ASCII characters for different brightness levels
  const asciiChars = ' .,:;i1tfLCG08@';
  
  console.error(`Starting webcam stream (${width}x${height})...`);
  console.error('Press Ctrl+C to exit\n');
  
  // Start ffmpeg with selected device
  const ffmpeg = spawn('ffmpeg', [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 'avfoundation',
    '-framerate', '15',
    '-pixel_format', 'uyvy422',
    '-i', deviceIndex.toString(),
    '-vf', `scale=${width}:${height}:flags=fast_bilinear`,
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
    const buffer = frameBuffer.buffer;
    const bg = RGBA.fromHex('#000000');
    buffer.clear(bg);
    
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const brightness = videoBuffer[idx];
        
        // Map brightness to ASCII character
        const charIdx = Math.min(
          asciiChars.length - 1,
          Math.floor((brightness / 255) * asciiChars.length)
        );
        const char = asciiChars[charIdx];
        
        // Color with green tint for matrix effect
        const level = Math.floor((brightness / 255) * 255);
        const color = RGBA.fromRGB(0, level, Math.floor(level * 0.3));
        
        buffer.setCell(x, y, char, color, bg);
      }
    }
    
    // Add frame counter in corner
    const counterText = `FPS: ${frameCount}`;
    for (let i = 0; i < counterText.length && i < width; i++) {
      buffer.setCell(i, 0, counterText[i], RGBA.fromRGB(0, 255, 0), bg);
    }
    
    frameBuffer.needsUpdate = true;
  }

  // Reset frame counter every second
  setInterval(() => {
    frameCount = 0;
  }, 1000);

  ffmpeg.stderr.on('data', (data) => {
    const error = data.toString();
    if (error.includes('Input/output error') || error.includes('Device not found')) {
      console.error('\nCamera error - device may be in use or disconnected');
      ffmpeg.kill();
    } else {
      console.error('FFmpeg:', error);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('Failed to start webcam:', err.message);
    renderer.stop();
    process.exit(1);
  });

  ffmpeg.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`\nFFmpeg exited with code ${code}`);
    }
    renderer.stop();
    process.exit(0);
  });

  // Start rendering
  renderer.start();

  // Cleanup on exit
  process.on('SIGINT', () => {
    console.error('\nStopping webcam...');
    ffmpeg.kill();
    setTimeout(() => {
      renderer.stop();
      process.exit(0);
    }, 100);
  });
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});