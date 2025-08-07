#!/usr/bin/env bun
import { createCliRenderer, RGBA } from '@opentui/core';

async function main() {
  console.log('Creating renderer...');
  
  const renderer = await createCliRenderer({
    targetFps: 30,
    stdin: process.stdin,
    stdout: process.stdout,
    exitOnCtrlC: true,
    useAlternateScreen: true
  });
  
  console.log(`Renderer created: ${renderer.width}x${renderer.height}`);
  
  // Create a simple test pattern
  const testBuffer = renderer.createFrameBuffer('test', {
    x: 0,
    y: 0,
    width: renderer.width,
    height: renderer.height,
    zIndex: 1,
    visible: true
  });
  
  let frame = 0;
  
  // Animation loop
  renderer.setFrameCallback(async (deltaTime) => {
    frame++;
    
    const buffer = testBuffer.buffer;
    const bg = RGBA.fromHex('#000000');
    buffer.clear(bg);
    
    // Draw a simple pattern
    const chars = '.oO@';
    const t = frame / 30;
    
    for (let y = 0; y < renderer.height; y++) {
      for (let x = 0; x < renderer.width; x++) {
        const wave = Math.sin(x * 0.1 + t) * Math.cos(y * 0.1 + t);
        const charIdx = Math.floor((wave + 1) * 2) % chars.length;
        const brightness = Math.floor((wave + 1) * 127);
        
        buffer.setCell(
          x, y, 
          chars[charIdx],
          RGBA.fromRGB(0, brightness, brightness),
          bg
        );
      }
    }
    
    // Add frame counter
    const text = `Frame: ${frame}`;
    for (let i = 0; i < text.length; i++) {
      buffer.setCell(i, 0, text[i], RGBA.fromRGB(255, 255, 255), bg);
    }
    
    testBuffer.needsUpdate = true;
  });
  
  console.log('Starting renderer...');
  renderer.start();
  
  // Keep alive
  process.stdin.resume();
}

main().catch(console.error);