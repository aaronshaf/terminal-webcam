#!/usr/bin/env bun

console.log('Testing basic OpenTUI...');

import { createCliRenderer, RGBA } from '@opentui/core';

async function test() {
  console.log('Creating renderer...');
  
  try {
    const renderer = await createCliRenderer({
      targetFps: 1,
      stdin: process.stdin,
      stdout: process.stdout,
      useAlternateScreen: false,
      exitOnCtrlC: true
    });
    
    console.log(`SUCCESS: Renderer created with size ${renderer.width}x${renderer.height}`);
    
    // Draw something simple
    const buffer = renderer.nextRenderBuffer;
    buffer.clear(RGBA.fromHex('#000000'));
    
    // Write "HELLO" in the middle
    const text = "HELLO WORLD";
    const startX = Math.floor((renderer.width - text.length) / 2);
    const y = Math.floor(renderer.height / 2);
    
    for (let i = 0; i < text.length; i++) {
      buffer.setCell(startX + i, y, text[i], RGBA.fromRGB(0, 255, 0), RGBA.fromHex('#000000'));
    }
    
    console.log('Starting renderer...');
    renderer.start();
    
    // Stop after 2 seconds
    setTimeout(() => {
      console.log('Stopping...');
      renderer.stop();
      process.exit(0);
    }, 2000);
    
  } catch (e) {
    console.error('ERROR:', e);
    process.exit(1);
  }
}

test();