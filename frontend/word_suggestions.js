// ============================================
// WORD SUGGESTIONS — Datamuse API
// For the deaf user spelling letter by letter
// ============================================

let currentWord = '';       // letters confirmed so far in current word
let fullSentence = '';      // full sentence built so far

// Called from sign_detection.js every time a letter is confirmed
function onLetterConfirmed(letter) {
  currentWord += letter;
  updateWordDisplay();
  fetchSuggestions(currentWord);
}

// Called when user taps a suggestion button
function confirmWord(word) {
  fullSentence += (fullSentence ? ' ' : '') + word;
  currentWord = '';

  // Update the sentence display
  updateSentenceDisplay();

  // Clear suggestion buttons
  renderSuggestions([]);

  // Broadcast the chosen word to be spoken on other side
  sendMessage({
    type: 'sign-word-confirmed',
    broadcast: true,
    word: word
  });

  console.log('Word confirmed:', word, '| Sentence so far:', fullSentence);
}

// Called when user wants to send the full sentence (e.g. taps Send button)
function sendFullSentence() {
  if (!fullSentence.trim()) return;

  sendMessage({
    type: 'sign-sentence',
    broadcast: true,
    sentence: fullSentence
  });

  // Clear everything
  fullSentence = '';
  currentWord = '';
  updateWordDisplay();
  updateSentenceDisplay();
  renderSuggestions([]);
}

// Called when user wants to delete the last letter
function deleteLastLetter() {
  if (currentWord.length > 0) {
    currentWord = currentWord.slice(0, -1);
    updateWordDisplay();
    if (currentWord.length > 0) {
      fetchSuggestions(currentWord);
    } else {
      renderSuggestions([]);
    }
  } else if (fullSentence.length > 0) {
    // Delete last word from sentence
    const words = fullSentence.trim().split(' ');
    words.pop();
    fullSentence = words.join(' ');
    updateSentenceDisplay();
  }
}

// Fetch suggestions from Datamuse (free, no API key)
async function fetchSuggestions(partial) {
  if (!partial || partial.length < 1) {
    renderSuggestions([]);
    return;
  }
  try {
    const res = await fetch(`https://api.datamuse.com/words?sp=${partial.toLowerCase()}*&max=4`);
    const words = await res.json();
    const suggestions = words.map(w => w.word.toUpperCase());
    renderSuggestions(suggestions);
  } catch (err) {
    console.log('Suggestion fetch failed:', err);
    renderSuggestions([]);
  }
}

// ============================================
// UI Rendering
// ============================================

function ensureSignUI() {
  if (document.getElementById('sign-ui')) return;

  const ui = document.createElement('div');
  ui.id = 'sign-ui';
  ui.style.cssText = `
    position: fixed;
    bottom: 130px;
    left: 20px;
    width: 420px;
    background: rgba(0,0,0,0.88);
    border: 2px solid #00d4ff;
    border-radius: 14px;
    padding: 14px 16px;
    z-index: 999;
    font-family: sans-serif;
  `;

  ui.innerHTML = `
    <div style="color:#aaa; font-size:0.75rem; margin-bottom:4px; letter-spacing:1px;">SENTENCE</div>
    <div id="sign-sentence" style="
      color: #fff;
      font-size: 1.1rem;
      font-weight: bold;
      min-height: 28px;
      margin-bottom: 10px;
      word-break: break-word;
    ">—</div>

    <div style="color:#aaa; font-size:0.75rem; margin-bottom:4px; letter-spacing:1px;">SPELLING</div>
    <div id="sign-current-word" style="
      color: #FFD700;
      font-size: 1.5rem;
      font-weight: bold;
      min-height: 36px;
      letter-spacing: 4px;
      margin-bottom: 10px;
    ">—</div>

    <div style="color:#aaa; font-size:0.75rem; margin-bottom:6px; letter-spacing:1px;">SUGGESTIONS</div>
    <div id="sign-suggestions" style="
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      min-height: 40px;
      margin-bottom: 12px;
    "></div>

    <div style="display:flex; gap:8px;">
      <button onclick="deleteLastLetter()" style="
        flex:1;
        background: #333;
        color: #fff;
        border: 1px solid #555;
        border-radius: 8px;
        padding: 8px;
        cursor: pointer;
        font-size: 0.9rem;
      ">⌫ Delete</button>

      <button onclick="sendFullSentence()" style="
        flex:2;
        background: #00d4ff;
        color: #000;
        border: none;
        border-radius: 8px;
        padding: 8px;
        cursor: pointer;
        font-size: 0.9rem;
        font-weight: bold;
      ">📤 Send Sentence</button>
    </div>
  `;

  document.body.appendChild(ui);
}

function updateWordDisplay() {
  ensureSignUI();
  const el = document.getElementById('sign-current-word');
  if (el) el.innerText = currentWord || '—';
}

function updateSentenceDisplay() {
  ensureSignUI();
  const el = document.getElementById('sign-sentence');
  if (el) el.innerText = fullSentence || '—';
}

function renderSuggestions(words) {
  ensureSignUI();
  const container = document.getElementById('sign-suggestions');
  if (!container) return;
  container.innerHTML = '';

  words.forEach(word => {
    const btn = document.createElement('button');
    btn.innerText = word;
    btn.style.cssText = `
      background: #1a1a2e;
      color: #00d4ff;
      border: 1px solid #00d4ff;
      border-radius: 8px;
      padding: 6px 14px;
      cursor: pointer;
      font-size: 0.95rem;
      font-weight: bold;
      transition: background 0.15s;
    `;
    btn.onmouseover = () => btn.style.background = '#00d4ff22';
    btn.onmouseout  = () => btn.style.background = '#1a1a2e';
    btn.onclick = () => confirmWord(word);
    container.appendChild(btn);
  });
}