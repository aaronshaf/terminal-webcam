#!/usr/bin/env bun
import { createCliRenderer, RGBA } from "@opentui/core"

// Implement the quadrant rendering logic manually
function renderQuadrant(pixels: Array<{r: number, g: number, b: number}>): {
  char: string,
  fg: RGBA,
  bg: RGBA
} {
  // Calculate luminance for each pixel
  const luminances = pixels.map(p => 0.299 * p.r + 0.587 * p.g + 0.114 * p.b)
  
  // Find darkest and lightest
  const avgLum = luminances.reduce((a, b) => a + b) / 4
  
  // Determine which quadrants are "dark" (below average)
  const isDark = luminances.map(l => l < avgLum)
  
  // Build quadrant bits (TL=8, TR=4, BL=2, BR=1)
  const bits = (isDark[0] ? 8 : 0) + (isDark[1] ? 4 : 0) + 
               (isDark[2] ? 2 : 0) + (isDark[3] ? 1 : 0)
  
  // Quadrant characters
  const quadrantChars = [
    ' ',      // 0000 - all light
    '\u2597', // 0001 - BR
    '\u2596', // 0010 - BL
    '\u2584', // 0011 - Lower half
    '\u259d', // 0100 - TR
    '\u2590', // 0101 - Right half
    '\u259e', // 0110 - TR+BL
    '\u259f', // 0111 - TR+BL+BR
    '\u2598', // 1000 - TL
    '\u259a', // 1001 - TL+BR
    '\u258c', // 1010 - Left half
    '\u2599', // 1011 - TL+BL+BR
    '\u2580', // 1100 - Upper half
    '\u259c', // 1101 - TL+TR+BR
    '\u259b', // 1110 - TL+TR+BL
    '\u2588'  // 1111 - Full block
  ]
  
  const char = quadrantChars[bits]
  
  // Calculate average colors for dark and light pixels
  let darkColor = {r: 0, g: 0, b: 0, count: 0}
  let lightColor = {r: 0, g: 0, b: 0, count: 0}
  
  pixels.forEach((p, i) => {
    if (isDark[i]) {
      darkColor.r += p.r
      darkColor.g += p.g
      darkColor.b += p.b
      darkColor.count++
    } else {
      lightColor.r += p.r
      lightColor.g += p.g
      lightColor.b += p.b
      lightColor.count++
    }
  })
  
  // Average the colors
  if (darkColor.count > 0) {
    darkColor.r /= darkColor.count
    darkColor.g /= darkColor.count
    darkColor.b /= darkColor.count
  }
  if (lightColor.count > 0) {
    lightColor.r /= lightColor.count
    lightColor.g /= lightColor.count
    lightColor.b /= lightColor.count
  }
  
  return {
    char,
    fg: RGBA.fromRGB(darkColor.r, darkColor.g, darkColor.b),
    bg: RGBA.fromRGB(lightColor.r, lightColor.g, lightColor.b)
  }
}

async function main() {
  console.log('=== Manual Quadrant Rendering Test ===')
  console.log('This mimics what drawSuperSampleBuffer should do')
  
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const width = renderer.terminalWidth
  const height = renderer.terminalHeight
  
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
  buffer.clear(RGBA.fromHex('#000000'))
  
  // Create a 2x resolution "image"
  const pixelWidth = width * 2
  const pixelHeight = height * 2
  const pixels = new Array(pixelHeight)
  
  // Generate a test pattern
  for (let y = 0; y < pixelHeight; y++) {
    pixels[y] = new Array(pixelWidth)
    for (let x = 0; x < pixelWidth; x++) {
      // Create a gradient with some patterns
      const r = Math.floor((x / pixelWidth) * 255)
      const g = Math.floor((y / pixelHeight) * 255)
      const b = ((x + y) % 20 < 10) ? 255 : 0  // Diagonal stripes
      
      pixels[y][x] = {r, g, b}
    }
  }
  
  console.log(`Rendering ${width}x${height} characters from ${pixelWidth}x${pixelHeight} pixels`)
  
  // Process each character cell
  for (let cy = 0; cy < height && cy < 20; cy++) { // Limit to first 20 rows for performance
    for (let cx = 0; cx < width; cx++) {
      // Get the 2x2 pixel block for this character
      const px = cx * 2
      const py = cy * 2
      
      if (px + 1 < pixelWidth && py + 1 < pixelHeight) {
        const quadPixels = [
          pixels[py][px],        // TL
          pixels[py][px + 1],    // TR
          pixels[py + 1][px],    // BL
          pixels[py + 1][px + 1] // BR
        ]
        
        const result = renderQuadrant(quadPixels)
        buffer.setCell(cx, cy, result.char, result.fg, result.bg)
      }
    }
  }
  
  // Add labels
  buffer.drawText('Manual quadrant rendering (mimics drawSuperSampleBuffer):', 0, 21, RGBA.fromHex('#FFFF00'))
  buffer.drawText('You should see a gradient with diagonal stripes', 0, 22, RGBA.fromHex('#FFFF00'))
  
  frameBuffer.needsUpdate = true
  
  console.log('\nRendering complete!')
  console.log('This is what drawSuperSampleBuffer SHOULD produce')
  console.log('Press Ctrl+C to exit')
}

main().catch(console.error)