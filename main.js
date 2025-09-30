(() => {
  "use strict";

  const canvas = document.getElementById("board");
  if (!(canvas instanceof HTMLCanvasElement)) {
    return;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const btnPause = document.getElementById("btn-pause");
  const btnRestart = document.getElementById("btn-restart");
  const btnStart = document.getElementById("btn-start");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMessage = document.getElementById("overlay-message");
  const speedSelect = document.getElementById("speed");
  const touchButtons = Array.from(document.querySelectorAll(".touch-controls button"));

  const GRID_SIZE = 22;
  const STORAGE_KEY = "snake-best-score";
  const POINTS_PER_FOOD = 10;
  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  let boardSize = canvas.getBoundingClientRect().width || 440;
  let cellSize = boardSize / GRID_SIZE;
  let status = "ready"; // ready | running | paused | over
  let stepDuration = 1000 / Number((speedSelect && speedSelect.value) || 9);
  let lastTimestamp = 0;
  let accumulator = 0;
  let rafId = 0;
  let swipeStart = null;

  const state = {
    snake: [],
    snakeSet: new Set(),
    direction: DIRS.right,
    pendingDirections: [],
    food: null,
    score: 0,
    best: loadBestScore(),
    speed: Number((speedSelect && speedSelect.value) || 9)
  };

  init();

  function init() {
    updateScoreboard();
    ensureCanvasScale();
    render();
    setStatus("ready", {
      title: "贪吃蛇",
      message: "点击开始按钮或按回车开始游戏",
      buttonLabel: "开始游戏"
    });
    bindEvents();
  }

  function bindEvents() {
    window.addEventListener("resize", handleResize);
    window.addEventListener("blur", () => {
      pauseGame(true);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        pauseGame(true);
      }
    });

    window.addEventListener(
      "keydown",
      (event) => {
        const key = event.key;
        if (!key) {
          return;
        }
        const lower = key.toLowerCase();

        if (lower === "arrowup" || lower === "w") {
          event.preventDefault();
          handleDirectionInput("up");
          return;
        }
        if (lower === "arrowdown" || lower === "s") {
          event.preventDefault();
          handleDirectionInput("down");
          return;
        }
        if (lower === "arrowleft" || lower === "a") {
          event.preventDefault();
          handleDirectionInput("left");
          return;
        }
        if (lower === "arrowright" || lower === "d") {
          event.preventDefault();
          handleDirectionInput("right");
          return;
        }
        if (key === " " || lower === "spacebar") {
          event.preventDefault();
          if (status === "running") {
            pauseGame(false);
          } else if (status === "paused") {
            resumeGame();
          }
          return;
        }
        if (lower === "enter") {
          event.preventDefault();
          if (status === "ready" || status === "over") {
            startGame();
          } else if (status === "paused") {
            resumeGame();
          }
        }
      },
      { passive: false }
    );

    if (btnStart) {
      btnStart.addEventListener("click", () => {
        if (status === "ready" || status === "over") {
          startGame();
        } else if (status === "paused") {
          resumeGame();
        }
      });
    }

    if (btnRestart) {
      btnRestart.addEventListener("click", () => {
        startGame();
      });
    }

    if (btnPause) {
      btnPause.addEventListener("click", () => {
        if (status === "running") {
          pauseGame(false);
        } else if (status === "paused") {
          resumeGame();
        }
      });
    }

    if (speedSelect) {
      speedSelect.addEventListener("change", (event) => {
        const value = Number(event.target.value);
        if (!Number.isFinite(value) || value <= 0) {
          return;
        }
        state.speed = value;
        stepDuration = 1000 / state.speed;
      });
    }

    if (canvas) {
      canvas.addEventListener(
        "touchstart",
        (event) => {
          event.preventDefault();
          const touch = event.changedTouches[0];
          swipeStart = touch ? { x: touch.clientX, y: touch.clientY } : null;
        },
        { passive: false }
      );

      canvas.addEventListener(
        "touchend",
        (event) => {
          event.preventDefault();
          if (!swipeStart) {
            return;
          }
          const touch = event.changedTouches[0];
          if (!touch) {
            swipeStart = null;
            return;
          }
          const dx = touch.clientX - swipeStart.x;
          const dy = touch.clientY - swipeStart.y;
          swipeStart = null;
          const absX = Math.abs(dx);
          const absY = Math.abs(dy);
          const threshold = 24;
          if (absX < threshold && absY < threshold) {
            return;
          }
          if (absX > absY) {
            handleDirectionInput(dx > 0 ? "right" : "left");
          } else {
            handleDirectionInput(dy > 0 ? "down" : "up");
          }
        },
        { passive: false }
      );
    }

    touchButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const dirKey = button.getAttribute("data-dir");
        if (!dirKey) {
          return;
        }
        handleDirectionInput(dirKey);
      });
    });
  }

  function handleResize() {
    ensureCanvasScale();
    render();
  }

  function handleDirectionInput(dirKey) {
    const dir = DIRS[dirKey];
    if (!dir) {
      return;
    }
    if (status === "ready") {
      startGame(dir);
      return;
    }
    queueDirection(dir);
  }

  function startGame(initialDirection) {
    resetGame(initialDirection);
    setStatus("running");
    stepDuration = 1000 / state.speed;
    accumulator = 0;
    lastTimestamp = performance.now();
    cancelAnimationFrame(rafId);
    render();
    rafId = requestAnimationFrame(gameLoop);
  }

  function resumeGame() {
    if (status !== "paused") {
      return;
    }
    setStatus("running");
    accumulator = 0;
    lastTimestamp = performance.now();
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(gameLoop);
  }

  function pauseGame(autoTriggered) {
    if (status !== "running") {
      return;
    }
    cancelAnimationFrame(rafId);
    setStatus("paused", {
      title: "已暂停",
      message: autoTriggered ? "窗口失去焦点，游戏已暂停" : "点击继续按钮或按空格继续游戏",
      buttonLabel: "继续游戏"
    });
    render();
  }

  function resetGame(initialDirection) {
    const direction = initialDirection || DIRS.right;
    state.direction = direction;
    state.pendingDirections = [];
    const startX = Math.floor(GRID_SIZE / 2);
    const startY = Math.floor(GRID_SIZE / 2);

    const segments = [];
    for (let i = 0; i < 3; i += 1) {
      segments.push({
        x: startX - direction.x * i,
        y: startY - direction.y * i
      });
    }

    state.snake = segments;
    state.snakeSet = new Set(state.snake.map(cellKey));
    state.food = spawnFood();
    state.score = 0;
    updateScoreboard();
  }

  function gameLoop(timestamp) {
    if (status !== "running") {
      return;
    }

    const delta = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    accumulator += delta;

    while (accumulator >= stepDuration) {
      accumulator -= stepDuration;
      step();
      if (status !== "running") {
        return;
      }
    }

    render();
    rafId = requestAnimationFrame(gameLoop);
  }

  function step() {
    const nextDir = state.pendingDirections.shift();
    if (nextDir) {
      state.direction = nextDir;
    }

    const head = state.snake[0];
    const nextHead = {
      x: head.x + state.direction.x,
      y: head.y + state.direction.y
    };

    if (
      nextHead.x < 0 ||
      nextHead.y < 0 ||
      nextHead.x >= GRID_SIZE ||
      nextHead.y >= GRID_SIZE ||
      state.snakeSet.has(cellKey(nextHead))
    ) {
      handleGameOver();
      return;
    }

    state.snake.unshift(nextHead);
    state.snakeSet.add(cellKey(nextHead));

    if (state.food && nextHead.x === state.food.x && nextHead.y === state.food.y) {
      state.score += POINTS_PER_FOOD;
      if (state.score > state.best) {
        state.best = state.score;
        saveBestScore(state.best);
      }
      updateScoreboard();
      state.food = spawnFood();
    } else {
      const tail = state.snake.pop();
      if (tail) {
        state.snakeSet.delete(cellKey(tail));
      }
    }
  }

  function handleGameOver() {
    cancelAnimationFrame(rafId);
    setStatus("over", {
      title: "游戏结束",
      message: "本局得分：" + state.score,
      buttonLabel: "再来一局"
    });
    render();
  }

  function queueDirection(dir) {
    const lastDir = state.pendingDirections.length
      ? state.pendingDirections[state.pendingDirections.length - 1]
      : state.direction;

    if (isOpposite(lastDir, dir) || (lastDir.x === dir.x && lastDir.y === dir.y)) {
      return;
    }

    state.pendingDirections.push(dir);

    if (state.pendingDirections.length > 3) {
      state.pendingDirections.shift();
    }
  }

  function isOpposite(a, b) {
    return a.x + b.x === 0 && a.y + b.y === 0;
  }

  function spawnFood() {
    if (state.snake.length >= GRID_SIZE * GRID_SIZE) {
      return null;
    }

    let attempts = 0;
    while (attempts < 1000) {
      attempts += 1;
      const x = Math.floor(Math.random() * GRID_SIZE);
      const y = Math.floor(Math.random() * GRID_SIZE);
      const key = x + "," + y;
      if (!state.snakeSet.has(key)) {
        return { x, y };
      }
    }

    // Fallback: scan board
    for (let x = 0; x < GRID_SIZE; x += 1) {
      for (let y = 0; y < GRID_SIZE; y += 1) {
        const key = x + "," + y;
        if (!state.snakeSet.has(key)) {
          return { x, y };
        }
      }
    }
    return null;
  }

  function ensureCanvasScale() {
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(200, Math.round(rect.width));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    if (size !== boardSize || canvas.width !== Math.floor(size * dpr)) {
      boardSize = size;
      canvas.width = Math.floor(size * dpr);
      canvas.height = Math.floor(size * dpr);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(dpr, dpr);
      cellSize = boardSize / GRID_SIZE;
    }
  }

  function render() {
    ensureCanvasScale();
    const size = cellSize * GRID_SIZE;

    ctx.clearRect(0, 0, size, size);
    drawBoardBackground(size);
    drawFood();
    drawSnake();
  }

  function drawBoardBackground(size) {
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, size, size);

    ctx.fillStyle = "rgba(148, 163, 184, 0.08)";
    for (let y = 0; y < GRID_SIZE; y += 1) {
      for (let x = (y % 2 === 0 ? 0 : 1); x < GRID_SIZE; x += 2) {
        ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
      }
    }

    ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i <= GRID_SIZE; i += 1) {
      ctx.moveTo(0, i * cellSize);
      ctx.lineTo(size, i * cellSize);
      ctx.moveTo(i * cellSize, 0);
      ctx.lineTo(i * cellSize, size);
    }
    ctx.stroke();
  }

  function drawSnake() {
    const segmentCount = state.snake.length;
    for (let i = segmentCount - 1; i >= 0; i -= 1) {
      const segment = state.snake[i];
      const isHead = i === 0;
      const x = segment.x * cellSize;
      const y = segment.y * cellSize;
      const padding = 1.5;
      const w = cellSize - padding * 2;
      const radius = Math.min(cellSize * 0.3, 8);

      ctx.fillStyle = isHead ? "#22d3ee" : "#38bdf8";
      drawRoundedRect(ctx, x + padding, y + padding, w, w, radius);
      ctx.fill();
    }
  }

  function drawFood() {
    if (!state.food) {
      return;
    }
    const centerX = state.food.x * cellSize + cellSize / 2;
    const centerY = state.food.y * cellSize + cellSize / 2;
    const radius = cellSize * 0.35;

    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#fb923c";
    ctx.beginPath();
    ctx.arc(centerX - radius * 0.35, centerY - radius * 0.35, radius * 0.45, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawRoundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.lineTo(x + width - r, y);
    context.quadraticCurveTo(x + width, y, x + width, y + r);
    context.lineTo(x + width, y + height - r);
    context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    context.lineTo(x + r, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - r);
    context.lineTo(x, y + r);
    context.quadraticCurveTo(x, y, x + r, y);
    context.closePath();
  }

  function cellKey(pos) {
    return pos.x + "," + pos.y;
  }

  function updateScoreboard() {
    if (scoreEl) {
      scoreEl.textContent = String(state.score);
    }
    if (bestEl) {
      bestEl.textContent = String(state.best);
    }
  }

  function setStatus(next, overlayOptions) {
    status = next;

    if (overlayOptions) {
      if (overlayTitle) {
        overlayTitle.textContent = overlayOptions.title;
      }
      if (overlayMessage) {
        overlayMessage.textContent = overlayOptions.message;
      }
      if (btnStart && overlayOptions.buttonLabel) {
        btnStart.textContent = overlayOptions.buttonLabel;
      }
    }

    if (overlay) {
      const isRunning = next === "running";
      overlay.hidden = isRunning;
      overlay.setAttribute("aria-hidden", isRunning ? "true" : "false");
      overlay.style.display = isRunning ? "none" : "grid";
    }

    if (btnPause) {
      if (next === "running") {
        btnPause.disabled = false;
        btnPause.textContent = "暂停";
      } else if (next === "paused") {
        btnPause.disabled = false;
        btnPause.textContent = "继续";
      } else {
        btnPause.textContent = "暂停";
        btnPause.disabled = next === "ready";
      }
    }
  }

  function loadBestScore() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const value = raw ? Number(raw) : 0;
      return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
    } catch (_error) {
      return 0;
    }
  }

  function saveBestScore(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value));
    } catch (_error) {
      // ignore storage failures
    }
  }
})();
