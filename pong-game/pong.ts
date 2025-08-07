import {
  createCliRenderer,
  TextRenderable,
  BoxRenderable,
  GroupRenderable,
  TextAttributes,
  type CliRenderer,
} from "@opentui/core"

const GAME_WIDTH = 80
const GAME_HEIGHT = 30
const PADDLE_HEIGHT = 5
const BALL_SPEED = 30
const PADDLE_SPEED = 20
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

class PongGame {
  private renderer: CliRenderer
  private gameGroup: GroupRenderable
  private state: GameState
  private lastUpdate: number
  private keyHandler: ((key: Buffer) => void) | null = null

  constructor(renderer: CliRenderer) {
    this.renderer = renderer
    this.gameGroup = new GroupRenderable("game-group", { x: 0, y: 0, zIndex: 0 })
    this.lastUpdate = Date.now()
    
    this.state = {
      ballX: GAME_WIDTH / 2,
      ballY: GAME_HEIGHT / 2,
      ballVelX: BALL_SPEED,
      ballVelY: BALL_SPEED * 0.5,
      leftPaddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      rightPaddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      leftScore: 0,
      rightScore: 0,
      gameRunning: false,
      winner: null,
    }
  }

  init() {
    this.renderer.start()
    this.renderer.setBackgroundColor("#001122")
    this.renderer.add(this.gameGroup)

    // Title
    const title = new TextRenderable("title", {
      content: "🏓 PONG GAME 🏓",
      x: GAME_WIDTH / 2 - 7,
      y: 1,
      fg: "#FFFF00",
      attributes: TextAttributes.BOLD | TextAttributes.UNDERLINE,
      zIndex: 10,
    })
    this.gameGroup.add(title)

    // Game field border
    const field = new BoxRenderable("field", {
      x: 2,
      y: 3,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      bg: "#002244",
      zIndex: 0,
      borderStyle: "double",
      borderColor: "#FFFFFF",
    })
    this.gameGroup.add(field)

    // Center line
    for (let y = 4; y < GAME_HEIGHT + 2; y += 2) {
      const centerLine = new TextRenderable(`center-${y}`, {
        content: "│",
        x: GAME_WIDTH / 2 + 2,
        y: y,
        fg: "#666666",
        zIndex: 1,
      })
      this.gameGroup.add(centerLine)
    }

    // Scores
    const leftScoreText = new TextRenderable("left-score", {
      content: "0",
      x: GAME_WIDTH / 2 - 10,
      y: 5,
      fg: "#FFFFFF",
      attributes: TextAttributes.BOLD,
      zIndex: 10,
    })
    this.gameGroup.add(leftScoreText)

    const rightScoreText = new TextRenderable("right-score", {
      content: "0",
      x: GAME_WIDTH / 2 + 12,
      y: 5,
      fg: "#FFFFFF",
      attributes: TextAttributes.BOLD,
      zIndex: 10,
    })
    this.gameGroup.add(rightScoreText)

    // Instructions
    const instructions = new TextRenderable("instructions", {
      content: "Controls: W/S - Left paddle | ↑/↓ - Right paddle | SPACE - Start/Pause | R - Reset | Q - Quit",
      x: 5,
      y: GAME_HEIGHT + 4,
      fg: "#AAAAAA",
      zIndex: 10,
    })
    this.gameGroup.add(instructions)

    // Start message
    const startMsg = new TextRenderable("start-msg", {
      content: "Press SPACE to start!",
      x: GAME_WIDTH / 2 - 9,
      y: GAME_HEIGHT / 2 + 3,
      fg: "#00FF00",
      attributes: TextAttributes.BOLD,
      zIndex: 10,
    })
    this.gameGroup.add(startMsg)

    // Setup keyboard input
    this.setupKeyboard()
    
    // Start game loop
    this.gameLoop()
  }

