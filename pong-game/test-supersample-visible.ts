#!/usr/bin/env bun
import { createCliRenderer, RGBA } from "@opentui/core"
import { ptr } from 'bun:ffi';

async function main() {
  console.log('Creating highly visible test pattern for super sampling...')
  
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const termWidth = renderer.terminalWidth
  const termHeight = renderer.terminalHeight
  
  console.log(`Terminal: ${termWidth}x${termHeight}`)
  console.log('Creating full-sized buffer with alternating red/blue pattern...')
  
  renderer.start()
  renderer.setBackgroundColor("#FFFFFF") // White background to see any rendering
  
  const frameBuffer = renderer.createFrameBuffer('test', {
    x: 0,
    y: 0,
    width: termWidth,
    height: termHeight,
    zIndex: 1,
    visible: true,
  })
  
  const buffer = frameBuffer.buffer
  buffer.clear(RGBA.fromHex('#FFFFFF')) // White background
  
  // Create EXACTLY the right sized buffer
  const pixelWidth = termWidth * 2
  const pixelHeight = termHeight * 2
  const totalBytes = pixelWidth * pixelHeight * 4
  
  console.log(`Creating ${pixelWidth}x${pixelHeight} pixel buffer (${totalBytes} bytes)`)
  
  // Use ArrayBuffer for better FFI compatibility
  const pixelBuffer = new ArrayBuffer(totalBytes)
  const pixelData = new Uint8Array(pixelBuffer)
  
  // Create a very visible pattern - alternating red and blue stripes
  for (let y = 0; y < pixelHeight; y++) {
    for (let x = 0; x < pixelWidth; x++) {
      const idx = (y * pixelWidth + x) * 4
      
      // Create vertical stripes every 4 pixels
      const stripe = Math.floor(x / 4) % 2
      
      if (stripe === 0) {
        // Bright red
        pixelData[idx] = 255      // R
        pixelData[idx + 1] = 0    // G
        pixelData[idx + 2] = 0    // B
      } else {
        // Bright blue
        pixelData[idx] = 0        // R
        pixelData[idx + 1] = 0    // G
        pixelData[idx + 2] = 255  // B
      }
      pixelData[idx + 3] = 255    // A - fully opaque
    }
  }
  
  // Get pointer to buffer
  const bufferPtr = ptr(pixelBuffer)
  const bytesPerRow = pixelWidth * 4
  
  console.log(`Buffer pointer: ${bufferPtr}`)
  console.log(`Bytes per row: ${bytesPerRow}`)
  console.log('\nCalling drawSuperSampleBuffer...')
  
  try {
    buffer.drawSuperSampleBuffer(
      0, 0,              // Start at top-left
      bufferPtr,         // Pointer to pixel data
      totalBytes,        // Total size
      "rgba8unorm",     // Format
      bytesPerRow       // Bytes per row
    )
    console.log('\u2713 drawSuperSampleBuffer succeeded!')
  } catch (e) {
    console.error('\u2717 drawSuperSampleBuffer failed:', e)
  }
  
  // Also draw some reference text to confirm rendering works
  buffer.drawText(
    'If you see red/blue stripes above, super sampling works!',
    0, termHeight - 2,
    RGBA.fromHex('#000000'),
    RGBA.fromHex('#FFFF00')
  )
  
  frameBuffer.needsUpdate = true
  
  console.log('\n=== Expected Result ===')
  console.log('You should see:')
  console.log('- Vertical red and blue stripes across the entire terminal')
  console.log('- Black text on yellow background at the bottom')
  console.log('\nIf you only see white background + yellow text, super sampling is not working.')
  console.log('\nPress Ctrl+C to exit')
}

main().catch(console.error)