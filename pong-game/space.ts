import {
  createCliRenderer,
  TextRenderable,
  BoxRenderable,
  GroupRenderable,
  TextAttributes,
  rgbToHex,
  hsvToRgb,
  type CliRenderer,
  RGBA,
} from "@opentui/core"

interface Star {
  x: number
  y: number
  brightness: number
  twinkleSpeed: number
  twinklePhase: number
  char: string
  color: string
  size: number
}

interface ShootingStar {
  x: number
  y: number
  vx: number
  vy: number
  trail: { x: number; y: number; brightness: number }[]
  alive: boolean
}

interface Planet {
  x: number
  y: number
  radius: number
  color: string
  orbitRadius: number
  orbitSpeed: number
  angle: number
  name: string
}

class SpaceIllustration {
  private renderer: CliRenderer
  private mainGroup: GroupRenderable
  private stars: Star[] = []
  private shootingStars: ShootingStar[] = []
  private planets: Planet[] = []
  private width: number
  private height: number
  private time: number = 0
  private keyHandler: ((key: Buffer) => void) | null = null

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.width = renderer.terminalWidth
    this.height = renderer.terminalHeight
    this.mainGroup = new GroupRenderable("space-group", { x: 0, y: 0, zIndex: 0 })
  }

  init() {
    this.renderer.start()
    this.renderer.setBackgroundColor("#000011")
    this.renderer.add(this.mainGroup)
    this.renderer.setCursorPosition(0, 0, false)

    // Generate stars
    this.generateStars()
    
    // Create planets
    this.createPlanets()

    // Add title
    const title = new TextRenderable("title", {
      content: "✨ Space Illustration ✨",
      x: Math.floor(this.width / 2 - 12),
      y: 1,
      fg: "#FFD700",
      attributes: TextAttributes.BOLD,
      zIndex: 100,
    })
    this.mainGroup.add(title)

    // Add instructions
    const instructions = new TextRenderable("instructions", {
      content: "Press SPACE for shooting star | Q to quit",
      x: Math.floor(this.width / 2 - 20),
      y: this.height - 1,
      fg: "#666666",
      zIndex: 100,
    })
    this.mainGroup.add(instructions)

    // Setup keyboard
    this.setupKeyboard()

    // Start animation loop
    this.animate()
  }

  private generateStars() {
    const starCount = Math.floor((this.width * this.height) / 15)
    const starChars = ["·", "✦", "✧", "★", "✪", "✯", "✴", "✵", "✶", "✷", "✸", "✹", "+", "*"]
    
    for (let i = 0; i < starCount; i++) {
      const brightness = Math.random()
      const star: Star = {
        x: Math.floor(Math.random() * this.width),
        y: Math.floor(Math.random() * (this.height - 2)) + 1,
        brightness: brightness,
        twinkleSpeed: Math.random() * 3 + 1,
        twinklePhase: Math.random() * Math.PI * 2,
        char: starChars[Math.floor(Math.random() * starChars.length)],
        color: this.getStarColor(brightness),
        size: brightness > 0.8 ? 2 : 1,
      }
      this.stars.push(star)
    }
  }

  private getStarColor(brightness: number): string {
    // Create different star colors based on brightness
    if (brightness > 0.9) {
      // Bright blue-white stars
      return rgbToHex({ r: 0.9 + brightness * 0.1, g: 0.9 + brightness * 0.1, b: 1 })
    } else if (brightness > 0.7) {
      // Yellow-white stars
      return rgbToHex({ r: 1, g: 1, b: 0.8 + brightness * 0.2 })
    } else if (brightness > 0.5) {
      // Orange stars
      return rgbToHex({ r: 1, g: 0.8, b: 0.5 + brightness * 0.3 })
    } else {
      // Red/dim stars
      return rgbToHex({ r: 0.8 + brightness * 0.2, g: 0.4 + brightness * 0.3, b: 0.3 + brightness * 0.2 })
    }
  }

  private createPlanets() {
    // Create a sun
    const sun: Planet = {
      x: Math.floor(this.width * 0.15),
      y: Math.floor(this.height * 0.3),
      radius: 3,
      color: "#FFD700",
      orbitRadius: 0,
      orbitSpeed: 0,
      angle: 0,
      name: "Sol",
    }
    this.planets.push(sun)

    // Create Earth-like planet
    const earth: Planet = {
      x: Math.floor(this.width * 0.6),
      y: Math.floor(this.height * 0.5),
      radius: 2,
      color: "#4169E1",
      orbitRadius: 25,
      orbitSpeed: 0.3,
      angle: 0,
      name: "Terra",
    }
    this.planets.push(earth)

    // Create Mars-like planet
    const mars: Planet = {
      x: Math.floor(this.width * 0.8),
      y: Math.floor(this.height * 0.7),
      radius: 1,
      color: "#CD5C5C",
      orbitRadius: 35,
      orbitSpeed: 0.2,
      angle: Math.PI,
      name: "Rust",
    }
    this.planets.push(mars)

    // Create gas giant
    const jupiter: Planet = {
      x: Math.floor(this.width * 0.85),
      y: Math.floor(this.height * 0.25),
      radius: 4,
      color: "#DEB887",
      orbitRadius: 0,
      orbitSpeed: 0,
      angle: 0,
      name: "Giant",
    }
    this.planets.push(jupiter)
  }

  private setupKeyboard() {
    this.keyHandler = (key: Buffer) => {
      const keyStr = key.toString()
      
      if (keyStr === "q" || keyStr === "Q" || keyStr === "\u0003") {
        this.cleanup()
        process.exit(0)
      } else if (keyStr === " ") {
        this.spawnShootingStar()
      }
    }
    
    process.stdin.on("data", this.keyHandler)
  }

  private spawnShootingStar() {
    const side = Math.random()
    let x, y, vx, vy
    
    if (side < 0.25) {
      // From top
      x = Math.random() * this.width
      y = 0
      vx = (Math.random() - 0.5) * 3
      vy = Math.random() * 2 + 1
    } else if (side < 0.5) {
      // From right
      x = this.width - 1
      y = Math.random() * this.height
      vx = -(Math.random() * 2 + 1)
      vy = (Math.random() - 0.5) * 3
    } else if (side < 0.75) {
      // From left
      x = 0
      y = Math.random() * this.height
      vx = Math.random() * 2 + 1
      vy = (Math.random() - 0.5) * 3
    } else {
      // From bottom
      x = Math.random() * this.width
      y = this.height - 1
      vx = (Math.random() - 0.5) * 3
      vy = -(Math.random() * 2 + 1)
    }
    
    const shootingStar: ShootingStar = {
      x,
      y,
      vx,
      vy,
      trail: [],
      alive: true,
    }
    
    this.shootingStars.push(shootingStar)
  }

  private animate() {
    const deltaTime = 0.016 // ~60 FPS
    this.time += deltaTime
    
    // Clear previous frame
    this.clearFrame()
    
    // Update and render stars
    this.renderStars()
    
    // Update and render shooting stars
    this.updateShootingStars(deltaTime)
    this.renderShootingStars()
    
    // Update and render planets
    this.updatePlanets(deltaTime)
    this.renderPlanets()
    
    // Add nebula effect in background
    this.renderNebula()
    
    // Continue animation
    setTimeout(() => this.animate(), 16)
  }

  private clearFrame() {
    // Remove old star renders
    for (let i = 0; i < this.stars.length; i++) {
      this.mainGroup.remove(`star-${i}`)
    }
    
    // Remove old shooting star renders
    for (let i = 0; i < 100; i++) {
      this.mainGroup.remove(`shooting-${i}`)
      for (let j = 0; j < 20; j++) {
        this.mainGroup.remove(`trail-${i}-${j}`)
      }
    }
    
    // Remove old planet renders
    for (let i = 0; i < this.planets.length; i++) {
      for (let y = -5; y <= 5; y++) {
        for (let x = -10; x <= 10; x++) {
          this.mainGroup.remove(`planet-${i}-${x}-${y}`)
        }
      }
      this.mainGroup.remove(`planet-name-${i}`)
    }
    
    // Remove nebula
    for (let i = 0; i < 20; i++) {
      this.mainGroup.remove(`nebula-${i}`)
    }
  }

  private renderStars() {
    this.stars.forEach((star, index) => {
      // Calculate twinkle effect
      const twinkle = Math.sin(this.time * star.twinkleSpeed + star.twinklePhase) * 0.3 + 0.7
      const actualBrightness = star.brightness * twinkle
      
      // Adjust color based on twinkle
      const color = this.getStarColor(actualBrightness)
      
      const starRender = new TextRenderable(`star-${index}`, {
        content: star.char,
        x: star.x,
        y: star.y,
        fg: color,
        zIndex: Math.floor(star.brightness * 10),
      })
      this.mainGroup.add(starRender)
    })
  }

  private updateShootingStars(deltaTime: number) {
    this.shootingStars = this.shootingStars.filter(star => {
      if (!star.alive) return false
      
      // Update position
      star.x += star.vx
      star.y += star.vy
      
      // Add to trail
      star.trail.unshift({
        x: star.x,
        y: star.y,
        brightness: 1,
      })
      
      // Fade trail
      star.trail = star.trail.map(point => ({
        ...point,
        brightness: point.brightness * 0.85,
      })).filter(point => point.brightness > 0.1)
      
      // Limit trail length
      if (star.trail.length > 15) {
        star.trail.pop()
      }
      
      // Check if out of bounds
      if (star.x < 0 || star.x >= this.width || star.y < 0 || star.y >= this.height) {
        star.alive = false
      }
      
      return star.alive
    })
  }

  private renderShootingStars() {
    this.shootingStars.forEach((star, starIndex) => {
      // Render trail
      star.trail.forEach((point, trailIndex) => {
        const x = Math.floor(point.x)
        const y = Math.floor(point.y)
        
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
          const brightness = point.brightness
          const color = rgbToHex({ r: brightness, g: brightness, b: brightness * 0.8 })
          
          const trailChar = brightness > 0.5 ? "━" : "─"
          
          const trailRender = new TextRenderable(`trail-${starIndex}-${trailIndex}`, {
            content: trailChar,
            x: x,
            y: y,
            fg: color,
            zIndex: 50,
          })
          this.mainGroup.add(trailRender)
        }
      })
      
      // Render head
      const x = Math.floor(star.x)
      const y = Math.floor(star.y)
      
      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        const headRender = new TextRenderable(`shooting-${starIndex}`, {
          content: "✦",
          x: x,
          y: y,
          fg: "#FFFFFF",
          attributes: TextAttributes.BOLD,
          zIndex: 51,
        })
        this.mainGroup.add(headRender)
      }
    })
  }

  private updatePlanets(deltaTime: number) {
    this.planets.forEach(planet => {
      if (planet.orbitRadius > 0) {
        planet.angle += planet.orbitSpeed * deltaTime
        // Simple orbit around sun (first planet)
        const sun = this.planets[0]
        planet.x = Math.floor(sun.x + Math.cos(planet.angle) * planet.orbitRadius)
        planet.y = Math.floor(sun.y + Math.sin(planet.angle) * planet.orbitRadius * 0.5)
      }
    })
  }

  private renderPlanets() {
    this.planets.forEach((planet, index) => {
      // Draw planet as a circle
      for (let dy = -planet.radius; dy <= planet.radius; dy++) {
        for (let dx = -planet.radius * 2; dx <= planet.radius * 2; dx++) {
          const distance = Math.sqrt((dx / 2) * (dx / 2) + dy * dy)
          if (distance <= planet.radius) {
            const px = planet.x + dx
            const py = planet.y + dy
            
            if (px >= 0 && px < this.width && py >= 0 && py < this.height) {
              // Add shading effect
              const shade = 1 - (distance / planet.radius) * 0.3
              const shadedColor = this.adjustColorBrightness(planet.color, shade)
              
              const planetPixel = new TextRenderable(`planet-${index}-${dx}-${dy}`, {
                content: "█",
                x: px,
                y: py,
                fg: shadedColor,
                zIndex: 30 + index,
              })
              this.mainGroup.add(planetPixel)
            }
          }
        }
      }
      
      // Add planet name
      if (planet.name) {
        const nameRender = new TextRenderable(`planet-name-${index}`, {
          content: planet.name,
          x: planet.x - Math.floor(planet.name.length / 2),
          y: planet.y + planet.radius + 1,
          fg: "#888888",
          zIndex: 35,
        })
        this.mainGroup.add(nameRender)
      }
    })
  }

  private renderNebula() {
    // Add some nebula clouds
    const nebulaColors = ["#1E0033", "#2D0044", "#3C0055", "#4B0066"]
    
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(this.width * 0.3 + Math.sin(this.time * 0.1 + i) * 20)
      const y = Math.floor(this.height * 0.6 + Math.cos(this.time * 0.1 + i) * 10)
      
      if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
        const nebula = new TextRenderable(`nebula-${i}`, {
          content: "░",
          x: x,
          y: y,
          fg: nebulaColors[i % nebulaColors.length],
          zIndex: 1,
        })
        this.mainGroup.add(nebula)
      }
    }
  }

  private adjustColorBrightness(hexColor: string, factor: number): string {
    const hex = hexColor.replace("#", "")
    const r = parseInt(hex.substr(0, 2), 16)
    const g = parseInt(hex.substr(2, 2), 16)
    const b = parseInt(hex.substr(4, 2), 16)
    
    return rgbToHex({
      r: Math.min(1, (r / 255) * factor),
      g: Math.min(1, (g / 255) * factor),
      b: Math.min(1, (b / 255) * factor),
    })
  }

  cleanup() {
    if (this.keyHandler) {
      process.stdin.removeListener("data", this.keyHandler)
      this.keyHandler = null
    }
    this.renderer.clearFrameCallbacks()
    this.renderer.remove(this.mainGroup.id)
    this.renderer.setCursorPosition(0, 0, false)
  }
}

// Main entry point
if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const space = new SpaceIllustration(renderer)
  space.init()
}