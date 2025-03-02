const canvas = document.getElementById('geometryCanvas');
const ctx = canvas.getContext('2d');
const message = document.getElementById('message');

// Input elements
const sideABInput = document.getElementById('sideAB');
const sideABSlider = document.getElementById('sideABSlider');
const sideBCInput = document.getElementById('sideBC');
const sideBCSlider = document.getElementById('sideBCSlider');
const angleBInput = document.getElementById('angleB');
const showFullCircle = document.getElementById('showFullCircle');
const showGridEle = document.getElementById('showGrid');

let unit = '';

function syncInputs(slider, input)
{
  [slider, input].forEach(element =>
  {
    element.addEventListener('input', (e) =>
    {
      if (element.type === 'text')
      {
        // Remove non-numeric chars from start, keep only last decimal point
        let value = e.target.value;
        value = value.replace(/^[^\d]+/, '');
        const parts = value.split('.');
        if (parts.length > 1)
        {
          value = parts[0] + '.' + parts.slice(1).join('');
        }

        // Extract number and unit
        const match = value.match(/^(\d*\.?\d+)(.*)$/);
        if (match)
        {
          const numValue = match[1];
          unit = match[2] || '';
          slider.value = numValue;
          input.value = numValue + unit;

          // Update other text input
          const otherInput = input === sideABInput ? sideBCInput : sideABInput;
          const otherValue = otherInput.value.replace(/[^\d.]+/g, '');
          otherInput.value = otherValue + unit;
        }
      } else
      {
        const value = e.target.value;
        slider.value = value;
        input.value = value + unit;
      }
      drawMain();
    });
  });
}

syncInputs(sideABSlider, sideABInput);
syncInputs(sideBCSlider, sideBCInput);

[showGridEle, angleBInput, showFullCircle].forEach(element =>
{
  element.addEventListener('input', drawMain);
});

// Camera variables
let cameraOffsetX = 0;
let cameraOffsetY = 0;
let cameraZoom = 3.0;
let targetZoom = cameraZoom;

function lerp(start, end, t)
{
  return start * (1 - t) + end * t;
}
// Helper function to convert world to screen coordinates
function worldToScreen(worldX, worldY)
{
  return {
    x: worldX * cameraZoom + cameraOffsetX,
    y: worldY * cameraZoom + cameraOffsetY
  };
}

// Add screenToWorld helper function if not already present
function screenToWorld(screenX, screenY)
{
  return {
    x: (screenX - cameraOffsetX) / cameraZoom,
    y: (screenY - cameraOffsetY) / cameraZoom
  };
}

// Add this function near the top of the file
function drawGrid(ctx)
{
  if (!showGridEle.checked) return;

  ctx.save();
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 0.5;

  // Calculate grid size based on zoom
  let baseGridSize = 10; // 1 unit in world coordinates
  if (cameraZoom < 0.25)
  {
    baseGridSize = 40;
  }
  else if (cameraZoom < 0.5)
  {
    baseGridSize = 20;
  }


  // Calculate visible range in world coordinates
  const startX = Math.floor(-cameraOffsetX / cameraZoom / baseGridSize) * baseGridSize;
  const endX = Math.ceil((ctx.canvas.width - cameraOffsetX) / cameraZoom / baseGridSize) * baseGridSize;
  const startY = Math.floor(-cameraOffsetY / cameraZoom / baseGridSize) * baseGridSize;
  const endY = Math.ceil((ctx.canvas.height - cameraOffsetY) / cameraZoom / baseGridSize) * baseGridSize;

  // Draw vertical lines
  for (let x = startX; x <= endX; x += baseGridSize)
  {
    const screenX = Math.round(worldToScreen(x, 0).x);
    ctx.beginPath();
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, ctx.canvas.height);
    ctx.stroke();
  }

  // Draw horizontal lines
  for (let y = startY; y <= endY; y += baseGridSize)
  {
    const screenY = Math.round(worldToScreen(0, y).y);
    ctx.beginPath();
    ctx.moveTo(0, screenY);
    ctx.lineTo(ctx.canvas.width, screenY);
    ctx.stroke();
  }
  ctx.restore();
}




