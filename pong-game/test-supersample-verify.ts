#!/usr/bin/env bun
import { createCliRenderer, RGBA } from "@opentui/core"
import { ptr, toArrayBuffer } from 'bun:ffi';

async function main() {
  console.log('=== Super Sample Verification Test ===')
  
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const termWidth = renderer.terminalWidth
  const termHeight = renderer.terminalHeight
  
  console.log(`Terminal dimensions: ${termWidth}x${termHeight}`)
  
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
  
  // Step 1: Verify basic rendering works
  console.log('\nStep 1: Testing basic rendering...')
  buffer.clear(RGBA.fromHex('#111111'))
  buffer.drawText('Basic text rendering works!', 0, 0, RGBA.fromHex('#00FF00'))
  buffer.setCell(0, 1, '█', RGBA.fromHex('#FF0000'), RGBA.fromHex('#0000FF'))
  buffer.setCell(1, 1, '▀', RGBA.fromHex('#FFFF00'), RGBA.fromHex('#FF00FF'))
  buffer.setCell(2, 1, '▄', RGBA.fromHex('#00FFFF'), RGBA.fromHex('#FFFFFF'))
  frameBuffer.needsUpdate = true
  
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Step 2: Create minimal super sample data
  console.log('\nStep 2: Creating minimal super sample buffer...')
  const pixelWidth = termWidth * 2
  const pixelHeight = termHeight * 2
  const bytesPerPixel = 4
  const bytesPerRow = pixelWidth * bytesPerPixel
  const totalBytes = pixelWidth * pixelHeight * bytesPerPixel
  
  console.log(`Pixel dimensions: ${pixelWidth}x${pixelHeight}`)
  console.log(`Bytes per row: ${bytesPerRow}`)
  console.log(`Total bytes: ${totalBytes}`)
  
  // Create buffer with distinct pattern
  const pixelData = new Uint8Array(totalBytes)
  
  // Fill entire buffer with bright cyan to ensure it's visible
  for (let i = 0; i < totalBytes; i += 4) {
    pixelData[i] = 0        // R
    pixelData[i + 1] = 255  // G
    pixelData[i + 2] = 255  // B
    pixelData[i + 3] = 255  // A
  }
  
  // Create some red squares for visibility
  for (let squareY = 0; squareY < 20; squareY++) {
    for (let squareX = 0; squareX < 20; squareX++) {
      const pixelX = squareX + 10
      const pixelY = squareY + 10
      if (pixelX < pixelWidth && pixelY < pixelHeight) {
        const idx = (pixelY * pixelWidth + pixelX) * 4
        pixelData[idx] = 255      // R
        pixelData[idx + 1] = 0    // G
        pixelData[idx + 2] = 0    // B
        pixelData[idx + 3] = 255  // A
      }
    }
  }
  
  // Step 3: Test different buffer creation methods
  console.log('\nStep 3: Testing buffer pointer creation...')
  
  // Method A: Direct from Uint8Array.buffer
  const ptrA = ptr(pixelData.buffer)
  console.log(`Method A (Uint8Array.buffer): ${ptrA}`)
  
  // Method B: Create new ArrayBuffer
  const newBuffer = new ArrayBuffer(totalBytes)
  new Uint8Array(newBuffer).set(pixelData)
  const ptrB = ptr(newBuffer)
  console.log(`Method B (new ArrayBuffer): ${ptrB}`)
  
  // Method C: toArrayBuffer
  const arrayBuf = toArrayBuffer(pixelData)
  const ptrC = ptr(arrayBuf)
  console.log(`Method C (toArrayBuffer): ${ptrC}`)
  
  // Step 4: Try drawing with super sample
  console.log('\nStep 4: Attempting drawSuperSampleBuffer...')
  
  try {
    buffer.clear(RGBA.fromHex('#000000'))
    
    // Use method B which creates a fresh ArrayBuffer
    buffer.drawSuperSampleBuffer(
      0, 3,  // Start at row 3 to not overwrite our test text
      ptrB,
      totalBytes,
      "rgba8unorm",
      bytesPerRow
    )
    
    console.log('✓ drawSuperSampleBuffer call succeeded')
    
    // Add labels
    buffer.drawText('Super sample test:', 0, 2, RGBA.fromHex('#FFFF00'))
    
    frameBuffer.needsUpdate = true
  } catch (e) {
    console.error('✗ drawSuperSampleBuffer failed:', e)
    console.error('Stack:', e.stack)
  }
  
  console.log('\n=== Test Complete ===')
  console.log('Expected output:')
  console.log('- Row 0: Green text "Basic text rendering works!"')
  console.log('- Row 1: Colored blocks')
  console.log('- Row 2: Yellow text "Super sample test:"')
  console.log('- Row 3+: Cyan background with red square (if super sampling works)')
  console.log('\nPress Ctrl+C to exit')
}

main().catch(console.error)