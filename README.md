SignBridge — Real-Time Sign Language Integration in Video Conferencing
----------------------------------------------------------------------

A proof-of-concept prototype that embeds bidirectional sign language communication directly inside a browser-based video conferencing session — a feature absent in all major platforms (Zoom, Google Meet, Microsoft Teams).

Live Demo: https://signbridge-434h.onrender.com

What is SignBridge?
-------------------
SignBridge bridges the communication gap between deaf/hard-of-hearing individuals and hearing participants during video calls — without any specialised hardware or third-party interpreters.

It works in two directions simultaneously:
Direction	How it works
 Deaf → Hearing	Deaf user signs ASL letters → detected by webcam → CNN classifies → assembled into words → spoken aloud via TTS
 Hearing → Deaf	Hearing user speaks → browser transcribes speech → displayed as sequential ASL letter images on deaf user's screen
 Demo
  Open the live link, create a room, share the room code with another device, and join. One user signs — the other hears. One user speaks — the other sees ASL letter guidance.

System Architecture :
--------------------
┌─────────────────────────────────────────────────────────────┐
│                        SIGNBRIDGE                           │
│                                                             │
│  ┌─────────────┐    WebRTC (P2P)    ┌─────────────────┐   │
│  │ Deaf User   │◄──────────────────►│  Hearing User   │   │
│  │             │                    │                 │   │
│  │ Webcam      │   Data Channel     │ Microphone      │   │
│  │ → cvzone    │◄──────────────────►│ → Web Speech API│   │
│  │ → CNN Model │                    │ → ASL Images    │   │
│  │ → TTS Output│                    │                 │   │
│  └─────────────┘                    └─────────────────┘   │
│                                                             │
│              FastAPI + WebSocket (Signaling Only)           │
└─────────────────────────────────────────────────────────────┘


Tech Stack :
-------------
Layer	Technology :

•Video Conferencing -	WebRTC (peer-to-peer)
•Signaling Server	- FastAPI + WebSockets (Python)
•Frontend -	HTML, CSS, JavaScript (no framework)
•Deployment -	Render (HTTPS)
•Hand Detection -	cvzone + MediaPipe Hands
•Gesture Classification -	Keras CNN — TensorFlow backend
•Word Suggestions -	pyenchant (en-US dictionary)
•Text-to-Speech	- pyttsx3 (offline)
•Speech-to-Text	- Web Speech API (browser-native)
•Image Processing	- OpenCV (cv2)


How Sign Recognition Works :
----------------------------

The CNN does not directly classify all 26 letters. Instead, a two-stage approach is used:

Stage 1 — CNN classifies the hand skeleton into one of 8 groups of visually similar letters
Stage 2 — Geometric rules use landmark distances/positions to pick the exact letter within the group
This hybrid approach is significantly more accurate than a single 26-class classifier.

The 8 Groups:

Group	Letters
0	A, E, M, N, S, T
1	B, D, F, I, K, R, U, V, W
2	C, O
3	G, H
4	L
5	P, Q, Z
6	X
7	Y, J
The hand skeleton (400×400px) is drawn using 21 MediaPipe landmarks and passed as input to the CNN — making recognition skin-colour and lighting independent.

Getting Started : 

Prerequisites
•Python 3.9+
•Google Chrome or Microsoft Edge (for Web Speech API)
•Webcam

1. Clone the repository :
git clone https://github.com/your-username/signbridge.git
cd signbridge

2. Install dependencies:
pip install -r requirements.txt

3. Run the signaling server:
uvicorn main:app --host 0.0.0.0 --port 8000

4. Open the app:
Go to http://localhost:8000 in your browser.

5. Run the sign detection module (on the deaf user's device):
python sign_detection.py

Note: The sign detection module requires a webcam and runs as a desktop application alongside the browser-based video call.

Project Structure :
-------------------
signbridge/
│
├── main.py                  # FastAPI server — WebSocket signaling
├── sign_detection.py        # ASL recognition module (cvzone + CNN)
├── cnn8grps_rad1_model.h5   # Trained CNN model
├── white.jpg                # Blank canvas for skeleton rendering
│
├── static/
│   ├── index.html           # Video conferencing frontend
│   ├── style.css
│   ├── app.js               # WebRTC + signaling logic
│   └── asl_images/          # ASL alphabet images (A–Z)
│       ├── A.png
│       ├── B.png
│       └── ...
│
├── requirements.txt
├── render.yaml              # Render deployment config
└── README.md

Team :
-------

Academy of Technology, Hooghly — B.Tech CSE (2024–25)

Name.               Contribution
Sanjana Banerjee		Sign language intelligence (CNN pipeline, word builder, TTS, speech→sign display, final integration)
Samadrita Pan		    Video conferencing platform (WebRTC, FastAPI signaling, frontend, deployment)
Anushree Ghosh	    Video conferencing platform (WebRTC, FastAPI signaling, frontend, deployment)
Disha Maiti		      Visual assets — ASL alphabet images (A–Z) and animated sign representations

Guide: Mr. Suman Bhattacharya, Assistant Professor, Dept. of CSBS, Academy of Technology

Known Limitations:
------------------
•Supports ASL fingerspelling only (letter-by-letter), not word-level signs
•Dynamic signs J and Z are approximated using static landmark positions
•Sign detection module currently requires Python installation on the user's device
•Optimised for one-to-one video calls only
•Works best under standard indoor lighting with a plain background
 
 Future Scope:
 --------------
 •Port CNN to TensorFlow.js — run sign detection entirely in the browser (no Python needed)
 •Add LSTM-based dynamic sign recognition for J, Z and motion-based signs
 •Extend to Indian Sign Language (ISL)
 •Support group/multi-party video calls
 •Mobile browser support
 •User studies with the deaf and hard-of-hearing community
