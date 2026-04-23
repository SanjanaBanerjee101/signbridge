// ============================================
// SIGN DETECTION — MediaPipe + TensorFlow.js
// Matches original Python training pipeline exactly
// ============================================

let signModel = null;
let signDetectionActive = false;
let detectionCanvas = null;
let detectionCtx = null;
let hands = null;

// ---- Lock + Confirm flow ----
// Step 1: Hold a sign  → letter gets LOCKED (shown on screen, not sent yet)
// Step 2: Show open palm → CONFIRMS the locked letter → broadcasts it
// Step 3: Lower hand / new sign → ready for next letter

let letterBuffer = [];
const BUFFER_SIZE = 15;
const LOCK_THRESHOLD = 10;    // frames that must agree to lock

let lockedLetter = '';        // currently locked, waiting for palm
let palmBuffer = [];
const PALM_BUFFER_SIZE = 10;
const PALM_THRESHOLD = 7;     // steady palm frames needed to confirm
let waitingForPalm = false;

async function loadSignModel() {
  try {
    signModel = await tf.loadLayersModel('/tfjs_model/model.json');
    console.log('Sign model loaded!');
    console.log('Input shape:', signModel.inputs[0].shape);
  } catch (err) {
    console.error('Error loading sign model:', err);
  }
}

function initSignDetection(videoElement, clientId) {
  // Offscreen 400x400 canvas — exactly like Python's white.jpg
  detectionCanvas = document.createElement('canvas');
  detectionCanvas.width = 400;
  detectionCanvas.height = 400;
  detectionCtx = detectionCanvas.getContext('2d', { willReadFrequently: true });

  hands = new Hands({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5
  });

  hands.onResults((results) => onHandResults(results, clientId));

  async function processFrame() {
    if (!signDetectionActive) { requestAnimationFrame(processFrame); return; }
    if (videoElement.readyState >= 2) {
      await hands.send({ image: videoElement });
    }
    requestAnimationFrame(processFrame);
  }

  signDetectionActive = true;
  processFrame();
  console.log('Sign detection initialized!');
}

function onHandResults(results, clientId) {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) return;

  const landmarks = results.multiHandLandmarks[0];

  // Step 1: Convert normalized MediaPipe landmarks to pixel coordinates
  // Use 640x480 as the reference frame size (matches typical webcam)
  const frameW = 640;
  const frameH = 480;

  let pts = landmarks.map(lm => ({
    x: lm.x * frameW,
    y: lm.y * frameH
  }));

  // Step 2: Get bounding box of the hand (same as Python's hand['bbox'])
  let minX = Math.min(...pts.map(p => p.x));
  let maxX = Math.max(...pts.map(p => p.x));
  let minY = Math.min(...pts.map(p => p.y));
  let maxY = Math.max(...pts.map(p => p.y));

  const w = maxX - minX;
  const h = maxY - minY;
  const offset = 15; // same as Python's offset variable

  // Step 3: Compute the centering offsets — exactly like Python:
  // os  = ((400 - w) // 2) - 15
  // os1 = ((400 - h) // 2) - 15
  const os  = Math.floor((400 - w) / 2) - offset;
  const os1 = Math.floor((400 - h) / 2) - offset;

  // Step 4: Shift all points using bounding box top-left + centering offset
  // In Python: pts[i][0] + os, pts[i][1] + os1
  // pts[i][0] is relative to the cropped image, so subtract minX first
  const drawPts = pts.map(p => ({
    x: (p.x - minX) + os,
    y: (p.y - minY) + os1
  }));

  // Step 5: Draw skeleton on white canvas — exactly like Python
  drawSkeleton(drawPts);

  // Step 6: Predict using the canvas image, pass ORIGINAL pts for landmark rules
  predictSign(pts, drawPts, clientId);
}

