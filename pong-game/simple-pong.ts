#!/usr/bin/env bun

const GAME_WIDTH = 60
const GAME_HEIGHT = 20
const PADDLE_HEIGHT = 4
const FPS = 30
const WINNING_SCORE = 5

interface GameState {
  ballX: number
  ballY: number
  ballVelX: number
  ballVelY: number
  leftPaddleY: number
  rightPaddleY: number
  leftScore: number
  rightScore: number
  gameRunning: boolean
  winner: string | null
}

class SimplePong {
  private state: GameState
  private frameInterval: NodeJS.Timeout | null = null
  
  constructor() {
    this.state = {
      ballX: GAME_WIDTH / 2,
      ballY: GAME_HEIGHT / 2,
      ballVelX: 1,
      ballVelY: 0.5,
      leftPaddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      rightPaddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      leftScore: 0,
      rightScore: 0,
      gameRunning: false,
      winner: null,
    }
  }
  
  start() {
    // Setup terminal
    process.stdout.write('\x1b[?25l') // Hide cursor
    process.stdout.write('\x1b[2J')    // Clear screen
    process.stdout.write('\x1b[H')     // Move to top
    
    // Setup raw input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true)
    }
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    
    // Handle keyboard input
    process.stdin.on('data', (key: string) => {
      this.handleInput(key)
    })
    
    // Start game loop
    this.frameInterval = setInterval(() => {
      this.update()
      this.render()
    }, 1000 / FPS)
    
