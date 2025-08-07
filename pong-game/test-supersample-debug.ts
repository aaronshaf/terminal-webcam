#!/usr/bin/env bun
import {
  createCliRenderer,
  RGBA,
} from "@opentui/core"
import { ptr, toArrayBuffer } from 'bun:ffi';

async function main() {
  console.log('Debug test for super sample buffer...')
  
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const width = renderer.terminalWidth
  const height = renderer.terminalHeight
  
  // Create a simple 2x2 test pattern for a single cell
  // This should be the minimum to see if super sampling works
  const testWidth = 2  // 2 pixels wide
  const testHeight = 2 // 2 pixels tall
  
  // Test 1: Create a simple red/blue pattern
  console.log('\nTest 1: Simple red/blue pattern (2x2 pixels)')
  const pixelData1 = new Uint8Array(testWidth * testHeight * 4)
  
  // Top-left: Red
  pixelData1[0] = 255; pixelData1[1] = 0; pixelData1[2] = 0; pixelData1[3] = 255;
  // Top-right: Blue
  pixelData1[4] = 0; pixelData1[5] = 0; pixelData1[6] = 255; pixelData1[7] = 255;
  // Bottom-left: Blue  
  pixelData1[8] = 0; pixelData1[9] = 0; pixelData1[10] = 255; pixelData1[11] = 255;
  // Bottom-right: Red
  pixelData1[12] = 255; pixelData1[13] = 0; pixelData1[14] = 0; pixelData1[15] = 255;
  
  renderer.start()
  renderer.setBackgroundColor("#000000")
  
  const frameBuffer = renderer.createFrameBuffer('test', {
    x: 0,
    y: 0,
    width,
    height,
    zIndex: 1,
    visible: true,
  })
  
  const buffer = frameBuffer.buffer
  buffer.clear(RGBA.fromHex('#111111')) // Dark gray background
  
  // First, let's test if regular drawing works
  buffer.drawText('Testing supersample:', 0, 0, RGBA.fromHex('#FFFFFF'))
  
  // Now try super sampling
  const arrayBuffer1 = toArrayBuffer(pixelData1)
  const bufferPtr1 = ptr(arrayBuffer1)
  const bytesPerRow1 = testWidth * 4
  
  console.log(`Drawing at position (0, 2) with ${testWidth}x${testHeight} pixels`)
  console.log(`Bytes per row: ${bytesPerRow1}`)
  console.log(`Total bytes: ${pixelData1.length}`)
  console.log(`Buffer pointer: ${bufferPtr1}`)
  
  try {
    buffer.drawSuperSampleBuffer(
      0, 2,  // Draw at row 2
      bufferPtr1,
      pixelData1.length,
      "rgba8unorm",
      bytesPerRow1
    )
    console.log('drawSuperSampleBuffer call succeeded')
  } catch (e) {
    console.error('drawSuperSampleBuffer failed:', e)
  }
  
  // Test 2: Full gradient pattern
  console.log('\nTest 2: Full gradient pattern')
  const fullWidth = width * 2
  const fullHeight = height * 2
  const pixelData2 = new Uint8Array(fullWidth * fullHeight * 4)
  
  // Fill with gradient
  for (let y = 0; y < fullHeight; y++) {
    for (let x = 0; x < fullWidth; x++) {
      const idx = (y * fullWidth + x) * 4
      pixelData2[idx] = Math.floor((x / fullWidth) * 255)     // R
      pixelData2[idx + 1] = Math.floor((y / fullHeight) * 255) // G  
      pixelData2[idx + 2] = 255                                 // B
      pixelData2[idx + 3] = 255                                 // A
    }
  }
  
  const arrayBuffer2 = toArrayBuffer(pixelData2)
  const bufferPtr2 = ptr(arrayBuffer2)
  const bytesPerRow2 = fullWidth * 4
  
  try {
    buffer.drawSuperSampleBuffer(
      0, 4,  // Draw at row 4
      bufferPtr2,
      pixelData2.length,
      "rgba8unorm",
      bytesPerRow2
    )
    console.log('Full gradient drawn')
  } catch (e) {
    console.error('Full gradient failed:', e)
  }
  
  // Test 3: Try with manual cell setting as comparison
  console.log('\nTest 3: Manual cell setting for comparison')
  buffer.setCell(0, 10, '█', RGBA.fromHex('#FF0000'), RGBA.fromHex('#0000FF'))
  buffer.setCell(1, 10, '▀', RGBA.fromHex('#00FF00'), RGBA.fromHex('#FF00FF'))
  buffer.setCell(2, 10, '▄', RGBA.fromHex('#FFFF00'), RGBA.fromHex('#00FFFF'))
  
  frameBuffer.needsUpdate = true
  
  console.log('\nTests complete!')
  console.log('You should see:')
  console.log('- Row 0: "Testing supersample:" text')
  console.log('- Row 2: A single character from the 2x2 red/blue pattern')
  console.log('- Row 4+: A gradient pattern (if working)')
  console.log('- Row 10: Three colored blocks (manual test)')
  console.log('\nPress Ctrl+C to exit')
}

main().catch(console.error)