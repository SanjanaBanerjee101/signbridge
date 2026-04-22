// ============================================
// SIGN DETECTION — MediaPipe + TensorFlow.js
// ============================================

let signModel = null;
let signDetectionActive = false;
let lastDetectedLetter = '';
let detectionCanvas = null;
let detectionCtx = null;
let hands = null;
let camera = null;
let lastBroadcastTime = 0;

// The 8 group to letter mapping rules (from original Python code)
// We'll use landmark positions to determine exact letter within each group

async function loadSignModel() {
  try {
    signModel = await tf.loadLayersModel('/tfjs_model/model.json');
    console.log('Sign model loaded!');
    console.log('Input shape:', signModel.inputs[0].shape);
  } catch (err) {
    console.log('Error loading sign model:', err);
  }
}

function initSignDetection(videoElement, clientId) {
  // Create offscreen canvas for skeleton drawing
  detectionCanvas = document.createElement('canvas');
  detectionCanvas.width = 400;
  detectionCanvas.height = 400;
  detectionCtx = detectionCanvas.getContext('2d');

  // Initialize MediaPipe Hands
  hands = new Hands({
    locateFile: (file) => {
      return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
  });

  hands.setOptions({
    maxNumHands: 1,
    modelComplexity: 1,
    minDetectionConfidence: 0.7,
    minTrackingConfidence: 0.5
  });

  hands.onResults((results) => {
    onHandResults(results, clientId);
  });

  // Start camera processing
  camera = new Camera(videoElement, {
    onFrame: async () => {
      if (signDetectionActive) {
        await hands.send({ image: videoElement });
      }
    },
    width: 640,
    height: 480
  });

  camera.start();
  console.log('Sign detection initialized!');
}

function onHandResults(results, clientId) {
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    return;
  }

  const landmarks = results.multiHandLandmarks[0];
  const pts = landmarks.map(lm => ({
    x: lm.x * 400,
    y: lm.y * 400
  }));

  // Draw skeleton on white canvas (same as Python code)
  drawSkeleton(pts);

  // Predict from skeleton
  predictSign(pts, clientId);
}

