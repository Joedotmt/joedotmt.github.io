const canvas = document.getElementById('geometryCanvas');
const ctx = canvas.getContext('2d');
const message = document.getElementById('message');

// Input elements
const sideABInput = document.getElementById('sideAB');
const sideBCInput = document.getElementById('sideBC');
const angleBInput = document.getElementById('angleB');
const sideABValue = document.getElementById('sideABValue');
const sideBCValue = document.getElementById('sideBCValue');
const showFullCircle = document.getElementById('showFullCircle');
const showGridEle = document.getElementById('showGrid');


showGridEle.oninput = drawMain;
sideABInput.oninput = drawMain;
sideBCInput.oninput = drawMain;
angleBInput.oninput = drawMain;
showFullCircle.oninput = drawMain;

// Camera variables
let cameraOffsetX = 0;
let cameraOffsetY = 0;
let cameraZoom = 3.0;
let targetZoom = cameraZoom;

// Add lerp function at the top with other utilities
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

  const gridSize = baseGridSize * cameraZoom;


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

  // Update displayed values
  sideABValue.textContent = sideAB;
  sideBCValue.textContent = sideBC;

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
  const startX = 0;//-sideAB * SCALE / 2;
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


  ctx.strokeStyle = 'black';
  ctx.beginPath();
  ctx.arc(ax, ay, sideAB * SCALE, 280 * deg2rad, -40 * deg2rad);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(bx, by, sideAB * SCALE, 220 * deg2rad, -100 * deg2rad);
  ctx.stroke();

  // Full circles with lower opacity if checkbox is checked
  if (showFullCircle.checked)
  {
    ctx.globalAlpha = 0.2;
    ctx.beginPath();
    ctx.arc(ax, ay, sideAB * SCALE, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(bx, by, sideAB * SCALE, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Point Circle intersection top
  const cix = bx - sideBC * SCALE * Math.cos(60 * deg2rad);
  const ciy = startY - sideBC * SCALE * Math.sin(60 * deg2rad);

  // Calculate extended line BC
  const extendFactor = 6000; // Length of extension
  const extendedX = cix + ((cix - bx) / sideBC) * extendFactor;
  const extendedY = ciy + ((ciy - by) / sideBC) * extendFactor;

  // Draw extended line in different color
  ctx.beginPath();
  ctx.strokeStyle = 'rgba(255, 0, 0, 1)'; // Semi-transparent red
  ctx.moveTo(bx, by);
  ctx.lineTo(extendedX, extendedY);
  ctx.stroke();

  // Reset stroke style
  ctx.strokeStyle = 'black';

  // Draw triangle
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.lineTo(cx, cy);
  ctx.closePath();

  // Style and fill
  ctx.strokeStyle = '#2563eb';
  ctx.stroke();
  ctx.fillStyle = 'rgba(37, 99, 235, 0.1)';
  ctx.fill();



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
  ctx.fillText(`${sideAB}`, sideABLabel.x, sideABLabel.y + 12);

  const sideBCLabel = worldToScreen((bx + cx) / 2, (by + cy) / 2);
  ctx.fillText(`${sideBC}`, sideBCLabel.x + 25, sideBCLabel.y - 25);

  const angleBLabel = worldToScreen(bx - 5, by - 1);
  ctx.fillText(`${angleB}°`, angleBLabel.x - 30, angleBLabel.y - 5);

  ctx.restore();

  // If angle is 30°, draw the bisector construction
  if (angleB === 30)
  {
    const radiusA = 80;
    const radiusB = 70;
    const angleToBisect = angleRad * 2;
    ctx.strokeStyle = 'black';

    // First two arcs centered at point B
    ctx.beginPath();
    ctx.arc(bx, by, radiusA, 0.95 * Math.PI, 1.05 * Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(bx, by, radiusA, angleToBisect - 0.15 - Math.PI, angleToBisect + 0.15 - Math.PI);
    ctx.stroke();

    if (showFullCircle.checked)
    {
      // First two arcs centered at point B
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.arc(bx, by, radiusA, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }


    // Calculate intersection points
    const intersectAB = {
      x: bx - radiusA * Math.cos(0),
      y: by - radiusA * Math.sin(0)
    };

    const intersectBC = {
      x: bx - radiusA * Math.cos(angleToBisect),
      y: by - radiusA * Math.sin(angleToBisect)
    };



    // Last two arcs from intersection points
    ctx.beginPath();
    ctx.arc(intersectAB.x, intersectAB.y, radiusB, 230 * deg2rad, -100 * deg2rad);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(intersectBC.x, intersectBC.y, radiusB, 160 * deg2rad, -170 * deg2rad);
    ctx.stroke();

    if (showFullCircle.checked)
    {
      // Last two arcs from intersection points
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.arc(intersectAB.x, intersectAB.y, radiusB, 0, 2 * Math.PI);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(intersectBC.x, intersectBC.y, radiusB, 0, 2 * Math.PI);
      ctx.stroke();
    }



    ctx.strokeStyle = 'black';
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

  cameraOffsetX = Math.min(Math.max(cameraOffsetX, centerX - MAX_PAN_DISTANCE), centerX + MAX_PAN_DISTANCE);
  cameraOffsetY = Math.min(Math.max(cameraOffsetY, centerY - MAX_PAN_DISTANCE), centerY + MAX_PAN_DISTANCE);
}

// Mouse drag for panning
let isDragging = false;
let lastX = 0;
let lastY = 0;

canvas.addEventListener('mousedown', (e) =>
{
  isDragging = true;
  lastX = e.clientX * 2;
  lastY = e.clientY * 2;
  logoElement.classList.add('noevents');
});

canvas.addEventListener('mousemove', (e) =>
{
  if (isDragging)
  {
    cameraOffsetX += e.clientX * 2 - lastX;
    cameraOffsetY += e.clientY * 2 - lastY;
    lastX = e.clientX * 2;
    lastY = e.clientY * 2;
    drawMain();
  }
});

const logoElement = document.getElementById('logoimg');
if (logoElement)
{
  logoElement.addEventListener('mouseover', () =>
  {
    logoElement.classList.add('hovering');
  });

  logoElement.addEventListener('mouseout', () =>
  {
    logoElement.classList.remove('hovering');
  });
}

canvas.addEventListener('mouseup', () => { isDragging = false; logoElement.classList.remove('noevents'); });
canvas.addEventListener('mouseleave', () => isDragging = false);

// Replace wheel event listener
canvas.addEventListener('wheel', (e) =>
{
  e.preventDefault();

  // Get mouse position relative to canvas
  const rect = canvas.getBoundingClientRect();
  const mouseX = (e.clientX * 2 - rect.left);
  const mouseY = (e.clientY * 2 - rect.top);

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

  drawMain();

  // Continue animation
  function animate()
  {
    if (Math.abs(cameraZoom - targetZoom) > 0.01)
    {
      cameraZoom = lerp(cameraZoom, targetZoom, 0.1);
      cameraOffsetX = mouseX - worldX * cameraZoom;
      cameraOffsetY = mouseY - worldY * cameraZoom;
      drawMain();
      requestAnimationFrame(animate);
    }
  }
  animate();
});



// Initial draw
centerCamera();
drawMain();