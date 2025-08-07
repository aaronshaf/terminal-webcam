#!/usr/bin/env bun
import { ptr, toArrayBuffer, toBuffer, FFIType } from 'bun:ffi';
import { createCliRenderer, RGBA } from "@opentui/core"

async function main() {
  console.log('=== Debugging FFI Pointer Issues ===')
  
  // Test 1: Verify pointer creation works
  console.log('\nTest 1: Pointer creation methods')
  
  const testData = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255])
  console.log('Test data:', testData)
  
  // Method 1: Direct from typed array buffer
  const ptr1 = ptr(testData.buffer)
  console.log(`ptr(testData.buffer): ${ptr1}`)
  
  // Method 2: From ArrayBuffer
  const arrayBuffer = new ArrayBuffer(8)
  new Uint8Array(arrayBuffer).set(testData)
  const ptr2 = ptr(arrayBuffer)
  console.log(`ptr(new ArrayBuffer): ${ptr2}`)
  
  // Method 3: Using toArrayBuffer
  const arrayBuffer2 = toArrayBuffer(testData)
  const ptr3 = ptr(arrayBuffer2)
  console.log(`ptr(toArrayBuffer): ${ptr3}`)
  
  // Method 4: Direct from Uint8Array
  const ptr4 = ptr(testData)
  console.log(`ptr(Uint8Array): ${ptr4}`)
  
  // Test 2: Verify we can read back the data
  console.log('\nTest 2: Reading back data from pointers')
  
  const readBack1 = toBuffer(ptr1, 0, 8)
  console.log('Read from ptr1:', new Uint8Array(readBack1))
  
  const readBack2 = toBuffer(ptr2, 0, 8)
  console.log('Read from ptr2:', new Uint8Array(readBack2))
  
  // Test 3: Create a larger buffer like we would for super sampling
  console.log('\nTest 3: Large buffer for super sampling')
  
  const width = 100
  const height = 50
  const pixelWidth = width * 2
  const pixelHeight = height * 2
  const totalBytes = pixelWidth * pixelHeight * 4
  
  console.log(`Creating ${pixelWidth}x${pixelHeight} buffer (${totalBytes} bytes)`)
  
  // Create buffer with pattern
  const bigBuffer = new ArrayBuffer(totalBytes)
  const bigData = new Uint8Array(bigBuffer)
  
  // Fill with recognizable pattern
  for (let i = 0; i < totalBytes; i += 4) {
    bigData[i] = 255      // R
    bigData[i + 1] = 0    // G
    bigData[i + 2] = 0    // B
    bigData[i + 3] = 255  // A
  }
  
  const bigPtr = ptr(bigBuffer)
  console.log(`Big buffer pointer: ${bigPtr}`)
  
  // Verify first few bytes
  const checkBytes = toBuffer(bigPtr, 0, 16)
  console.log('First 16 bytes:', new Uint8Array(checkBytes))
  
  // Test 4: Try with OpenTUI
  console.log('\nTest 4: Testing with OpenTUI')
  
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
    width: 100,
    height: 20,
    zIndex: 1,
    visible: true,
  })
  
  const buffer = frameBuffer.buffer
  buffer.clear(RGBA.fromHex('#000000'))
  
  // First draw some text to verify rendering works
  buffer.drawText('Testing pointer:', 0, 0, RGBA.fromHex('#FFFFFF'))
  
  // Now try super sampling with our verified pointer
  console.log('\nAttempting drawSuperSampleBuffer with verified pointer...')
  console.log(`Parameters:`)
  console.log(`  x: 0, y: 2`)
  console.log(`  pointer: ${bigPtr}`)
  console.log(`  length: ${totalBytes}`)
  console.log(`  format: rgba8unorm`)
  console.log(`  bytesPerRow: ${pixelWidth * 4}`)
  
  try {
    buffer.drawSuperSampleBuffer(
      0, 2,
      bigPtr,
      totalBytes,
      "rgba8unorm",
      pixelWidth * 4
    )
    console.log('✓ Call succeeded')
  } catch (e) {
    console.error('✗ Call failed:', e)
    console.error('Stack:', e.stack)
  }
  
  frameBuffer.needsUpdate = true
  
  // Test 5: Try calling the FFI directly
  console.log('\nTest 5: Direct FFI access')
  
  // Get the buffer's internal pointer
  const bufferPtr = (buffer as any).bufferPtr || (buffer as any).ptr
  console.log(`Buffer internal pointer: ${bufferPtr}`)
  
  // Get the lib
  const lib = (buffer as any).lib
  if (lib && lib.bufferDrawSuperSampleBuffer) {
    console.log('Found lib.bufferDrawSuperSampleBuffer')
    
    try {
      lib.bufferDrawSuperSampleBuffer(
        bufferPtr,
        0, 4,
        bigPtr,
        totalBytes,
        "rgba8unorm",
        pixelWidth * 4
      )
      console.log('✓ Direct FFI call succeeded')
    } catch (e) {
      console.error('✗ Direct FFI call failed:', e)
    }
  }
  
  frameBuffer.needsUpdate = true
  
  console.log('\n=== Debug Complete ===')
  console.log('Check terminal for any red pixels')
  console.log('Press Ctrl+C to exit')
}

main().catch(console.error)