let resizeTimeout;

function handleResize()
{
  const oldWidth = canvas.width;
  const oldHeight = canvas.height;

  // Get world coordinates of screen center before resize
  const centerXBefore = screenToWorld(oldWidth / 2, oldHeight / 2).x;
  const centerYBefore = screenToWorld(oldWidth / 2, oldHeight / 2).y;

  // Update canvas size
  const parent = canvas.parentElement || document.body;
  const newWidth = parent.clientWidth * 2;
  const newHeight = parent.clientHeight * 2;
  canvas.width = newWidth;
  canvas.height = newHeight;

  // Get new screen center in world coordinates
  const centerXAfter = screenToWorld(newWidth / 2, newHeight / 2).x;
  const centerYAfter = screenToWorld(newWidth / 2, newHeight / 2).y;

  // Adjust offset to maintain center point
  cameraOffsetX += (centerXBefore - centerXAfter) * cameraZoom * 2; // 3.5 is a magic number
  cameraOffsetY += (centerYBefore - centerYAfter) * cameraZoom * 2; // 3.5 is a magic number

  setTimeout(() =>
  {
    drawMain();
  }, 10);
}


// Initial size
handleResize();

// Debounced resize listener
window.addEventListener('resize', () =>
{
  if (resizeTimeout)
  {
    clearTimeout(resizeTimeout);
  }
  resizeTimeout = setTimeout(handleResize, 50);
});

// Scale factor for visualization
const SCALE = 2;
const deg2rad = Math.PI / 180;

const MAX_PAN_DISTANCE = 800;


function drawTriangle(x1, y1, x2, y2, x3, y3)
{
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

function arcpoint(x, y, x2, y2, angle)
{
  // Calculate radius using distance formula
  let radius = Math.sqrt(Math.pow(x2 - x, 2) + Math.pow(y2 - y, 2));

  // Calculate starting angle in degrees
  let startAngle = (Math.atan2(y2 - y, x2 - x) * 180 / Math.PI) - angle / 2;

  // Calculate end angle by adding the input angle
  let endAngle = startAngle + angle;

  arc(x, y, radius, startAngle, endAngle);
}
function arc(x, y, radius, startAngle, endAngle)
{
  if (showFullCircle.checked)
  {
    ctx.strokeStyle = "black";
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  let func = () => ctx.arc(x, y, radius, startAngle * Math.PI / 180, endAngle * Math.PI / 180);

  ctx.beginPath();
  ctx.moveTo(x, y);
  func();
  ctx.closePath();
  ctx.fillStyle = "rgba(0, 0, 0, 0.02)";
  ctx.strokeStyle = "transparent";
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  func();
  ctx.strokeStyle = "black";
  ctx.stroke();
}

/**
 * Draws an angle bisector with arcs
 * @param {number} angle - Angle in radians
 * @param {number} centerX - X coordinate of angle vertex
 * @param {number} centerY - Y coordinate of angle vertex
 * @param {number} radius - Radius of initial arcs (default: 80)
 * @param {number} bisectorLength - Length of the bisector line (default: 130)
 * @param {number} arcRadius - Radius of connecting arcs (default: 20)
 */
function drawBisector(
  angle,
  centerX,
  centerY,
  radius = 80,
  bisectorLength = 130,
  arcRadius = 20
)
{
  // Validate parameters
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY))
  {
    throw new Error('Invalid center coordinates');
  }

  // Calculate arc points using polar coordinates
  const point1 = {
    x: centerX + radius * Math.cos(Math.PI),
    y: centerY + radius * Math.sin(Math.PI)
  };

  const point2 = {
    x: centerX + radius * Math.cos(angle - Math.PI),
    y: centerY + radius * Math.sin(angle - Math.PI)
  };

  // Calculate bisector endpoint
  const bisectorAngle = angle / 2;
  const endPoint = {
    x: centerX - bisectorLength * Math.cos(bisectorAngle),
    y: centerY - bisectorLength * Math.sin(bisectorAngle)
  };

  // Draw all arcs in one path
  ctx.beginPath();
  arcpoint(centerX, centerY, point1.x, point1.y, arcRadius);
  arcpoint(centerX, centerY, point2.x, point2.y, arcRadius);
  arcpoint(point1.x, point1.y, endPoint.x, endPoint.y, arcRadius);
  arcpoint(point2.x, point2.y, endPoint.x, endPoint.y, arcRadius);
  ctx.stroke();
}

