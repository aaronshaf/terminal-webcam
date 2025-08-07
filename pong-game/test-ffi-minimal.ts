#!/usr/bin/env bun
import { createCliRenderer, RGBA } from "@opentui/core"
import { ptr } from 'bun:ffi';

async function main() {
  console.log('Minimal FFI test for drawSuperSampleBuffer...')
  
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  renderer.start()
  renderer.setBackgroundColor("#000000")
  
  const frameBuffer = renderer.createFrameBuffer('test', {
    x: 0,
    y: 0,
    width: renderer.terminalWidth,
    height: renderer.terminalHeight,
    zIndex: 1,
    visible: true,
  })
  
  const buffer = frameBuffer.buffer
  buffer.clear(RGBA.fromHex('#000000'))
  
  // Create a minimal 4x4 test pattern (for 2x2 character cells)
  const width = 4
  const height = 4
  const data = new Uint8Array(width * height * 4)
  
  // Fill with bright colors
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 255;     // R
    data[i+1] = 0;     // G
    data[i+2] = 0;     // B
    data[i+3] = 255;   // A
  }
  
  // Method 1: Direct ArrayBuffer
  console.log('\n=== Method 1: Direct ArrayBuffer ===')
  try {
    const arrayBuffer = data.buffer
    const bufferPtr = ptr(arrayBuffer)
    console.log(`Pointer: ${bufferPtr}, Size: ${data.length}, BytesPerRow: ${width * 4}`)
    
    buffer.drawSuperSampleBuffer(
      0, 0,
      bufferPtr,
      data.length,
      "rgba8unorm",
      width * 4
    )
    console.log('✓ Method 1 succeeded')
  } catch (e) {
    console.error('✗ Method 1 failed:', e)
  }
  
  // Method 2: Create new ArrayBuffer
  console.log('\n=== Method 2: New ArrayBuffer ===')
  try {
    const newBuffer = new ArrayBuffer(data.length)
    const view = new Uint8Array(newBuffer)
    view.set(data)
    const bufferPtr = ptr(newBuffer)
    console.log(`Pointer: ${bufferPtr}, Size: ${data.length}, BytesPerRow: ${width * 4}`)
    
    buffer.drawSuperSampleBuffer(
      2, 0,
      bufferPtr,
      data.length,
      "rgba8unorm",
      width * 4
    )
    console.log('✓ Method 2 succeeded')
  } catch (e) {
    console.error('✗ Method 2 failed:', e)
  }
  
  // Method 3: SharedArrayBuffer (if available)
  console.log('\n=== Method 3: SharedArrayBuffer ===')
  try {
    const sharedBuffer = new SharedArrayBuffer(data.length)
    const view = new Uint8Array(sharedBuffer)
    view.set(data)
    const bufferPtr = ptr(sharedBuffer)
    console.log(`Pointer: ${bufferPtr}, Size: ${data.length}, BytesPerRow: ${width * 4}`)
    
    buffer.drawSuperSampleBuffer(
      4, 0,
      bufferPtr,
      data.length,
      "rgba8unorm",
      width * 4
    )
    console.log('✓ Method 3 succeeded')
  } catch (e) {
    console.error('✗ Method 3 failed:', e)
  }
  
  // Also test manual drawing for comparison
  console.log('\n=== Manual drawing for comparison ===')
  buffer.setCell(0, 5, '█', RGBA.fromHex('#FF0000'), RGBA.fromHex('#000000'))
  buffer.drawText('If you see this, basic rendering works', 0, 6, RGBA.fromHex('#FFFFFF'))
  
  frameBuffer.needsUpdate = true
  
  console.log('\n=== Results ===')
  console.log('Check the terminal output:')
  console.log('- Rows 0-1: Method 1 result (2x2 chars)')
  console.log('- Rows 2-3: Method 2 result (2x2 chars)')
  console.log('- Rows 4-5: Method 3 result (2x2 chars)')
  console.log('- Row 5: Red block (manual)')
  console.log('- Row 6: White text (manual)')
  console.log('\nPress Ctrl+C to exit')
}

main().catch(console.error)