function drawSkeleton(pts) {
  // White background — same as Python's white.jpg
  detectionCtx.fillStyle = 'white';
  detectionCtx.fillRect(0, 0, 400, 400);

  // Green lines — same connections as Python
  detectionCtx.strokeStyle = 'rgb(0, 255, 0)';
  detectionCtx.lineWidth = 3;

  // Python draws these exact segments:
  const segments = [
    [0,1],[1,2],[2,3],[3,4],     // thumb
    [5,6],[6,7],[7,8],           // index
    [9,10],[10,11],[11,12],      // middle
    [13,14],[14,15],[15,16],     // ring
    [17,18],[18,19],[19,20],     // pinky
    [5,9],[9,13],[13,17],        // palm knuckles
    [0,5],[0,17]                 // wrist to edge knuckles
  ];

  for (const [a, b] of segments) {
    detectionCtx.beginPath();
    detectionCtx.moveTo(pts[a].x, pts[a].y);
    detectionCtx.lineTo(pts[b].x, pts[b].y);
    detectionCtx.stroke();
  }

  // Red dots — same as Python's cv2.circle with radius 2
  detectionCtx.fillStyle = 'rgb(255, 0, 0)';
  for (const pt of pts) {
    detectionCtx.beginPath();
    detectionCtx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
    detectionCtx.fill();
  }
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

// ============================================
// Open palm detection
// All 5 fingertips above their knuckles = open palm
// ============================================
function isOpenPalm(pts) {
  // fingertip indices: 4,8,12,16,20
  // knuckle indices:   3,6,10,14,18
  // "above" in image = smaller y value
  const thumb  = pts[4].y  < pts[3].y;
  const index  = pts[8].y  < pts[6].y;
  const middle = pts[12].y < pts[10].y;
  const ring   = pts[16].y < pts[14].y;
  const pinky  = pts[20].y < pts[18].y;
  return thumb && index && middle && ring && pinky;
}

// ============================================
// predictSign — Lock + Confirm flow
// ============================================
async function predictSign(originalPts, drawPts, clientId) {
  if (!signModel) return;

  // --- Check for open palm first (confirm gesture) ---
  const palmDetected = isOpenPalm(originalPts);
  palmBuffer.push(palmDetected);
  if (palmBuffer.length > PALM_BUFFER_SIZE) palmBuffer.shift();
  const palmCount = palmBuffer.filter(Boolean).length;
  const steadyPalm = palmCount >= PALM_THRESHOLD;

  if (waitingForPalm && steadyPalm && lockedLetter) {
    // User showed open palm — confirm the locked letter
    console.log('🖐 Palm detected — confirming letter:', lockedLetter);
    broadcastSignLetter(lockedLetter, clientId);
    lockedLetter = '';
    waitingForPalm = false;
    letterBuffer = [];
    palmBuffer = [];
    showLockedLetter(''); // clear the lock indicator
    return;
  }

  // If palm is showing, don't try to detect a letter — wait for palm to drop
  if (steadyPalm) return;

  // --- Run model to get letter ---
  const tensor = tf.tidy(() => {
    return tf.browser.fromPixels(detectionCanvas)
      .toFloat()
      .div(255.0)
      .expandDims(0);
  });

  const prediction = await signModel.predict(tensor).data();
  tensor.dispose();

  const prob = Array.from(prediction);
  const ch1_idx = prob.indexOf(Math.max(...prob));
  prob[ch1_idx] = 0;
  const ch2_idx = prob.indexOf(Math.max(...prob));

  const letter = getLetter(ch1_idx, ch2_idx, originalPts);
  console.log('Top group (ch1):', ch1_idx, '| Letter:', letter);

  if (!letter) return;

  // --- Stability buffer: lock letter after enough consistent frames ---
  letterBuffer.push(letter);
  if (letterBuffer.length > BUFFER_SIZE) letterBuffer.shift();

  const matchCount = letterBuffer.filter(l => l === letter).length;

  if (matchCount >= LOCK_THRESHOLD && letter !== lockedLetter) {
    lockedLetter = letter;
    waitingForPalm = true;
    letterBuffer = [];
    console.log('🔒 Letter locked:', lockedLetter, '— show open palm to confirm');
    showLockedLetter(lockedLetter); // show on screen but don't send yet
  }
}

// ============================================
// getLetter — Ported from Python's predict()
// Uses original pixel-space landmark coords
// ============================================
function getLetter(ch1, ch2, pts) {
  let pl = [ch1, ch2];

  // ---- Inter-group disambiguation rules (same order as Python) ----

  // [Aemnst] condition
  const l0 = [[5,2],[5,3],[3,5],[3,6],[3,0],[3,2],[6,4],[6,1],[6,2],[6,6],[6,7],[6,0],[6,5],
               [4,1],[1,0],[1,1],[6,3],[1,6],[5,6],[5,1],[4,5],[1,4],[1,5],[2,0],[2,6],[4,6],
               [1,0],[5,7],[1,6],[6,1],[7,6],[2,5],[7,1],[5,4],[7,0],[7,5],[7,2]];
  if (inList(pl, l0)) {
    if (pts[6].y < pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y)
      ch1 = 0;
  }

  // [o][s]
  if (inList(pl, [[2,2],[2,1]])) {
    if (pts[5].x < pts[4].x) ch1 = 0;
  }

  pl = [ch1, ch2];

  // [c0][aemnst]
  if (inList(pl, [[0,0],[0,6],[0,2],[0,5],[0,1],[0,7],[5,2],[7,6],[7,1]])) {
    if (pts[0].x > pts[8].x && pts[0].x > pts[4].x && pts[0].x > pts[12].x &&
        pts[0].x > pts[16].x && pts[0].x > pts[20].x && pts[5].x > pts[4].x)
      ch1 = 2;
  }

  // [c0][aemnst] distance check
  if (inList(pl, [[6,0],[6,6],[6,2]])) {
    if (dist(pts[8], pts[16]) < 52) ch1 = 2;
  }

  // [gh][bdfikruvw]
  if (inList(pl, [[1,4],[1,5],[1,6],[1,3],[1,0]])) {
    if (pts[6].y > pts[8].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y &&
        pts[0].x < pts[8].x && pts[0].x < pts[12].x && pts[0].x < pts[16].x && pts[0].x < pts[20].x)
      ch1 = 3;
  }

  // [gh][l]
  if (inList(pl, [[4,6],[4,1],[4,5],[4,3],[4,7]])) {
    if (pts[4].x > pts[0].x) ch1 = 3;
  }

  // [gh][pqz]
  if (inList(pl, [[5,3],[5,0],[5,7],[5,4],[5,2],[5,1],[5,5]])) {
    if (pts[2].y + 15 < pts[16].y) ch1 = 3;
  }

  // [l][x]
  if (inList(pl, [[6,4],[6,1],[6,2]])) {
    if (dist(pts[4], pts[11]) > 55) ch1 = 4;
  }

  // [l][d]
  if (inList(pl, [[1,4],[1,6],[1,1]])) {
    if (dist(pts[4], pts[11]) > 50 &&
        pts[6].y > pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y)
      ch1 = 4;
  }

  // [l][gh]
  if (inList(pl, [[3,6],[3,4]])) {
    if (pts[4].x < pts[0].x) ch1 = 4;
  }

  // [l][c0]
  if (inList(pl, [[2,2],[2,5],[2,4]])) {
    if (pts[1].x < pts[12].x) ch1 = 4;
  }

  // [gh][z]
  if (inList(pl, [[3,6],[3,5],[3,4]])) {
    if (pts[6].y > pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y &&
        pts[4].y > pts[10].y)
      ch1 = 5;
  }

  // [gh][pq]
  if (inList(pl, [[3,2],[3,1],[3,6]])) {
    if (pts[4].y + 17 > pts[8].y && pts[4].y + 17 > pts[12].y &&
        pts[4].y + 17 > pts[16].y && pts[4].y + 17 > pts[20].y)
      ch1 = 5;
  }

  // [l][pqz]
  if (inList(pl, [[4,4],[4,5],[4,2],[7,5],[7,6],[7,0]])) {
    if (pts[4].x > pts[0].x) ch1 = 5;
  }

  // [pqz][aemnst]
  if (inList(pl, [[0,2],[0,6],[0,1],[0,5],[0,0],[0,7],[0,4],[0,3],[2,7]])) {
    if (pts[0].x < pts[8].x && pts[0].x < pts[12].x && pts[0].x < pts[16].x && pts[0].x < pts[20].x)
      ch1 = 5;
  }

  // [pqz][yj]
  if (inList(pl, [[5,7],[5,2],[5,6]])) {
    if (pts[3].x < pts[0].x) ch1 = 7;
  }

  // [l][yj]
  if (inList(pl, [[4,6],[4,2],[4,4],[4,1],[4,5],[4,7]])) {
    if (pts[6].y < pts[8].y) ch1 = 7;
  }

  // [x][yj]
  if (inList(pl, [[6,7],[0,7],[0,1],[0,0],[6,4],[6,6],[6,5],[6,1]])) {
    if (pts[18].y > pts[20].y) ch1 = 7;
  }

  // [x][aemnst]
  if (inList(pl, [[0,4],[0,2],[0,3],[0,1],[0,6]])) {
    if (pts[5].x > pts[16].x) ch1 = 6;
  }

  // [yj][x]
  if (inList(pl, [[7,2]])) {
    if (pts[18].y < pts[20].y && pts[8].y < pts[10].y) ch1 = 6;
  }

  // [c0][x]
  if (inList(pl, [[2,1],[2,2],[2,6],[2,7],[2,0]])) {
    if (dist(pts[8], pts[16]) > 50) ch1 = 6;
  }

  // [l][x] distance
  if (inList(pl, [[4,6],[4,2],[4,1],[4,4]])) {
    if (dist(pts[4], pts[11]) < 60) ch1 = 6;
  }

  // [x][d]
  if (inList(pl, [[1,4],[1,6],[1,0],[1,2]])) {
    if (pts[5].x - pts[4].x - 15 > 0) ch1 = 6;
  }

  // [b][pqz] and similar
  const lB = [[5,0],[5,1],[5,4],[5,5],[5,6],[6,1],[7,6],[0,2],[7,1],[7,4],[6,6],[7,2],[5,0],
               [6,3],[6,4],[7,5],[7,2]];
  if (inList(pl, lB)) {
    if (pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y > pts[16].y && pts[18].y > pts[20].y)
      ch1 = 1;
  }

  // [f][pqz] and similar
  const lF = [[6,1],[6,0],[0,3],[6,4],[2,2],[0,6],[6,2],[7,6],[4,6],[4,1],[4,2],[0,2],[7,1],
               [7,4],[6,6],[7,2],[7,5],[7,2]];
  if (inList(pl, lF)) {
    if (pts[6].y < pts[8].y && pts[10].y > pts[12].y && pts[14].y > pts[16].y && pts[18].y > pts[20].y)
      ch1 = 1;
  }

  if (inList(pl, [[6,1],[6,0],[4,2],[4,1],[4,6],[4,4]])) {
    if (pts[10].y > pts[12].y && pts[14].y > pts[16].y && pts[18].y > pts[20].y)
      ch1 = 1;
  }

  // [d][pqz]
  if (inList(pl, [[5,0],[3,4],[3,0],[3,1],[3,5],[5,5],[5,4],[5,1],[7,6]])) {
    if (pts[6].y > pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y &&
        pts[2].x < pts[0].x && pts[4].y > pts[14].y)
      ch1 = 1;
  }

  if (inList(pl, [[4,1],[4,2],[4,4]])) {
    if (dist(pts[4], pts[11]) < 50 &&
        pts[6].y > pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y)
      ch1 = 1;
  }

  if (inList(pl, [[3,4],[3,0],[3,1],[3,5],[3,6]])) {
    if (pts[6].y > pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y &&
        pts[2].x < pts[0].x && pts[14].y < pts[4].y)
      ch1 = 1;
  }

  if (inList(pl, [[6,6],[6,4],[6,1],[6,2]])) {
    if (pts[5].x - pts[4].x - 15 < 0) ch1 = 1;
  }

  // [i][pqz]
  const lI = [[5,4],[5,5],[5,1],[0,3],[0,7],[5,0],[0,2],[6,2],[7,5],[7,1],[7,6],[7,7]];
  if (inList(pl, lI)) {
    if (pts[6].y < pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y > pts[20].y)
      ch1 = 1;
  }

  // [yj][bfdi]
  if (inList(pl, [[1,5],[1,7],[1,1],[1,6],[1,3],[1,0]])) {
    if (pts[4].x < pts[5].x + 15 &&
        pts[6].y < pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y > pts[20].y)
      ch1 = 7;
  }

  // [uvr]
  const lUVR = [[5,5],[5,0],[5,4],[5,1],[4,6],[4,1],[7,6],[3,0],[3,5]];
  if (inList(pl, lUVR)) {
    if (pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y &&
        pts[4].y > pts[14].y)
      ch1 = 1;
  }

  // [w]
  const fg = 13;
  const lW = [[3,5],[3,0],[3,6],[5,1],[4,1],[2,0],[5,0],[5,5]];
  if (inList(pl, lW)) {
    if (!(pts[0].x + fg < pts[8].x && pts[0].x + fg < pts[12].x && pts[0].x + fg < pts[16].x && pts[0].x + fg < pts[20].x) &&
        !(pts[0].x > pts[8].x && pts[0].x > pts[12].x && pts[0].x > pts[16].x && pts[0].x > pts[20].x) &&
        dist(pts[4], pts[11]) < 50)
      ch1 = 1;
  }

  if (inList(pl, [[5,0],[5,5],[0,1]])) {
    if (pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y > pts[16].y)
      ch1 = 1;
  }

  // ---- Now map group index to exact letter ----

  if (ch1 === 0) {
    // Group 0: A, E, M, N, S, T
    let result = 'S';
    if (pts[4].x < pts[6].x && pts[4].x < pts[10].x && pts[4].x < pts[14].x && pts[4].x < pts[18].x)
      result = 'A';
    if (pts[4].x > pts[6].x && pts[4].x < pts[10].x && pts[4].x < pts[14].x && pts[4].x < pts[18].x &&
        pts[4].y < pts[14].y && pts[4].y < pts[18].y)
      result = 'T';
    if (pts[4].y > pts[8].y && pts[4].y > pts[12].y && pts[4].y > pts[16].y && pts[4].y > pts[20].y)
      result = 'E';
    if (pts[4].x > pts[6].x && pts[4].x > pts[10].x && pts[4].x > pts[14].x && pts[4].y < pts[18].y)
      result = 'M';
    if (pts[4].x > pts[6].x && pts[4].x > pts[10].x && pts[4].y < pts[18].y && pts[4].y < pts[14].y)
      result = 'N';
    return result;
  }

  if (ch1 === 2) return dist(pts[12], pts[4]) > 42 ? 'C' : 'O';

  if (ch1 === 3) return dist(pts[8], pts[12]) > 72 ? 'G' : 'H';

  if (ch1 === 7) return dist(pts[8], pts[4]) > 42 ? 'Y' : 'J';

  if (ch1 === 4) return 'L';

  if (ch1 === 6) return 'X';

  if (ch1 === 5) {
    if (pts[4].x > pts[12].x && pts[4].x > pts[16].x && pts[4].x > pts[20].x) {
      return pts[8].y < pts[5].y ? 'Z' : 'Q';
    }
    return 'P';
  }

  if (ch1 === 1) {
    // Group 1: B, D, F, I, K, R, U, V, W
    if (pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y > pts[16].y && pts[18].y > pts[20].y) return 'B';
    if (pts[6].y > pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y) return 'D';
    if (pts[6].y < pts[8].y && pts[10].y > pts[12].y && pts[14].y > pts[16].y && pts[18].y > pts[20].y) return 'F';
    if (pts[6].y < pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y > pts[20].y) return 'I';
    if (pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y > pts[16].y && pts[18].y < pts[20].y) return 'W';
    if (pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y && pts[4].y < pts[9].y) return 'K';
    if (pts[8].x > pts[12].x && pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y) return 'R';
    if ((dist(pts[8], pts[12]) - dist(pts[6], pts[10])) < 8 &&
        pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y) return 'U';
    if ((dist(pts[8], pts[12]) - dist(pts[6], pts[10])) >= 8 &&
        pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y &&
        pts[4].y > pts[9].y) return 'V';
    return 'B';
  }

  return '';
}

// Helper: check if array pl exists in list of arrays
function inList(pl, list) {
  return list.some(item => item[0] === pl[0] && item[1] === pl[1]);
}

// ============================================
// Broadcasting + UI
// ============================================

function broadcastSignLetter(letter, clientId) {
  sendMessage({
    type: 'sign-letter-detected',
    broadcast: true,
    letter: letter,
    senderId: clientId
  });
  showConfirmedLetter(letter);
}

// Shows the letter as LOCKED (yellow) — waiting for palm confirm
function showLockedLetter(letter) {
  let indicator = document.getElementById('sign-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'sign-indicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 20px;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 1.5rem;
      font-weight: bold;
      z-index: 1000;
    `;
    document.body.appendChild(indicator);
  }
  if (letter) {
    indicator.style.background = 'rgba(0,0,0,0.85)';
    indicator.style.color = '#FFD700';
    indicator.style.border = '2px solid #FFD700';
    indicator.innerText = `🔒 Locked: ${letter}  (show open palm to confirm)`;
  } else {
    indicator.innerText = '';
  }
}

// Shows the letter as CONFIRMED (cyan) — briefly after palm confirm
function showConfirmedLetter(letter) {
  let indicator = document.getElementById('sign-indicator');
  if (!indicator) return;
  indicator.style.background = 'rgba(0,0,0,0.85)';
  indicator.style.color = '#00d4ff';
  indicator.style.border = '2px solid #00d4ff';
  indicator.innerText = `✅ Sent: ${letter}`;
  setTimeout(() => { indicator.innerText = ''; }, 1000);
}