function drawMain()
{
  constrainCamera();

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid(ctx);

  // Apply camera transform
  ctx.translate(cameraOffsetX, cameraOffsetY);
  ctx.scale(cameraZoom, cameraZoom);
  ctx.lineWidth = 3 / cameraZoom;

  // Get input values
  const sideAB = parseInt(sideABInput.value);
  const sideBC = parseInt(sideBCInput.value);
  const angleB = parseFloat(angleBInput.value);

  // Calculate third side using law of cosines
  const angleRad = angleB * deg2rad;
  const sideAC = Math.sqrt(
    Math.pow(sideAB, 2) +
    Math.pow(sideBC, 2) -
    2 * sideAB * sideBC * Math.cos(angleRad)
  );

  // Check if triangle is valid
  if (
    sideAB + sideBC <= sideAC ||
    sideBC + sideAC <= sideAB ||
    sideAC + sideAB <= sideBC
  )
  {
    message.textContent = "Invalid triangle configuration!";
    return;
  }

  message.textContent = "";

  // Calculate coordinates for visualization
  const startX = 0;
  const startY = 0;


  //Draw baseline
  ctx.beginPath();
  ctx.strokeStyle = 'rgb(159, 159, 159)'; // Semi-transparent red
  ctx.moveTo(startX - 10000, startY);
  ctx.lineTo(startX + 10000, startY);
  ctx.stroke();

  // Point A
  const ax = startX;
  const ay = startY;

  // Point B
  const bx = startX + sideAB * SCALE;
  const by = startY;

  // Point C
  const cx = bx - sideBC * SCALE * Math.cos(angleRad);
  const cy = startY - sideBC * SCALE * Math.sin(angleRad);


  // Point Circle intersection top
  const cix = bx - sideAB * SCALE * Math.cos(60 * deg2rad);
  const ciy = startY - sideAB * SCALE * Math.sin(60 * deg2rad);

  // Calculate extended line BC
  const extendFactor = 6000; // Length of extension
  const extendedX = cix + ((cix - bx) / sideAB) * extendFactor;
  const extendedY = ciy + ((ciy - by) / sideAB) * extendFactor;

  // Draw extended line in different color
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255, 0, 0, 1)'; // Semi-transparent red
  ctx.moveTo(bx, by);
  ctx.lineTo(extendedX, extendedY);
  ctx.stroke();


  ctx.beginPath();
  arcpoint(ax, ay, cix, ciy, 10);
  ctx.stroke();

  //arc(bx, by, sideAB * SCALE, 100, -100);
  arcpoint(bx, by, cix, ciy, 10);








  // Reset stroke style
  ctx.strokeStyle = 'black';


  ctx.beginPath();
  arcpoint(ax, ay, bx, by, 5);
  ctx.closePath();

  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = 'rgba(37, 99, 235, 0.1)';
  drawTriangle(ax, ay, bx, by, cx, cy);


  // Draw text labels
  ctx.save();
  ctx.resetTransform();
  ctx.font = '24px monospace';
  ctx.fillStyle = 'black';
  ctx.textAlign = "center";
  ctx.textBaseline = 'middle';

  // Convert each text position from world to screen coordinates
  const pointA = worldToScreen(ax, ay);
  ctx.fillText('A', pointA.x, pointA.y);

  const pointB = worldToScreen(bx, by);
  ctx.fillText('B', pointB.x, pointB.y);

  const pointC = worldToScreen(cx, cy);
  ctx.fillText('C', pointC.x, pointC.y);

  const sideABLabel = worldToScreen((ax + bx) / 2, ay + 2);
  ctx.fillText(`${sideAB}${unit}`, sideABLabel.x, sideABLabel.y + 12);

  const sideBCLabel = worldToScreen((bx + cx) / 2, (by + cy) / 2);
  ctx.fillText(`${sideBC}${unit}`, sideBCLabel.x + 25, sideBCLabel.y - 25);

  const angleBLabel = worldToScreen(bx - 5, by - 1);
  ctx.fillText(`${angleB}°`, angleBLabel.x - 30, angleBLabel.y - 5);

  ctx.restore();

  // If angle is 30°, draw the bisector construction
  if (angleB === 30)
  {
    drawBisector(angleRad * 2, bx, by);
  }

  ctx.restore();
}

