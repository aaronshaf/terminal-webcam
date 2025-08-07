#!/usr/bin/env bun
import { createCliRenderer, FrameBufferRenderable, RGBA } from '@opentui/core';
import { spawn } from 'child_process';

async function main() {
  const renderer = await createCliRenderer({
    targetFps: 15,
    stdin: process.stdin,
    stdout: process.stdout
  });

  const width = renderer.width;
  const height = renderer.height;
  
  // Create a frame buffer for the webcam feed
  const webcamBuffer = renderer.createFrameBuffer('webcam', {
    x: 0,
    y: 0,
    width: width,
    height: height,
    zIndex: 1
  });

  const asciiChars = ' .:-=+*#%@';
  
  console.log('Starting webcam capture...');
  
  // Use ffmpeg to capture webcam
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'avfoundation',
    '-framerate', '15',
    '-video_size', '640x480',
    '-i', '0',
    '-vf', `scale=${width}:${height}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    'pipe:1'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let frameBuffer = Buffer.alloc(width * height);
  let bufferIndex = 0;

  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    chunk.copy(frameBuffer, bufferIndex);
    bufferIndex += chunk.length;
    
    if (bufferIndex >= frameBuffer.length) {
      // Convert grayscale buffer to ASCII and render
      const buffer = webcamBuffer.buffer;
      buffer.clear(RGBA.fromHex('#000000'));
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const brightness = frameBuffer[idx];
          const charIndex = Math.floor((brightness / 255) * (asciiChars.length - 1));
          const char = asciiChars[charIndex];
          
          // Set the character with appropriate brightness
          const color = RGBA.fromRGB(brightness, brightness, brightness);
          buffer.setCell(x, y, char, color, RGBA.fromHex('#000000'));
        }
      }
      
      bufferIndex = 0;
    }
  });

  ffmpeg.stderr.on('data', (data) => {
    // Silently ignore stderr unless debugging
  });

  ffmpeg.on('error', (err) => {
    console.error('FFmpeg error:', err);
    console.error('Make sure ffmpeg is installed: brew install ffmpeg');
    process.exit(1);
  });

  ffmpeg.on('exit', (code) => {
    console.log('FFmpeg exited with code:', code);
    renderer.stop();
    process.exit(0);
  });

  // Start the renderer
  renderer.start();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nStopping webcam capture...');
    ffmpeg.kill();
    renderer.stop();
    process.exit(0);
  });
}

main().catch(console.error);