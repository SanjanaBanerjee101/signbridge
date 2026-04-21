// ============================================
// PART 1 — All the variables we need
// ============================================

let localStream;        // Your own camera + mic stream
let peers = {};         // Stores connections to other people { clientId: RTCPeerConnection }
let myName = '';        // Your name
let myId = '';          // Your unique ID in the room
let roomId = '';        // The room you joined
let socket;             // WebSocket connection to our Python server
let micOn = true;       // Mic state
let camOn = true;       // Camera state
let recognition;        // Speech recognition object
let signQueue = [];     // Queue of letters to animate
let isPlayingSign = false; // Whether a sign animation is currently playing

// ICE servers — these help WebRTC find the best path between two browsers
// STUN server is like asking "what is my public IP address?"
const iceServers = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ============================================
// PART 2 — Joining the room
// ============================================

async function joinRoom() {
  roomId = document.getElementById('room-input').value.trim();
  myName = document.getElementById('name-input').value.trim();

  if (!roomId || !myName) {
    alert('Please enter both a Room ID and your name!');
    return;
  }

  // Generate a unique ID for this user
  myId = myName + '_' + Math.random().toString(36).substr(2, 5);

  // Get camera and mic access
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  } catch (err) {
    alert('Could not access camera/mic. Please allow permissions.');
    return;
  }

  // Show meeting screen, hide join screen
  document.getElementById('join-screen').classList.add('hidden');
  document.getElementById('meeting-screen').classList.remove('hidden');

  // Add your own video box to the grid
  addVideoBox(myId, myName, localStream, true);

  // Connect to the signaling server
  connectToServer();

  // Start listening for speech
  const isDeafMode = document.getElementById('deaf-mode').checked;
    if (!isDeafMode) {
    startSpeechRecognition();
    }
}

// ============================================
// PART 3 — Connect to signaling server
// ============================================

function connectToServer() {
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHost = window.location.host;
  socket = new WebSocket(`${wsProtocol}//${wsHost}/ws/${roomId}/${myId}`);

  socket.onopen = () => {
    console.log('Connected to signaling server');
  };

  socket.onmessage = async (event) => {
    const message = JSON.parse(event.data);
    console.log('Message received:', message.type);

    if (message.type === 'room-info') {
      // Server told us who is already in the room
      // We initiate connection to each of them
      for (let clientId of message.clients) {
        await createPeerConnection(clientId, true);
      }
    }

    else if (message.type === 'user-joined') {
      // Someone new joined — they will initiate connection to us
      await createPeerConnection(message.clientId, false);
    }

    else if (message.type === 'offer') {
      // Someone wants to connect with us
      await handleOffer(message);
    }

    else if (message.type === 'answer') {
      // They accepted our connection request
      await handleAnswer(message);
    }

    else if (message.type === 'ice-candidate') {
      // Network path information — add it to the connection
      await handleIceCandidate(message);
    }

    else if (message.type === 'user-left') {
      // Someone left — remove their video box
      removeVideoBox(message.clientId);
    }

    else if (message.type === 'sign-letters') {
      // Someone else is speaking — show signs on THEIR box on our screen
      const senderId = message.from;
      const letters = message.letters;

      // Add to a per-sender queue
      if (!window.remoteSignQueues) window.remoteSignQueues = {};
      if (!window.remoteSignPlaying) window.remoteSignPlaying = {};

      if (!window.remoteSignQueues[senderId]) window.remoteSignQueues[senderId] = [];
      window.remoteSignQueues[senderId].push(...letters);

      if (!window.remoteSignPlaying[senderId]) {
        playRemoteSign(senderId);
      }
    }
  };
}

// ============================================
// PART 4 — Creating a peer connection
// ============================================

async function createPeerConnection(clientId, isCaller) {
  // Create a new WebRTC connection for this person
  const pc = new RTCPeerConnection(iceServers);
  peers[clientId] = pc;

  // Add our camera/mic stream to the connection
  localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

  // When we find a network path (ICE candidate), send it to the other person
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      sendMessage({
        type: 'ice-candidate',
        target: clientId,
        candidate: event.candidate
      });
    }
  };

  // When we receive the other person's video/audio stream
  pc.ontrack = (event) => {
    // Check if we already have a box for this person
    if (!document.getElementById(clientId)) {
      addVideoBox(clientId, clientId.split('_')[0], event.streams[0], false);
    }
  };

  // If we are the one initiating the call, send an offer
  if (isCaller) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sendMessage({
      type: 'offer',
      target: clientId,
      sdp: pc.localDescription
    });
  }

  return pc;
}

