import { createTerminalRenderer } from '@opentui/core';

const renderer = createTerminalRenderer({
  width: 80,
  height: 40,
  targetFPS: 30
});

async function startWebcamStream() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { 
        width: 640, 
        height: 480 
      } 
    });
    
    const video = document.createElement('video');
    video.srcObject = stream;
    video.play();
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    canvas.width = 80;
    canvas.height = 40;
    
    const asciiChars = ' .:-=+*#%@';
    
    function frameToAscii() {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      
      let asciiFrame = '';
      
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const idx = (y * canvas.width + x) * 4;
          const r = pixels[idx];
          const g = pixels[idx + 1];
          const b = pixels[idx + 2];
          
          const brightness = (r + g + b) / 3;
          const charIndex = Math.floor((brightness / 255) * (asciiChars.length - 1));
          asciiFrame += asciiChars[charIndex];
        }
        asciiFrame += '\n';
      }
      
      renderer.render(asciiFrame);
      requestAnimationFrame(frameToAscii);
    }
    
    video.addEventListener('loadedmetadata', () => {
      frameToAscii();
    });
    
  } catch (error) {
    console.error('Error accessing webcam:', error);
    renderer.render('Failed to access webcam. Please ensure camera permissions are granted.');
  }
}

startWebcamStream();

process.on('SIGINT', () => {
  renderer.cleanup();
  process.exit(0);
});