// Center camera on triangle initially
function centerCamera()
{
  const sideAB = parseInt(sideABInput.value);
  cameraOffsetX = canvas.width / 2 - (sideAB * SCALE / 2) * cameraZoom;
  cameraOffsetY = canvas.height / 2 + 500;
}

function constrainCamera()
{
  const centerX = canvas.width / 2 - (parseInt(sideABInput.value) * SCALE / 2) * cameraZoom;
  const centerY = canvas.height / 2 + 300;

  cameraOffsetX = Math.min(Math.max(cameraOffsetX, centerX - MAX_PAN_DISTANCE * cameraZoom), centerX + MAX_PAN_DISTANCE * cameraZoom);
  cameraOffsetY = Math.min(Math.max(cameraOffsetY, centerY - MAX_PAN_DISTANCE * cameraZoom), centerY + MAX_PAN_DISTANCE * cameraZoom);
}

const logoElement = document.getElementById('logoimg');
if (logoElement)
{
  logoElement.addEventListener('pointerover', () =>
  {
    logoElement.classList.add('hovering');
  });

  logoElement.addEventListener('pointerout', () =>
  {
    logoElement.classList.remove('hovering');
  });
}

// Initial draw
centerCamera();
drawMain();







// Mouse drag for panning
let isDragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('pointerdown', (e) =>
{
  isDragging = true;
  lastX = e.clientX * 2;
  lastY = e.clientY * 2;
  logoElement.classList.add('noevents');
});

function handleMoveEvent(clientX, clientY)
{
  cameraOffsetX += clientX * 2 - lastX;
  cameraOffsetY += clientY * 2 - lastY;
  lastX = clientX * 2;
  lastY = clientY * 2;
  drawMain();
}

canvas.addEventListener('touchmove', (e) =>
{
  e.preventDefault();
  if (isDragging)
  {
    const touch = e.touches[0];
    handleMoveEvent(touch.clientX, touch.clientY);
  }
});

canvas.addEventListener('pointermove', (e) =>
{
  if (isDragging)
  {
    handleMoveEvent(e.clientX, e.clientY);
  }
});

canvas.addEventListener('pointerup', () => { isDragging = false; logoElement.classList.remove('noevents'); });
canvas.addEventListener('pointerleave', () => isDragging = false);





// Mouse wheel zooming
canvas.addEventListener('wheel', (e) =>
{
  // Get mouse position relative to canvas
  const rect = canvas.getBoundingClientRect();
  const mouseX = (e.clientX - rect.left) * 2;
  const mouseY = (e.clientY - rect.top) * 2;

  // Get world position before zoom
  const worldX = (mouseX - cameraOffsetX) / cameraZoom;
  const worldY = (mouseY - cameraOffsetY) / cameraZoom;

  // Calculate new zoom
  const zoomAmount = e.deltaY > 0 ? 0.9 : 1.1;
  targetZoom = Math.max(targetZoom * zoomAmount, 0.2);

  // Smoothly interpolate current zoom
  cameraZoom = lerp(cameraZoom, targetZoom, 0.1);

  // Adjust offset to zoom into mouse position
  cameraOffsetX = mouseX - worldX * cameraZoom;
  cameraOffsetY = mouseY - worldY * cameraZoom;

  // Continue animation
  function animate()
  {
    if (Math.abs(cameraZoom - targetZoom) > 0.01)
    {
      drawMain();
      cameraZoom = lerp(cameraZoom, targetZoom, 0.1);
      cameraOffsetX = mouseX - worldX * cameraZoom;
      cameraOffsetY = mouseY - worldY * cameraZoom;
      requestAnimationFrame(animate);
    }
  }
  animate();
}, { passive: true });