  private setupKeyboard() {
    this.keyHandler = (key: Buffer) => {
      const keyStr = key.toString()
      
      // Game controls
      if (keyStr === " ") {
        if (this.state.winner) {
          this.resetGame()
        } else {
          this.state.gameRunning = !this.state.gameRunning
          const startMsg = this.gameGroup.getRenderable("start-msg") as TextRenderable
          if (startMsg) {
            startMsg.content = this.state.gameRunning ? "" : "PAUSED - Press SPACE to continue"
          }
        }
      } else if (keyStr === "r" || keyStr === "R") {
        this.resetGame()
      } else if (keyStr === "q" || keyStr === "Q") {
        this.cleanup()
        process.exit(0)
      }
      
      // Paddle controls
      if (this.state.gameRunning && !this.state.winner) {
        // Left paddle
        if (keyStr === "w" || keyStr === "W") {
          this.state.leftPaddleY = Math.max(0, this.state.leftPaddleY - 2)
        } else if (keyStr === "s" || keyStr === "S") {
          this.state.leftPaddleY = Math.min(GAME_HEIGHT - PADDLE_HEIGHT, this.state.leftPaddleY + 2)
        }
        
        // Right paddle (arrow keys)
        if (key[0] === 27 && key[1] === 91) {
          if (key[2] === 65) { // Up arrow
            this.state.rightPaddleY = Math.max(0, this.state.rightPaddleY - 2)
          } else if (key[2] === 66) { // Down arrow
            this.state.rightPaddleY = Math.min(GAME_HEIGHT - PADDLE_HEIGHT, this.state.rightPaddleY + 2)
          }
        }
      }
    }
    
    process.stdin.on("data", this.keyHandler)
  }

  private resetGame() {
    this.state = {
      ballX: GAME_WIDTH / 2,
      ballY: GAME_HEIGHT / 2,
      ballVelX: BALL_SPEED * (Math.random() > 0.5 ? 1 : -1),
      ballVelY: BALL_SPEED * (Math.random() - 0.5),
      leftPaddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      rightPaddleY: GAME_HEIGHT / 2 - PADDLE_HEIGHT / 2,
      leftScore: 0,
      rightScore: 0,
      gameRunning: false,
      winner: null,
    }
    
    const startMsg = this.gameGroup.getRenderable("start-msg") as TextRenderable
    if (startMsg) {
      startMsg.content = "Press SPACE to start!"
      startMsg.fg = "#00FF00"
    }
    
    const winnerMsg = this.gameGroup.getRenderable("winner-msg")
    if (winnerMsg) {
      this.gameGroup.remove("winner-msg")
    }
  }

  private gameLoop() {
    const now = Date.now()
    const deltaTime = (now - this.lastUpdate) / 1000
    this.lastUpdate = now

    if (this.state.gameRunning && !this.state.winner) {
      this.updateGame(deltaTime)
    }
    
    this.render()
    
    // Continue game loop
    setTimeout(() => this.gameLoop(), 16) // ~60 FPS
  }

  private updateGame(deltaTime: number) {
    // Update ball position
    this.state.ballX += this.state.ballVelX * deltaTime
    this.state.ballY += this.state.ballVelY * deltaTime
    
    // Ball collision with top/bottom walls
    if (this.state.ballY <= 0 || this.state.ballY >= GAME_HEIGHT - 1) {
      this.state.ballVelY = -this.state.ballVelY
      this.state.ballY = Math.max(0, Math.min(GAME_HEIGHT - 1, this.state.ballY))
    }
    
    // Ball collision with paddles
    const ballLeft = Math.floor(this.state.ballX)
    const ballTop = Math.floor(this.state.ballY)
    
    // Left paddle collision
    if (ballLeft <= 3 && ballLeft >= 2) {
      if (ballTop >= this.state.leftPaddleY && ballTop <= this.state.leftPaddleY + PADDLE_HEIGHT) {
        this.state.ballVelX = Math.abs(this.state.ballVelX)
        const paddleCenter = this.state.leftPaddleY + PADDLE_HEIGHT / 2
        const hitOffset = (this.state.ballY - paddleCenter) / (PADDLE_HEIGHT / 2)
        this.state.ballVelY = BALL_SPEED * hitOffset * 0.75
      }
    }
    
    // Right paddle collision
    if (ballLeft >= GAME_WIDTH - 3 && ballLeft <= GAME_WIDTH - 2) {
      if (ballTop >= this.state.rightPaddleY && ballTop <= this.state.rightPaddleY + PADDLE_HEIGHT) {
        this.state.ballVelX = -Math.abs(this.state.ballVelX)
        const paddleCenter = this.state.rightPaddleY + PADDLE_HEIGHT / 2
        const hitOffset = (this.state.ballY - paddleCenter) / (PADDLE_HEIGHT / 2)
        this.state.ballVelY = BALL_SPEED * hitOffset * 0.75
      }
    }
    
    // Score when ball goes out of bounds
    if (this.state.ballX < 0) {
      this.state.rightScore++
      this.resetBall()
    } else if (this.state.ballX > GAME_WIDTH) {
      this.state.leftScore++
      this.resetBall()
    }
    
    // Check for winner
    if (this.state.leftScore >= WINNING_SCORE) {
      this.state.winner = "Left Player"
      this.state.gameRunning = false
      this.showWinner()
    } else if (this.state.rightScore >= WINNING_SCORE) {
      this.state.winner = "Right Player"
      this.state.gameRunning = false
      this.showWinner()
    }
  }

