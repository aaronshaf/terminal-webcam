// Minimal OpenTUI core implementation for terminal-webcam
// Based on OpenTUI but simplified for our specific use case

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

export interface TextRenderableOptions {
  content: string
  x: number
  y: number
  fg?: string
  bg?: string
  zIndex?: number
}

export class TextRenderable {
  public content: string
  public x: number
  public y: number
  public fg?: string
  public bg?: string
  public zIndex: number
  
  constructor(public id: string, options: TextRenderableOptions) {
    this.content = options.content
    this.x = options.x
    this.y = options.y
    this.fg = options.fg
    this.bg = options.bg
    this.zIndex = options.zIndex || 0
  }
}

export interface CliRenderer {
  terminalWidth: number
  terminalHeight: number
  start(): void
  stop(): void
  add(renderable: TextRenderable): void
  getRenderable(id: string): TextRenderable | undefined
  setBackgroundColor(color: string): void
  setCursorPosition(x: number, y: number, visible: boolean): void
  on(event: string, handler: (data: any) => void): void
}

class SimpleCliRenderer implements CliRenderer {
  private renderables: Map<string, TextRenderable> = new Map()
  private running = false
  private eventHandlers: Map<string, Array<(data: any) => void>> = new Map()
  
  constructor(
    public terminalWidth: number,
    public terminalHeight: number,
    private stdin: NodeJS.ReadStream,
    private stdout: NodeJS.WriteStream
  ) {}
  
  start() {
    this.running = true
    // Clear screen
    this.stdout.write('\x1b[2J\x1b[H')
    // Hide cursor
    this.stdout.write('\x1b[?25l')
    // Set raw mode
    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(true)
    }
    this.stdin.resume()
    
    // Start render loop
    this.renderLoop()
  }
  
  stop() {
    this.running = false
    // Show cursor
    this.stdout.write('\x1b[?25h')
    // Clear screen
    this.stdout.write('\x1b[2J\x1b[H')
    // Reset raw mode
    if (this.stdin.setRawMode) {
      this.stdin.setRawMode(false)
    }
  }
  
  add(renderable: TextRenderable) {
    this.renderables.set(renderable.id, renderable)
  }
  
  getRenderable(id: string): TextRenderable | undefined {
    return this.renderables.get(id)
  }
  
  setBackgroundColor(color: string) {
    // Convert hex to ANSI background color
    this.stdout.write('\x1b[48;2;0;0;0m')
  }
  
  setCursorPosition(x: number, y: number, visible: boolean) {
    this.stdout.write(`\x1b[${y + 1};${x + 1}H`)
    if (visible) {
      this.stdout.write('\x1b[?25h')
    } else {
      this.stdout.write('\x1b[?25l')
    }
  }
  
  on(event: string, handler: (data: any) => void) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, [])
    }
    this.eventHandlers.get(event)!.push(handler)
  }
  
  private lastRenderState: Map<string, string> = new Map()
  
  private renderLoop() {
    if (!this.running) return
    
    // Sort renderables by z-index
    const sorted = Array.from(this.renderables.values()).sort((a, b) => a.zIndex - b.zIndex)
    
    for (const renderable of sorted) {
      // Create a hash of the renderable's current state
      const stateHash = `${renderable.content}|${renderable.fg}|${renderable.bg}|${renderable.x}|${renderable.y}`
      const lastState = this.lastRenderState.get(renderable.id)
      
      // Only render if the state has changed
      if (lastState !== stateHash) {
        // Move cursor to position
        this.stdout.write(`\x1b[${renderable.y + 1};${renderable.x + 1}H`)
        
        // For high z-index items (status bars), clear the area first
        if (renderable.zIndex >= 1000 && renderable.bg) {
          // Clear from cursor to end of line for status bars
          this.stdout.write('\x1b[K')
          // Move back to position
          this.stdout.write(`\x1b[${renderable.y + 1};${renderable.x + 1}H`)
        }
        
        // Set colors if provided
        if (renderable.fg || renderable.bg) {
          let colorCode = ''
          
          if (renderable.fg) {
            // Convert hex to RGB
            const fg = this.hexToRgb(renderable.fg)
            if (fg) {
              colorCode += `\x1b[38;2;${fg.r};${fg.g};${fg.b}m`
            }
          }
          
          if (renderable.bg) {
            const bg = this.hexToRgb(renderable.bg)
            if (bg) {
              colorCode += `\x1b[48;2;${bg.r};${bg.g};${bg.b}m`
            }
          }
          
          this.stdout.write(colorCode)
        }
        
        // Write content
        this.stdout.write(renderable.content)
        
        // Reset colors
        if (renderable.fg || renderable.bg) {
          this.stdout.write('\x1b[0m')
        }
        
        // Update the last render state
        this.lastRenderState.set(renderable.id, stateHash)
      }
    }
    
    // Schedule next frame
    setTimeout(() => this.renderLoop(), 33) // ~30fps, more reasonable for terminal
  }
  
  private hexToRgb(hex: string): { r: number, g: number, b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null
  }
}

export async function createCliRenderer(options: {
  exitOnCtrlC?: boolean
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
}): Promise<CliRenderer> {
  const { stdout, stdin } = options
  
  // Get terminal size
  const terminalWidth = (stdout as any).columns || 80
  const terminalHeight = (stdout as any).rows || 24
  
  const renderer = new SimpleCliRenderer(terminalWidth, terminalHeight, stdin, stdout)
  
  // Handle exit on Ctrl+C if requested
  if (options.exitOnCtrlC !== false) {
    stdin.on('data', (key: Buffer) => {
      if (key.toString() === '\x03') {
        renderer.stop()
        process.exit(0)
      }
    })
  }
  
  return renderer
}