function drawSkeleton(pts) {
  // White background
  detectionCtx.fillStyle = 'white';
  detectionCtx.fillRect(0, 0, 400, 400);

  // Draw connections (same as Python code)
  detectionCtx.strokeStyle = 'rgb(0, 255, 0)';
  detectionCtx.lineWidth = 3;

  const connections = [
    [0,1],[1,2],[2,3],[3,4],       // thumb
    [5,6],[6,7],[7,8],              // index
    [9,10],[10,11],[11,12],         // middle
    [13,14],[14,15],[15,16],        // ring
    [17,18],[18,19],[19,20],        // pinky
    [5,9],[9,13],[13,17],           // palm
    [0,5],[0,17]                    // wrist
  ];

  for (const [a, b] of connections) {
    detectionCtx.beginPath();
    detectionCtx.moveTo(pts[a].x, pts[a].y);
    detectionCtx.lineTo(pts[b].x, pts[b].y);
    detectionCtx.stroke();
  }

  // Draw landmark points
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

async function predictSign(pts, clientId) {
  if (!signModel) return;

  // Get image data from canvas
  const imageData = detectionCtx.getImageData(0, 0, 400, 400);

  // Convert to tensor
  const tensor = tf.tidy(() => {
    return tf.browser.fromPixels(detectionCanvas)
      .resizeBilinear([400, 400])
      .toFloat()
      .div(255.0)
      .expandDims(0);
  });

  // Get prediction
  const prediction = await signModel.predict(tensor).data();
  tensor.dispose();

  // Get top 2 predictions (ch1, ch2)
  const prob = Array.from(prediction);
  const ch1_idx = prob.indexOf(Math.max(...prob));
  prob[ch1_idx] = 0;
  const ch2_idx = prob.indexOf(Math.max(...prob));

  // Apply landmark rules to get exact letter
  const letter = getLetter(ch1_idx, ch2_idx, pts);

  if (letter && letter !== ' ' && letter !== lastDetectedLetter) {
    lastDetectedLetter = letter;
    console.log('Detected:', letter);

    // Throttle broadcasts to avoid spam
    const now = Date.now();
    if (now - lastBroadcastTime > 1500) {
      lastBroadcastTime = now;
      broadcastSignLetter(letter, clientId);
    }
  }
}

function getLetter(ch1, ch2, pts) {
  // Group 0 → A, E, M, N, S, T
  if (ch1 === 0) {
    if (pts[4].x < pts[6].x && pts[4].x < pts[10].x && pts[4].x < pts[14].x && pts[4].x < pts[18].x) return 'A';
    if (pts[4].y > pts[8].y && pts[4].y > pts[12].y && pts[4].y > pts[16].y && pts[4].y > pts[20].y) return 'E';
    if (pts[4].x > pts[6].x && pts[4].x > pts[10].x && pts[4].x > pts[14].x) return 'M';
    if (pts[4].x > pts[6].x && pts[4].x > pts[10].x) return 'N';
    if (pts[4].x > pts[6].x && pts[4].x < pts[10].x && pts[4].y < pts[14].y) return 'T';
    return 'S';
  }

  // Group 1 → B, D, F, I, K, R, U, V, W
  if (ch1 === 1) {
    if (pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y > pts[16].y && pts[18].y > pts[20].y) return 'B';
    if (pts[6].y > pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y) return 'D';
    if (pts[6].y < pts[8].y && pts[10].y > pts[12].y && pts[14].y > pts[16].y && pts[18].y > pts[20].y) return 'F';
    if (pts[6].y < pts[8].y && pts[10].y < pts[12].y && pts[14].y < pts[16].y && pts[18].y > pts[20].y) return 'I';
    if (pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y > pts[16].y && pts[18].y < pts[20].y) return 'W';
    if (pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y && pts[4].y < pts[9].y) return 'K';
    if (pts[8].x > pts[12].x && pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y) return 'R';
    if ((dist(pts[8], pts[12]) - dist(pts[6], pts[10])) < 8 && pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y) return 'U';
    if ((dist(pts[8], pts[12]) - dist(pts[6], pts[10])) >= 8 && pts[6].y > pts[8].y && pts[10].y > pts[12].y && pts[14].y < pts[16].y && pts[18].y < pts[20].y) return 'V';
    return 'B';
  }

  // Group 2 → C, O
  if (ch1 === 2) {
    if (dist(pts[12], pts[4]) > 42) return 'C';
    return 'O';
  }

  // Group 3 → G, H
  if (ch1 === 3) {
    if (dist(pts[8], pts[12]) > 72) return 'G';
    return 'H';
  }

  // Group 4 → L
  if (ch1 === 4) return 'L';

  // Group 5 → P, Q, Z
  if (ch1 === 5) {
    if (pts[4].x > pts[12].x && pts[4].x > pts[16].x && pts[4].x > pts[20].x) {
      if (pts[8].y < pts[5].y) return 'Z';
      return 'Q';
    }
    return 'P';
  }

  // Group 6 → X
  if (ch1 === 6) return 'X';

  // Group 7 → Y, J
  if (ch1 === 7) {
    if (dist(pts[8], pts[4]) > 42) return 'Y';
    return 'J';
  }

  return '';
}

function broadcastSignLetter(letter, clientId) {
  // Send detected letter to all other participants
  sendMessage({
    type: 'sign-letter-detected',
    broadcast: true,
    letter: letter,
    senderId: clientId
  });

  // Also show text locally for the deaf person to see what was detected
  showDetectedLetter(letter);
}

function showDetectedLetter(letter) {
  let indicator = document.getElementById('sign-indicator');
  if (!indicator) {
    indicator = document.createElement('div');
    indicator.id = 'sign-indicator';
    indicator.style.cssText = `
      position: fixed;
      bottom: 80px;
      left: 20px;
      background: rgba(0,0,0,0.8);
      color: #00d4ff;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 1.5rem;
      font-weight: bold;
      border: 2px solid #00d4ff;
      z-index: 1000;
    `;
    document.body.appendChild(indicator);
  }
  indicator.innerText = `Signing: ${letter}`;
  setTimeout(() => { indicator.innerText = ''; }, 1500);
}