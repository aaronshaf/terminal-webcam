#!/usr/bin/env bun
import { createCliRenderer, RGBA } from '@opentui/core';
import { spawn } from 'child_process';

async function main() {
  const renderer = await createCliRenderer({
    targetFps: 30,
    stdin: process.stdin,
    stdout: process.stdout,
    exitOnCtrlC: false
  });

  const width = renderer.width;
  const height = renderer.height;
  
  console.log(`Terminal size: ${width}x${height}`);
  console.log('Starting webcam capture...');
  
  // Create a frame buffer for rendering
  const frameBuffer = renderer.createFrameBuffer('webcam', {
    x: 0,
    y: 0,
    width: width,
    height: height,
    zIndex: 1,
    visible: true
  });

  const asciiChars = ' .:-=+*#%@';
  
  // Start ffmpeg to capture webcam
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'avfoundation',
    '-framerate', '30',
    '-video_size', '1280x720',
    '-i', '0',  // Use default camera
    '-vf', `scale=${width}:${height}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let videoBuffer = Buffer.alloc(width * height);
  let bufferIndex = 0;
  let frameCount = 0;

  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    // Copy chunk to our buffer
    const remaining = videoBuffer.length - bufferIndex;
    const toCopy = Math.min(chunk.length, remaining);
    chunk.copy(videoBuffer, bufferIndex, 0, toCopy);
    bufferIndex += toCopy;
    
    // When we have a complete frame
    if (bufferIndex >= videoBuffer.length) {
      frameCount++;
      
      // Clear the buffer
      const buffer = frameBuffer.buffer;
      buffer.clear(RGBA.fromHex('#000000'));
      
      // Render ASCII art
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = y * width + x;
          const brightness = videoBuffer[idx];
          
          // Map brightness to ASCII character
          const charIndex = Math.floor((brightness / 255) * (asciiChars.length - 1));
          const char = asciiChars[charIndex];
          
          // Use green tinted color for matrix effect
          const green = brightness;
          const color = RGBA.fromRGB(0, green, 0);
          
          buffer.setCell(x, y, char, color, RGBA.fromHex('#000000'));
        }
      }
      
      // Mark frame buffer as needing update
      frameBuffer.needsUpdate = true;
      renderer.needsUpdate = true;
      
      // Reset for next frame
      bufferIndex = 0;
      
      // Process any remaining data from this chunk
      if (toCopy < chunk.length) {
        chunk.copy(videoBuffer, 0, toCopy);
        bufferIndex = chunk.length - toCopy;
      }
    }
  });

  ffmpeg.stderr.on('data', (data) => {
    // Log ffmpeg messages for debugging
    const message = data.toString();
    if (message.includes('error') || message.includes('Error')) {
      console.error('FFmpeg:', message);
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('Failed to start ffmpeg:', err.message);
    console.error('Make sure ffmpeg is installed: brew install ffmpeg');
    console.error('Also check that camera permissions are granted');
    renderer.stop();
    process.exit(1);
  });

  ffmpeg.on('exit', (code) => {
    console.log(`FFmpeg exited with code: ${code}`);
    if (code !== 0) {
      console.error('FFmpeg failed. Try running this command to test:');
      console.error('ffmpeg -f avfoundation -list_devices true -i ""');
    }
    renderer.stop();
    process.exit(code || 0);
  });

  // Start rendering
  renderer.start();
  
  // Status update
  setInterval(() => {
    if (frameCount > 0) {
      process.stderr.write(`\rFrames processed: ${frameCount}`);
    }
  }, 1000);

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    ffmpeg.kill('SIGTERM');
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