    this.render()
  }
  
  handleInput(key: string) {
    // Handle special keys
    if (key === '\u0003' || key === 'q') { // Ctrl+C or Q
      this.quit()
      return
    }
    
    if (key === ' ') { // Space
      if (this.state.winner) {
        this.reset()
      } else {
        this.state.gameRunning = !this.state.gameRunning
      }
      return
    }
    
    if (key === 'r') { // Reset
      this.reset()
      return
    }
    
    // Paddle controls (only when game is running)
    if (this.state.gameRunning && !this.state.winner) {
      // Left paddle
      if (key === 'w' && this.state.leftPaddleY > 0) {
        this.state.leftPaddleY--
      } else if (key === 's' && this.state.leftPaddleY < GAME_HEIGHT - PADDLE_HEIGHT) {
        this.state.leftPaddleY++
      }
      
      // Right paddle
      if (key === 'i' && this.state.rightPaddleY > 0) {
        this.state.rightPaddleY--
      } else if (key === 'k' && this.state.rightPaddleY < GAME_HEIGHT - PADDLE_HEIGHT) {
        this.state.rightPaddleY++
      }
    }
  }
  
  update() {
    if (!this.state.gameRunning || this.state.winner) return
    
    // Update ball position
    this.state.ballX += this.state.ballVelX
    this.state.ballY += this.state.ballVelY
    
    // Ball collision with walls
    if (this.state.ballY <= 0 || this.state.ballY >= GAME_HEIGHT - 1) {
      this.state.ballVelY = -this.state.ballVelY
      this.state.ballY = Math.max(0, Math.min(GAME_HEIGHT - 1, this.state.ballY))
    }
    
    // Ball collision with paddles
    const ballX = Math.round(this.state.ballX)
    const ballY = Math.round(this.state.ballY)
    
    // Left paddle
    if (ballX <= 2) {
      if (ballY >= this.state.leftPaddleY && ballY < this.state.leftPaddleY + PADDLE_HEIGHT) {
        this.state.ballVelX = Math.abs(this.state.ballVelX)
        // Add spin based on where ball hits paddle
        const paddleCenter = this.state.leftPaddleY + PADDLE_HEIGHT / 2
        const hitOffset = (ballY - paddleCenter) / (PADDLE_HEIGHT / 2)
        this.state.ballVelY = hitOffset * 0.8
      }
    }
    
    // Right paddle
    if (ballX >= GAME_WIDTH - 3) {
      if (ballY >= this.state.rightPaddleY && ballY < this.state.rightPaddleY + PADDLE_HEIGHT) {
        this.state.ballVelX = -Math.abs(this.state.ballVelX)
        // Add spin
        const paddleCenter = this.state.rightPaddleY + PADDLE_HEIGHT / 2
        const hitOffset = (ballY - paddleCenter) / (PADDLE_HEIGHT / 2)
        this.state.ballVelY = hitOffset * 0.8
      }
    }
    
    // Scoring
    if (this.state.ballX < 0) {
      this.state.rightScore++
      this.serveBall(-1)
      if (this.state.rightScore >= WINNING_SCORE) {
        this.state.winner = 'Right Player'
        this.state.gameRunning = false
      }
    } else if (this.state.ballX > GAME_WIDTH) {
      this.state.leftScore++
      this.serveBall(1)
      if (this.state.leftScore >= WINNING_SCORE) {
        this.state.winner = 'Left Player'
        this.state.gameRunning = false
      }
    }
  }
  
  serveBall(direction: number) {
    this.state.ballX = GAME_WIDTH / 2
    this.state.ballY = GAME_HEIGHT / 2
    this.state.ballVelX = direction
    this.state.ballVelY = (Math.random() - 0.5) * 0.8
  }
  
  reset() {
    this.state = {
      ballX: GAME_WIDTH / 2,
      ballY: GAME_HEIGHT / 2,
      ballVelX: Math.random() > 0.5 ? 1 : -1,
      ballVelY: (Math.random() - 0.5) * 0.8,
      leftPaddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      rightPaddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      leftScore: 0,
      rightScore: 0,
      gameRunning: false,
      winner: null,
    }
  }
  
  render() {
    // Build the game screen
    const screen: string[][] = []
    
    // Initialize empty screen
    for (let y = 0; y < GAME_HEIGHT + 6; y++) {
      screen[y] = []
      for (let x = 0; x < GAME_WIDTH + 4; x++) {
        screen[y][x] = ' '
      }
    }
    
    // Draw border
    for (let x = 0; x < GAME_WIDTH + 4; x++) {
      screen[0][x] = '─'
      screen[GAME_HEIGHT + 3][x] = '─'
    }
    for (let y = 0; y < GAME_HEIGHT + 4; y++) {
      screen[y][0] = '│'
      screen[y][GAME_WIDTH + 3] = '│'
    }
    screen[0][0] = '┌'
    screen[0][GAME_WIDTH + 3] = '┐'
    screen[GAME_HEIGHT + 3][0] = '└'
    screen[GAME_HEIGHT + 3][GAME_WIDTH + 3] = '┘'
    
    // Draw center line
    for (let y = 2; y < GAME_HEIGHT + 2; y += 2) {
      screen[y][GAME_WIDTH / 2 + 2] = '┆'
    }
    
    // Draw paddles
    for (let i = 0; i < PADDLE_HEIGHT; i++) {
      const leftY = Math.round(this.state.leftPaddleY) + i + 2
      const rightY = Math.round(this.state.rightPaddleY) + i + 2
      
      if (leftY >= 2 && leftY < GAME_HEIGHT + 2) {
        screen[leftY][2] = '█'
      }
      if (rightY >= 2 && rightY < GAME_HEIGHT + 2) {
        screen[rightY][GAME_WIDTH + 1] = '█'
      }
    }
    
    // Draw ball
    const ballX = Math.round(this.state.ballX) + 2
    const ballY = Math.round(this.state.ballY) + 2
    if (ballX >= 2 && ballX <= GAME_WIDTH + 1 && ballY >= 2 && ballY < GAME_HEIGHT + 2) {
      screen[ballY][ballX] = '●'
    }
    
    // Draw scores
    const scoreText = `${this.state.leftScore}     ${this.state.rightScore}`
    const scoreX = Math.floor((GAME_WIDTH + 4 - scoreText.length) / 2)
    for (let i = 0; i < scoreText.length; i++) {
      screen[1][scoreX + i] = scoreText[i]
    }
    
    // Draw status
    let statusText = ''
    if (this.state.winner) {
      statusText = `🏆 ${this.state.winner} Wins! Press SPACE to play again`
    } else if (!this.state.gameRunning) {
      statusText = 'Press SPACE to start'
    } else {
      statusText = 'Playing...'
    }
    
    const statusX = Math.floor((GAME_WIDTH + 4 - statusText.length) / 2)
    for (let i = 0; i < statusText.length; i++) {
      if (statusX + i < GAME_WIDTH + 4) {
        screen[GAME_HEIGHT + 4][statusX + i] = statusText[i]
      }
    }
    
    // Draw controls
    const controls = 'W/S: Left | I/K: Right | SPACE: Start/Pause | R: Reset | Q: Quit'
    const controlsX = Math.floor((GAME_WIDTH + 4 - controls.length) / 2)
    for (let i = 0; i < controls.length; i++) {
      if (controlsX + i < GAME_WIDTH + 4) {
        screen[GAME_HEIGHT + 5][controlsX + i] = controls[i]
      }
    }
    
    // Clear screen and render
    process.stdout.write('\x1b[H') // Move cursor to top
    process.stdout.write('\x1b[2J') // Clear screen
    
    // Output the screen
    for (let y = 0; y < screen.length; y++) {
      process.stdout.write(screen[y].join('') + '\n')
    }
  }
  
  quit() {
    if (this.frameInterval) {
      clearInterval(this.frameInterval)
    }
    
    // Restore terminal
    process.stdout.write('\x1b[?25h') // Show cursor
    process.stdout.write('\x1b[2J')    // Clear screen
    process.stdout.write('\x1b[H')     // Move to top
    
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false)
    }
    
    process.exit(0)
  }
}

// Start the game
const game = new SimplePong()
game.start()