// Touch pinch zooming
const touchHandler = setupPointingDevice(canvas);
let pinchMode = false;

canvas.addEventListener('touchmove', (e) =>
{
  if (e.touches == 1) return;
  if (touchHandler.count === 2)
  {
    const p1 = { x: touchHandler.points[0].x, y: touchHandler.points[0].y };
    const p2 = { x: touchHandler.points[1].x, y: touchHandler.points[1].y };

    if (!pinchMode)
    {
      pinchMode = true;
      view.setPinch(p1, p2);
    } else
    {
      view.movePinch(p1, p2, true); // Disable rotation
      cameraZoom = view.matrix[0];
      cameraOffsetX = view.matrix[4];
      cameraOffsetY = view.matrix[5];
    }
  }
});

canvas.addEventListener('touchend', () =>
{
  pinchMode = false;
});

// View transformation for pinch zooming
const view = (() =>
{
  const matrix = [1, 0, 0, 1, 0, 0];
  const invMatrix = [1, 0, 0, 1, 0, 0];
  const pinch1 = { x: 0, y: 0 };
  const pinch1R = { x: 0, y: 0 };
  let scale = 1;
  let pinchScale = 1;
  let pinchDist = 0;

  return {
    matrix,
    setPinch(p1, p2)
    {
      pinch1.x = p1.x;
      pinch1.y = p1.y;
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      pinchDist = Math.sqrt(dx * dx + dy * dy);
      pinchScale = scale;
      this.toWorld(pinch1, pinch1R);
    },
    movePinch(p1, p2)
    {
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const newDist = Math.sqrt(dx * dx + dy * dy);
      scale = pinchScale * (newDist / pinchDist);
      matrix[0] = scale;
      matrix[3] = scale;
      matrix[4] = p1.x - pinch1R.x * matrix[0];
      matrix[5] = p1.y - pinch1R.y * matrix[3];
    },
    toWorld(screen, world = {})
    {
      const invScale = 1 / scale;
      world.x = (screen.x - matrix[4]) * invScale;
      world.y = (screen.y - matrix[5]) * invScale;
      return world;
    },
  };
})();

// Pointing device setup for touch events
function setupPointingDevice(element)
{
  const touch = {
    points: Array.from({ length: navigator.maxTouchPoints || 5 }, () => ({
      x: 0,
      y: 0,
      down: false,
      id: -1,
    })),
    count: 0,
  };

  const updateTouch = (changedTouches, start) =>
  {
    for (const point of changedTouches)
    {
      const touchPoint = touch.points.find((tp) => tp.id === point.identifier || tp.id === -1);
      if (touchPoint)
      {
        touchPoint.x = point.pageX;
        touchPoint.y = point.pageY;
        touchPoint.down = start;
        if (start) touchPoint.id = point.identifier;
        else touchPoint.id = -1;
      }
    }
    touch.count = touch.points.filter((tp) => tp.down).length;
  };

  const onTouchEvent = (e) =>
  {
    switch (e.type)
    {
      case "touchstart":
        updateTouch(e.changedTouches, true);
        break;
      case "touchmove":
        updateTouch(e.changedTouches, true);
        break;
      case "touchend":
        updateTouch(e.changedTouches, false);
        break;
    }
    e.preventDefault();
  };

  element.addEventListener("touchstart", onTouchEvent);
  element.addEventListener("touchmove", onTouchEvent);
  element.addEventListener("touchend", onTouchEvent);

  return touch;
}








