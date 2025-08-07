#!/usr/bin/env bun
import { createCliRenderer, RGBA } from '@opentui/core';

console.error('Step 1: Starting test...');

async function test() {
  console.error('Step 2: Creating renderer...');
  
  const renderer = await createCliRenderer({
    targetFps: 30,
    stdin: process.stdin,
    stdout: process.stdout,
    useAlternateScreen: true,
    exitOnCtrlC: true
  });
  
  console.error(`Step 3: Renderer created - ${renderer.width}x${renderer.height}`);
  
  // Create a simple test pattern
  const testBuffer = renderer.createFrameBuffer('test', {
    x: 0,
    y: 0,
    width: renderer.width,
    height: renderer.height,
    zIndex: 1,
    visible: true
  });
  
  console.error('Step 4: Frame buffer created');
  
  // Draw something simple
  const buffer = testBuffer.buffer;
  const bg = RGBA.fromHex('#000000');
  const fg = RGBA.fromRGB(0, 255, 0);
  
  buffer.clear(bg);
  
  // Draw a test pattern
  for (let y = 0; y < renderer.height; y++) {
    for (let x = 0; x < renderer.width; x++) {
      const char = ((x + y) % 2 === 0) ? '#' : ' ';
      buffer.setCell(x, y, char, fg, bg);
    }
  }
  
  // Write text in the middle
  const text = 'OPENTUI TEST';
  const startX = Math.floor((renderer.width - text.length) / 2);
  const startY = Math.floor(renderer.height / 2);
  
  for (let i = 0; i < text.length; i++) {
    buffer.setCell(startX + i, startY, text[i], RGBA.fromRGB(255, 0, 0), RGBA.fromRGB(255, 255, 255));
  }
  
  testBuffer.needsUpdate = true;
  
  console.error('Step 5: Starting renderer...');
  renderer.start();
  
  console.error('Step 6: Renderer started. Should see checkerboard pattern.');
  console.error('Press Ctrl+C to exit');
  
  // Keep alive
  await new Promise(() => {});
}

test().catch(e => {
  console.error('ERROR:', e);
  process.exit(1);
});