// ============================================
// PART 5 — Handling offer, answer, ICE
// ============================================

async function handleOffer(message) {
  const pc = await createPeerConnection(message.from, false);
  await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendMessage({
    type: 'answer',
    target: message.from,
    sdp: pc.localDescription
  });
}

async function handleAnswer(message) {
  const pc = peers[message.from];
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(message.sdp));
  }
}

async function handleIceCandidate(message) {
  const pc = peers[message.from];
  if (pc) {
    await pc.addIceCandidate(new RTCIceCandidate(message.candidate));
  }
}

// Helper to send messages through WebSocket
function sendMessage(message) {
  socket.send(JSON.stringify(message));
}

// ============================================
// PART 6 — Adding and removing video boxes
// ============================================

function addVideoBox(clientId, name, stream, isLocal) {
  const grid = document.getElementById('video-grid');

  // Create the container div
  const container = document.createElement('div');
  container.classList.add('video-container');
  container.id = clientId;

  // Create the video element
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  if (isLocal) video.muted = true; // mute yourself so you don't hear your own echo

  // Create the name label
  const nameLabel = document.createElement('div');
  nameLabel.classList.add('name-label');
  nameLabel.innerText = name;

  // Create the sign language overlay window
  const signOverlay = document.createElement('div');
  signOverlay.classList.add('sign-overlay');
  signOverlay.id = 'sign-' + clientId;

  const signVideo = document.createElement('video');
  signVideo.autoplay = true;
  signVideo.muted = true;
  signVideo.id = 'signvid-' + clientId;

  signOverlay.appendChild(signVideo);
  container.appendChild(video);
  container.appendChild(nameLabel);
  container.appendChild(signOverlay);
  grid.appendChild(container);
}

function removeVideoBox(clientId) {
  const box = document.getElementById(clientId);
  if (box) box.remove();
  if (peers[clientId]) {
    peers[clientId].close();
    delete peers[clientId];
  }
}

// ============================================
// PART 7 — Speech Recognition + Sign Animation
// ============================================

function startSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.log('Speech recognition not supported');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = false;  // Changed to false — more stable
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    console.log('Speech recognition started');
  };

  recognition.onresult = (event) => {
    const transcript = event.results[event.results.length - 1][0].transcript;
    console.log('Heard:', transcript);

    const letters = transcript.replace(/[^a-zA-Z]/g, '').toUpperCase().split('');

    // Show on your own screen
    signQueue.push(...letters);
    if (!isPlayingSign) {
      playNextSign(myId);
    }

    // Broadcast to everyone else
    sendMessage({
      type: 'sign-letters',
      broadcast: true,
      letters: letters,
      senderId: myId
    });
  };

  recognition.onerror = (e) => {
    console.log('Speech error:', e.error);
  };

  recognition.onend = () => {
    // Only restart if we are not in deaf mode
    const isDeafMode = document.getElementById('deaf-mode').checked;
    if (!isDeafMode) {
      // Wait a moment before restarting to avoid crash loop
      setTimeout(() => {
        try {
          recognition.start();
        } catch(err) {
          console.log('Restart error:', err);
        }
      }, 300);
    }
  };

  // Small delay before first start
  setTimeout(() => {
    try {
      recognition.start();
    } catch(err) {
      console.log('Start error:', err);
    }
  }, 500);
}

function playNextSign(clientId) {
  if (signQueue.length === 0) {
    isPlayingSign = false;
    document.getElementById('sign-' + clientId).style.display = 'none';
    return;
  }

  isPlayingSign = true;
  const letter = signQueue.shift();
  const signOverlay = document.getElementById('sign-' + clientId);

  // Show the overlay
  signOverlay.style.display = 'block';

  // Clear previous content
  signOverlay.innerHTML = '';

  // Check if MP4 exists by trying to fetch it first
  fetch(`/animations/${letter}.mp4`, { method: 'HEAD' })
    .then(res => {
      if (res.ok) {
        // MP4 exists — play it
        const vid = document.createElement('video');
        vid.autoplay = true;
        vid.muted = true;
        vid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        vid.src = `/animations/${letter}.mp4`;
        vid.onended = () => playNextSign(clientId);
        vid.onerror = () => setTimeout(() => playNextSign(clientId), 800);
        signOverlay.appendChild(vid);
        vid.play();
      } else {
        // No MP4 — check for PNG
        fetch(`/animations/${letter}.png`, { method: 'HEAD' })
          .then(res2 => {
            if (res2.ok) {
              const img = document.createElement('img');
              img.src = `/animations/${letter}.png`;
              img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
              signOverlay.appendChild(img);
              setTimeout(() => playNextSign(clientId), 800);
            } else {
              // Try JPG
              fetch(`/animations/${letter}.jpg`, { method: 'HEAD' })
                .then(res3 => {
                  if (res3.ok) {
                    const img = document.createElement('img');
                    img.src = `/animations/${letter}.jpg`;
                    img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
                    signOverlay.appendChild(img);
                    setTimeout(() => playNextSign(clientId), 800);
                  } else {
                    showLetterFallback(signOverlay, letter, clientId);
                  }
                });
            }
          });
      }
    })
    .catch(() => {
      // Fetch failed — show big blue letter
      showLetterFallback(signOverlay, letter, clientId);
    });
}

