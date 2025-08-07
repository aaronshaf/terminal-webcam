#!/usr/bin/env bun
import { dlopen, suffix, ptr, toBuffer } from "bun:ffi"
import { join } from "path"
import { createCliRenderer, RGBA } from "@opentui/core"

async function main() {
  console.log('=== Direct FFI Test for drawSuperSampleBuffer ===')
  
  // Find the OpenTUI library
  const libPath = join(
    process.cwd(),
    "../opentui/src/zig/lib",
    `${process.arch === 'x64' ? 'x86_64' : 'aarch64'}-${process.platform === 'darwin' ? 'macos' : process.platform}`,
    `libopentui.${suffix}`
  )
  
  console.log(`Loading library from: ${libPath}`)
  
  // Load the library directly
  const lib = dlopen(libPath, {
    createOptimizedBuffer: {
      args: ["u32", "u32", "bool"],
      returns: "ptr",
    },
    bufferDrawSuperSampleBuffer: {
      args: ["ptr", "u32", "u32", "ptr", "usize", "u8", "u32"],
      returns: "void",
    },
    getBufferWidth: {
      args: ["ptr"],
      returns: "u32",
    },
    getBufferHeight: {
      args: ["ptr"],
      returns: "u32",
    },
    bufferClear: {
      args: ["ptr", "ptr"],
      returns: "void",
    },
    destroyOptimizedBuffer: {
      args: ["ptr"],
      returns: "void",
    },
  })
  
  console.log('Library loaded successfully')
  
  // Create a buffer directly via FFI
  const width = 80
  const height = 24
  const bufferPtr = lib.symbols.createOptimizedBuffer(width, height, false)
  
  if (!bufferPtr) {
    console.error('Failed to create buffer')
    return
  }
  
  console.log(`Created buffer: ${bufferPtr}`)
  console.log(`Buffer dimensions: ${lib.symbols.getBufferWidth(bufferPtr)}x${lib.symbols.getBufferHeight(bufferPtr)}`)
  
  // Clear the buffer with a color
  const clearColor = new Float32Array([0.1, 0.1, 0.1, 1.0]) // Dark gray
  lib.symbols.bufferClear(bufferPtr, ptr(clearColor.buffer))
  console.log('Buffer cleared')
  
  // Create pixel data for super sampling
  const pixelWidth = width * 2
  const pixelHeight = height * 2
  const totalBytes = pixelWidth * pixelHeight * 4
  
  console.log(`\nCreating pixel data: ${pixelWidth}x${pixelHeight} (${totalBytes} bytes)`)
  
  // Create a simple test pattern
  const pixelData = new Uint8Array(totalBytes)
  
  // Fill with bright red
  for (let i = 0; i < totalBytes; i += 4) {
    pixelData[i] = 255      // R
    pixelData[i + 1] = 0    // G
    pixelData[i + 2] = 0    // B
    pixelData[i + 3] = 255  // A
  }
  
  // Create a blue square in the middle
  const squareSize = 40
  const startX = pixelWidth / 2 - squareSize / 2
  const startY = pixelHeight / 2 - squareSize / 2
  
  for (let y = 0; y < squareSize; y++) {
    for (let x = 0; x < squareSize; x++) {
      const px = Math.floor(startX + x)
      const py = Math.floor(startY + y)
      if (px >= 0 && px < pixelWidth && py >= 0 && py < pixelHeight) {
        const idx = (py * pixelWidth + px) * 4
        pixelData[idx] = 0        // R
        pixelData[idx + 1] = 0    // G
        pixelData[idx + 2] = 255  // B
        pixelData[idx + 3] = 255  // A
      }
    }
  }
  
  // Get pointer to pixel data
  const pixelPtr = ptr(pixelData.buffer)
  console.log(`Pixel data pointer: ${pixelPtr}`)
  
  // Verify the pointer is valid by reading back
  const readBack = toBuffer(pixelPtr, 0, 16)
  console.log('First 16 bytes of pixel data:', new Uint8Array(readBack))
  
  // Call drawSuperSampleBuffer directly
  console.log('\nCalling bufferDrawSuperSampleBuffer directly via FFI...')
  console.log('Parameters:')
  console.log(`  buffer: ${bufferPtr}`)
  console.log(`  x: 0, y: 0`)
  console.log(`  pixelPtr: ${pixelPtr}`)
  console.log(`  length: ${totalBytes}`)
  console.log(`  format: 1 (rgba8unorm)`)
  console.log(`  bytesPerRow: ${pixelWidth * 4}`)
  
  try {
    lib.symbols.bufferDrawSuperSampleBuffer(
      bufferPtr,
      0, 0,
      pixelPtr,
      totalBytes,
      1, // rgba8unorm
      pixelWidth * 4
    )
    console.log('✓ Direct FFI call succeeded!')
  } catch (e) {
    console.error('✗ Direct FFI call failed:', e)
    console.error('Stack:', e.stack)
  }
  
  // Now test with OpenTUI renderer
  console.log('\n=== Testing with OpenTUI renderer ===')
  
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
  
  // Try the same pattern
  const termPixelWidth = renderer.terminalWidth * 2
  const termPixelHeight = renderer.terminalHeight * 2
  const termTotalBytes = termPixelWidth * termPixelHeight * 4
  
  const termPixelData = new Uint8Array(termTotalBytes)
  
  // Fill with green this time
  for (let i = 0; i < termTotalBytes; i += 4) {
    termPixelData[i] = 0        // R
    termPixelData[i + 1] = 255  // G
    termPixelData[i + 2] = 0    // B
    termPixelData[i + 3] = 255  // A
  }
  
  const termPixelPtr = ptr(termPixelData.buffer)
  
  console.log(`\nOpenTUI buffer test:`)
  console.log(`  Dimensions: ${termPixelWidth}x${termPixelHeight}`)
  console.log(`  Total bytes: ${termTotalBytes}`)
  console.log(`  Pointer: ${termPixelPtr}`)
  
  try {
    buffer.drawSuperSampleBuffer(
      0, 0,
      termPixelPtr,
      termTotalBytes,
      "rgba8unorm",
      termPixelWidth * 4
    )
    console.log('✓ OpenTUI call succeeded!')
  } catch (e) {
    console.error('✗ OpenTUI call failed:', e)
  }
  
  // Add some text to verify rendering
  buffer.drawText('If you see green above, super sampling works!', 0, 10, RGBA.fromHex('#FFFF00'))
  
  frameBuffer.needsUpdate = true
  
  // Clean up the directly created buffer
  lib.symbols.destroyOptimizedBuffer(bufferPtr)
  
  console.log('\n=== Test Complete ===')
  console.log('Press Ctrl+C to exit')
}

main().catch(console.error)