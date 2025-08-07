#!/usr/bin/env bun
import { createCliRenderer, RGBA } from "@opentui/core"
import { ptr } from 'bun:ffi';

async function main() {
  console.log('Testing super sample with exact dimensions...')
  
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const termWidth = renderer.terminalWidth
  const termHeight = renderer.terminalHeight
  
  console.log(`Terminal: ${termWidth}x${termHeight}`)
  
  renderer.start()
  renderer.setBackgroundColor("#000000")
  
  const frameBuffer = renderer.createFrameBuffer('test', {
    x: 0,
    y: 0,
    width: termWidth,
    height: termHeight,
    zIndex: 1,
    visible: true,
  })
  
  const buffer = frameBuffer.buffer
  buffer.clear(RGBA.fromHex('#000000'))
  
  // Test 1: Small region (10x10 chars = 20x20 pixels)
  console.log('\nTest 1: Small region at (0,0)')
  const smallWidth = 20  // 10 chars * 2
  const smallHeight = 20 // 10 chars * 2
  const smallData = new Uint8Array(smallWidth * smallHeight * 4)
  
  // Create checkerboard pattern
  for (let y = 0; y < smallHeight; y++) {
    for (let x = 0; x < smallWidth; x++) {
      const idx = (y * smallWidth + x) * 4
      const isEven = ((x / 2) | 0) % 2 === ((y / 2) | 0) % 2
      
      if (isEven) {
        smallData[idx] = 255;     // R
        smallData[idx+1] = 0;     // G
        smallData[idx+2] = 0;     // B
      } else {
        smallData[idx] = 0;       // R
        smallData[idx+1] = 0;     // G
        smallData[idx+2] = 255;   // B
      }
      smallData[idx+3] = 255;     // A
    }
  }
  
  const smallBuffer = new ArrayBuffer(smallData.length)
  new Uint8Array(smallBuffer).set(smallData)
  const smallPtr = ptr(smallBuffer)
  
  console.log(`Small buffer: ${smallWidth}x${smallHeight} pixels, ${smallData.length} bytes`)
  
  try {
    buffer.drawSuperSampleBuffer(
      0, 0,
      smallPtr,
      smallData.length,
      "rgba8unorm",
      smallWidth * 4
    )
    console.log('Small region drawn successfully')
  } catch (e) {
    console.error('Small region failed:', e)
  }
  
  // Test 2: Full screen
  console.log('\nTest 2: Full screen')
  const fullWidth = termWidth * 2
  const fullHeight = termHeight * 2
  const fullData = new Uint8Array(fullWidth * fullHeight * 4)
  
  // Create gradient
  for (let y = 0; y < fullHeight; y++) {
    for (let x = 0; x < fullWidth; x++) {
      const idx = (y * fullWidth + x) * 4
      fullData[idx] = (x * 255 / fullWidth) | 0;     // R gradient
      fullData[idx+1] = (y * 255 / fullHeight) | 0; // G gradient
      fullData[idx+2] = 128;                         // B constant
      fullData[idx+3] = 255;                         // A
    }
  }
  
  const fullBuffer = new ArrayBuffer(fullData.length)
  new Uint8Array(fullBuffer).set(fullData)
  const fullPtr = ptr(fullBuffer)
  
  console.log(`Full buffer: ${fullWidth}x${fullHeight} pixels, ${fullData.length} bytes`)
  
  try {
    buffer.drawSuperSampleBuffer(
      0, 5,  // Start at row 5
      fullPtr,
      fullData.length,
      "rgba8unorm",
      fullWidth * 4
    )
    console.log('Full screen drawn successfully')
  } catch (e) {
    console.error('Full screen failed:', e)
  }
  
  // Add text overlay to verify something is rendering
  buffer.drawText('Test 1: Checkerboard (10x10 chars)', 0, 2, RGBA.fromHex('#FFFF00'))
  buffer.drawText('Test 2: Full gradient (starts row 5)', 0, 4, RGBA.fromHex('#FFFF00'))
  
  frameBuffer.needsUpdate = true
  
  console.log('\nTests complete!')
  console.log('You should see:')
  console.log('- Rows 0-1: Red/Blue checkerboard pattern')
  console.log('- Row 2: Yellow text "Test 1"')
  console.log('- Row 4: Yellow text "Test 2"')
  console.log('- Rows 5+: RGB gradient')
  console.log('\nPress Ctrl+C to exit')
}

main().catch(console.error)