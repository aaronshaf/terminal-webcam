#!/usr/bin/env bun
import { spawn, execSync } from 'child_process';

// Get list of cameras
function getCameras() {
  try {
    // ffmpeg returns non-zero exit code when listing devices, so we need to handle that
    const output = execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', { 
      encoding: 'utf8',
      shell: true 
    });
    
    const devices: string[] = [];
    const lines = output.split('\n');
    
    let capturing = false;
    for (const line of lines) {
      if (line.includes('AVFoundation video devices:')) {
        capturing = true;
        continue;
      }
      if (line.includes('AVFoundation audio devices:')) break;
      
      if (capturing && line.includes('[AVFoundation indev @')) {
        // Parse lines like: [AVFoundation indev @ 0x149f04cc0] [0] Anker PowerConf C200
        const match = line.match(/\[AVFoundation indev @ [^\]]+\]\s+\[(\d+)\]\s+(.+)/);
        if (match && !match[2].includes('Capture screen')) {
          devices.push(`${match[1]}:${match[2]}`);
        }
      }
    }
    return devices;
  } catch (e: any) {
    console.error('Error getting cameras:', e.message);
    return [];
  }
}

// Simple ASCII art viewer without OpenTUI
async function main() {
  const cameras = getCameras();
  
  if (cameras.length === 0) {
    console.log('No cameras found!');
    process.exit(1);
  }
  
  console.log('Available cameras:');
  cameras.forEach((cam, i) => {
    const [id, name] = cam.split(':');
    console.log(`  ${i + 1}. ${name}`);
  });
  
  // For now, just use the first camera
  const selectedCamera = cameras[0].split(':')[0];
  console.log(`\nUsing camera index: ${selectedCamera}`);
  console.log('Starting ffmpeg test...\n');
  
  // Test with simple ffmpeg output
  const ffmpeg = spawn('ffmpeg', [
    '-f', 'avfoundation',
    '-framerate', '30',  // Use supported framerate
    '-video_size', '640x480',  // Specify input size
    '-i', selectedCamera,
    '-t', '5',  // Run for 5 seconds
    '-vf', 'scale=80:24,fps=5',  // Scale and reduce fps in filter
    '-f', 'rawvideo',
    '-pix_fmt', 'gray',
    '-'
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  let frameCount = 0;
  const frameSize = 80 * 24;
  let buffer = Buffer.alloc(frameSize);
  let pos = 0;
  
  ffmpeg.stdout.on('data', (chunk: Buffer) => {
    // Fill buffer
    while (pos < frameSize && chunk.length > 0) {
      const toRead = Math.min(frameSize - pos, chunk.length);
      chunk.copy(buffer, pos, 0, toRead);
      pos += toRead;
      
      if (pos >= frameSize) {
        frameCount++;
        console.log(`Frame ${frameCount} received (${frameSize} bytes)`);
        
        // Show a sample of the frame as ASCII
        const ascii = ' .:-=+*#%@';
        let output = '';
        for (let y = 0; y < 24; y++) {
          for (let x = 0; x < 80; x++) {
            const brightness = buffer[y * 80 + x];
            const idx = Math.floor((brightness / 255) * (ascii.length - 1));
            output += ascii[idx];
          }
          output += '\n';
        }
        console.log('\x1b[2J\x1b[H'); // Clear screen
        console.log(output);
        
        pos = 0;
      }
    }
  });
  
  ffmpeg.stderr.on('data', (data) => {
    console.error('FFmpeg stderr:', data.toString());
  });
  
  ffmpeg.on('error', (err) => {
    console.error('FFmpeg error:', err);
  });
  
  ffmpeg.on('exit', (code) => {
    console.log(`\nFFmpeg exited with code: ${code}`);
    console.log(`Total frames processed: ${frameCount}`);
  });
}

main().catch(console.error);