function showLetterFallback(signOverlay, letter, clientId, isRemote = false) {
  signOverlay.innerHTML = `
    <div style="
      width:100%;
      height:100%;
      display:flex;
      align-items:center;
      justify-content:center;
      font-size:3rem;
      font-weight:bold;
      color:#00d4ff;
      background:#000;
    ">${letter}</div>
  `;
  setTimeout(() => isRemote ? playRemoteSign(clientId) : playNextSign(clientId), 800);
}

function playRemoteSign(senderId) {
  if (!window.remoteSignQueues[senderId] || window.remoteSignQueues[senderId].length === 0) {
    window.remoteSignPlaying[senderId] = false;
    const overlay = document.getElementById('sign-' + senderId);
    if (overlay) overlay.style.display = 'none';
    return;
  }

  window.remoteSignPlaying[senderId] = true;
  const letter = window.remoteSignQueues[senderId].shift();
  const signOverlay = document.getElementById('sign-' + senderId);

  if (!signOverlay) {
    // Box not found, skip
    setTimeout(() => playRemoteSign(senderId), 100);
    return;
  }

  signOverlay.style.display = 'block';
  signOverlay.innerHTML = '';

  fetch(`/animations/${letter}.mp4`, { method: 'HEAD' })
    .then(res => {
      if (res.ok) {
        const vid = document.createElement('video');
        vid.autoplay = true;
        vid.muted = true;
        vid.style.cssText = 'width:100%;height:100%;object-fit:cover;';
        vid.src = `/animations/${letter}.mp4`;
        vid.onended = () => playRemoteSign(senderId);
        vid.onerror = () => setTimeout(() => playRemoteSign(senderId), 800);
        signOverlay.appendChild(vid);
        vid.play();
      } else {
        fetch(`/animations/${letter}.png`, { method: 'HEAD' })
                .then(res2 => {
                  if (res2.ok) {
                    const img = document.createElement('img');
                    img.src = `/animations/${letter}.png`;
                    img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
                    signOverlay.appendChild(img);
                    setTimeout(() => playRemoteSign(senderId), 800);
                  } else {
                    // Try JPG
                    fetch(`/animations/${letter}.jpg`, { method: 'HEAD' })
                      .then(res3 => {
                        if (res3.ok) {
                          const img = document.createElement('img');
                          img.src = `/animations/${letter}.jpg`;
                          img.style.cssText = 'width:100%;height:100%;object-fit:contain;';
                          signOverlay.appendChild(img);
                          setTimeout(() => playRemoteSign(senderId), 800);
                        } else {
                          showLetterFallback(signOverlay, letter, senderId, true);
                        }
                      });
                  }
                });
      }
    })
    .catch(() => showLetterFallback(signOverlay, letter, senderId, true));
}

// ============================================
// PART 8 — Controls
// ============================================

function toggleMic() {
  micOn = !micOn;
  localStream.getAudioTracks()[0].enabled = micOn;
  document.getElementById('mic-btn').innerText = micOn ? '🎤 Mic ON' : '🎤 Mic OFF';
}

function toggleCam() {
  camOn = !camOn;
  localStream.getVideoTracks()[0].enabled = camOn;
  document.getElementById('cam-btn').innerText = camOn ? '📷 Cam ON' : '📷 Cam OFF';
}
function leaveRoom() {
  // Close all connections
  Object.values(peers).forEach(pc => pc.close());
  peers = {};

  // Stop camera and mic
  localStream.getTracks().forEach(track => track.stop());

  // Stop speech recognition
  if (recognition) recognition.stop();

  // Go back to join screen
  document.getElementById('meeting-screen').classList.add('hidden');
  document.getElementById('join-screen').classList.remove('hidden');
  document.getElementById('video-grid').innerHTML = '';
}