  private resetBall() {
    this.state.ballX = GAME_WIDTH / 2
    this.state.ballY = GAME_HEIGHT / 2
    this.state.ballVelX = BALL_SPEED * (Math.random() > 0.5 ? 1 : -1)
    this.state.ballVelY = BALL_SPEED * (Math.random() - 0.5)
  }

  private showWinner() {
    const winnerMsg = new TextRenderable("winner-msg", {
      content: `🏆 ${this.state.winner} WINS! 🏆`,
      x: GAME_WIDTH / 2 - 10,
      y: GAME_HEIGHT / 2,
      fg: "#FFD700",
      attributes: TextAttributes.BOLD,
      zIndex: 20,
    })
    this.gameGroup.add(winnerMsg)
    
    const startMsg = this.gameGroup.getRenderable("start-msg") as TextRenderable
    if (startMsg) {
      startMsg.content = "Press SPACE to play again!"
      startMsg.fg = "#00FF00"
    }
  }

  private render() {
    // Clear old paddles and ball
    for (let y = 0; y < GAME_HEIGHT; y++) {
      this.gameGroup.remove(`left-paddle-${y}`)
      this.gameGroup.remove(`right-paddle-${y}`)
    }
    this.gameGroup.remove("ball")
    
    // Draw left paddle
    for (let i = 0; i < PADDLE_HEIGHT; i++) {
      const y = Math.floor(this.state.leftPaddleY) + i
      if (y >= 0 && y < GAME_HEIGHT) {
        const paddle = new TextRenderable(`left-paddle-${y}`, {
          content: "█",
          x: 3,
          y: y + 4,
          fg: "#00FF00",
          zIndex: 5,
        })
        this.gameGroup.add(paddle)
      }
    }
    
    // Draw right paddle
    for (let i = 0; i < PADDLE_HEIGHT; i++) {
      const y = Math.floor(this.state.rightPaddleY) + i
      if (y >= 0 && y < GAME_HEIGHT) {
        const paddle = new TextRenderable(`right-paddle-${y}`, {
          content: "█",
          x: GAME_WIDTH + 1,
          y: y + 4,
          fg: "#FF00FF",
          zIndex: 5,
        })
        this.gameGroup.add(paddle)
      }
    }
    
    // Draw ball
    const ballX = Math.floor(this.state.ballX) + 2
    const ballY = Math.floor(this.state.ballY) + 4
    if (ballX >= 2 && ballX <= GAME_WIDTH + 2 && ballY >= 4 && ballY <= GAME_HEIGHT + 3) {
      const ball = new TextRenderable("ball", {
        content: "●",
        x: ballX,
        y: ballY,
        fg: "#FFFFFF",
        zIndex: 10,
      })
      this.gameGroup.add(ball)
    }
    
    // Update scores
    const leftScore = this.gameGroup.getRenderable("left-score") as TextRenderable
    if (leftScore) {
      leftScore.content = this.state.leftScore.toString()
    }
    
    const rightScore = this.gameGroup.getRenderable("right-score") as TextRenderable
    if (rightScore) {
      rightScore.content = this.state.rightScore.toString()
    }
  }

  cleanup() {
    if (this.keyHandler) {
      process.stdin.removeListener("data", this.keyHandler)
      this.keyHandler = null
    }
    this.renderer.clearFrameCallbacks()
    this.renderer.remove(this.gameGroup.id)
    this.renderer.setCursorPosition(0, 0, false)
  }
}

// Main entry point
if (import.meta.main) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    stdin: process.stdin,
    stdout: process.stdout,
  })
  
  const game = new PongGame(renderer)
  game.init()
}