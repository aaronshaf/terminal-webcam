#!/usr/bin/env bun
import {
  createCliRenderer,
  RGBA,
} from "@opentui/core"
import { ptr, toArrayBuffer } from 'bun:ffi';

async function main() {
  console.log('Testing super sample buffer...')
  
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const width = renderer.terminalWidth
  const height = renderer.terminalHeight
  
  // Create test pattern at 2x resolution
  const pixelWidth = width * 2
  const pixelHeight = height * 2
  const pixelData = new Uint8Array(pixelWidth * pixelHeight * 4)
  
  // Fill with gradient test pattern
  for (let y = 0; y < pixelHeight; y++) {
    for (let x = 0; x < pixelWidth; x++) {
      const idx = (y * pixelWidth + x) * 4
      
      // Create colorful gradient
      pixelData[idx] = Math.floor((x / pixelWidth) * 255)     // R
      pixelData[idx + 1] = Math.floor((y / pixelHeight) * 255) // G
      pixelData[idx + 2] = 128                                  // B
      pixelData[idx + 3] = 255                                  // A
    }
  }
  
  console.log(`Created test pattern: ${pixelWidth}x${pixelHeight}`)
  
  renderer.start()
  renderer.setBackgroundColor("#000000")
  
  // Create frame buffer
  const frameBuffer = renderer.createFrameBuffer('test', {
    x: 0,
    y: 0,
    width,
    height,
    zIndex: 1,
    visible: true,
  })
  
  // Try to draw with super sampling
  const buffer = frameBuffer.buffer
  buffer.clear(RGBA.fromHex('#000000'))
  
  const arrayBuffer = toArrayBuffer(pixelData)
  const bufferPtr = ptr(arrayBuffer)
  const bytesPerRow = pixelWidth * 4
  
  console.log('Drawing super sample buffer...')
  buffer.drawSuperSampleBuffer(
    0, 0,
    bufferPtr,
    pixelData.length,
    "rgba8unorm",
    bytesPerRow
  )
  
  frameBuffer.needsUpdate = true
  
  console.log('Done! You should see a gradient pattern.')
  console.log('Press Ctrl+C to exit')
}

main().catch(console.error)