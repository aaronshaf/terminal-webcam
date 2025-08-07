#!/usr/bin/env bun
import { spawn, execSync } from 'child_process';

// Get list of cameras
function getCameras() {
  try {
    const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', { 
      encoding: 'utf8',
      shell: true 
    });
    
    const devices: { index: string; name: string }[] = [];
    const lines = output.split('\n');
    
    let capturing = false;
    for (const line of lines) {
      if (line.includes('AVFoundation video devices:')) {
        capturing = true;
        continue;
      }
      if (line.includes('AVFoundation audio devices:')) break;
      
      if (capturing && line.includes('[AVFoundation indev @')) {
        const match = line.match(/\[AVFoundation indev @ [^\]]+\]\s+\[(\d+)\]\s+(.+)/);
        if (match && !match[2].includes('Capture screen')) {
          devices.push({ index: match[1], name: match[2] });
        }
      }
    }
    return devices;
  } catch (e: any) {
    console.error('Error getting cameras:', e.message);
    return [];
  }
}

// Get terminal dimensions
function getTerminalSize() {
  const width = process.stdout.columns || 80;
  const height = process.stdout.rows || 24;
  // Leave some space for header and footer
  return { width, height: height - 3 };
}

async function main() {
  const cameras = getCameras();
  
  if (cameras.length === 0) {
    console.log('No cameras found!');
    process.exit(1);
  }
  
  console.log('Available cameras:');
  cameras.forEach((cam, i) => {
    console.log(`  ${i + 1}. ${cam.name}`);
  });
  
  const selectedCamera = cameras[0];
  console.log(`\nUsing: ${selectedCamera.name}`);
  console.log('Starting webcam stream with COLOR...');
  console.log('Press Ctrl+C to exit\n');
  
  // Get terminal dimensions
  let { width, height } = getTerminalSize();
  
  console.log(`Terminal size: ${width}x${height}`);
  console.log('Resize terminal to adjust video size\n');
  
  // Wait a moment then clear for full screen
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  let ffmpeg: any = null;
  
  function startFFmpeg() {
    // Kill existing ffmpeg if running
    if (ffmpeg) {
      ffmpeg.kill();
    }
    
    // Get current terminal size
    const size = getTerminalSize();
    width = size.width;
    height = size.height;
    
    // Start ffmpeg with RGB output
    ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-f', 'avfoundation',
      '-framerate', '30',
      '-video_size', '640x480',
      '-i', selectedCamera.index,
      '-vf', `scale=${width}:${height}:flags=fast_bilinear,fps=15`,
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',  // Changed to RGB24 for color
      '-'
    ], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    const frameSize = width * height * 3; // 3 bytes per pixel (RGB)
    let videoBuffer = Buffer.alloc(frameSize);
    let bufferPos = 0;
    let frameCount = 0;
    let fps = 0;
    
    // FPS counter
    const fpsInterval = setInterval(() => {
      fps = frameCount;
      frameCount = 0;
    }, 1000);
    
    // ASCII characters for different brightness levels
    const asciiChars = ' .,:;ox%#@';
    
    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      let chunkPos = 0;
      
      while (chunkPos < chunk.length) {
        const remaining = frameSize - bufferPos;
        const toCopy = Math.min(remaining, chunk.length - chunkPos);
        
        chunk.copy(videoBuffer, bufferPos, chunkPos, chunkPos + toCopy);
        bufferPos += toCopy;
        chunkPos += toCopy;
        
        // Complete frame received
        if (bufferPos >= frameSize) {
          renderFrame();
          bufferPos = 0;
          frameCount++;
        }
      }
    });
    
    function renderFrame() {
      // Clear screen and move cursor to top
      process.stdout.write('\x1b[2J\x1b[H');
      
      // Build the frame
      let output = '';
      
      // Add header with FPS and dimensions
      output += `\x1b[95m● ${selectedCamera.name} | ${width}x${height} | FPS: ${fps}\x1b[0m\n`;
      output += '\x1b[90m' + '─'.repeat(width) + '\x1b[0m\n';
      
      // Render ASCII art with color
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const idx = (y * width + x) * 3;
          const r = videoBuffer[idx];
          const g = videoBuffer[idx + 1];
          const b = videoBuffer[idx + 2];
          
          // Calculate brightness
          const brightness = (r + g + b) / 3;
          
          // Map brightness to ASCII character
          const charIdx = Math.min(
            asciiChars.length - 1,
            Math.floor((brightness / 255) * asciiChars.length)
          );
          const char = asciiChars[charIdx];
          
          // Use 256-color mode for better color representation
          // Convert RGB to 256-color palette
          if (brightness < 10) {
            output += char; // Very dark, no color
          } else {
            // Use true color ANSI escape codes (24-bit color)
            output += `\x1b[38;2;${r};${g};${b}m${char}\x1b[0m`;
          }
        }
        output += '\n';
      }
      
      // Write the entire frame at once
      process.stdout.write(output);
    }
    
    ffmpeg.stderr.on('data', (data: Buffer) => {
      console.error('FFmpeg error:', data.toString());
    });
    
    ffmpeg.on('error', (err: Error) => {
      console.error('Failed to start webcam:', err.message);
      clearInterval(fpsInterval);
    });
    
    ffmpeg.on('exit', (code: number) => {
      clearInterval(fpsInterval);
      if (code !== null && code !== 0) {
        console.error(`\nFFmpeg exited with code ${code}`);
      }
    });
  }
  
  // Start initial ffmpeg
  startFFmpeg();
  
  // Handle terminal resize
  process.stdout.on('resize', () => {
    console.log('\nTerminal resized, restarting stream...');
    startFFmpeg();
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nStopping webcam...');
    if (ffmpeg) {
      ffmpeg.kill();
    }
    process.exit(0);
  });
}

main().catch(console.error);