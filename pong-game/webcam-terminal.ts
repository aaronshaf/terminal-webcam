#!/usr/bin/env bun
import { createCliRenderer } from '@opentui/core';
import { spawn } from 'child_process';

const renderer = await createCliRenderer({
  targetFps: 15
});

const asciiChars = ' .:-=+*#%@';

function startWebcamCapture() {
  console.log('Starting webcam capture...');
  
  // Use ffmpeg to capture webcam and convert to ASCII art
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'avfoundation',
    '-framerate', '15',
    '-video_size', '640x480',
    '-i', '0',
    '-vf', `scale=${renderer.width}:${renderer.height}`,
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    'pipe:1'
  ], {
    stdio: ['ignore', 'pipe', 'ignore']
  });

  let frameBuffer = Buffer.alloc(renderer.width * renderer.height);
  let bufferIndex = 0;

  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    chunk.copy(frameBuffer, bufferIndex);
    bufferIndex += chunk.length;
    
    if (bufferIndex >= frameBuffer.length) {
      const asciiFrame = convertToAscii(frameBuffer, renderer.width, renderer.height);
      renderAsciiToBuffer(asciiFrame);
      bufferIndex = 0;
    }
  });

  ffmpeg.on('error', (err) => {
    console.error('FFmpeg error:', err);
    console.error('Error: Could not start webcam capture. Make sure ffmpeg is installed.');
  });

  ffmpeg.on('exit', (code) => {
    console.log('FFmpeg exited with code:', code);
  });

  return ffmpeg;
}

function convertToAscii(buffer: Buffer, width: number, height: number): string {
  let ascii = '';
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const brightness = buffer[idx];
      const charIndex = Math.floor((brightness / 255) * (asciiChars.length - 1));
      ascii += asciiChars[charIndex];
    }
    ascii += '\n';
  }
  
  return ascii;
}

function renderAsciiToBuffer(asciiFrame: string) {
  const buffer = renderer.nextRenderBuffer;
  buffer.clear({ r: 0, g: 0, b: 0, a: 255 });
  
  const lines = asciiFrame.split('\n');
  for (let y = 0; y < lines.length && y < renderer.height; y++) {
    const line = lines[y];
    for (let x = 0; x < line.length && x < renderer.width; x++) {
      const char = line[x];
      const brightness = (asciiChars.indexOf(char) / (asciiChars.length - 1)) * 255;
      buffer.setCell(x, y, char, { r: brightness, g: brightness, b: brightness, a: 255 }, { r: 0, g: 0, b: 0, a: 255 });
    }
  }
}

const ffmpegProcess = startWebcamCapture();

renderer.start();

process.on('SIGINT', () => {
  console.log('\nStopping webcam capture...');
  ffmpegProcess.kill();
  renderer.stop();
  process.exit(0);
});