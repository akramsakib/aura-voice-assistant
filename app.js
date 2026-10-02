/* ============================================================
   AURA — Voice-Activated Personal Assistant
   Built-in skills engine + optional OpenAI/Gemini brain.
   All data stays in localStorage on the user's device.
   ============================================================ */
'use strict';

/* ---------------- utilities ---------------- */
const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('aura_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('aura_' + k, JSON.stringify(v)); } catch (e) {} },
  del(k) { localStorage.removeItem('aura_' + k); }
};
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fetchT = (url, opt = {}, ms = 9000) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...opt, signal: c.signal }).finally(() => clearTimeout(t));
};

/* ---------------- settings & profile ---------------- */
const settings = Object.assign({
  name: 'AURA', user: '', city: 'Pasir Gudang',
  voiceURI: '', rate: 1.0, pitch: 1.0,
  handsFree: false, muted: false,
  wakeRequired: false, wakeWord: 'aura',
  provider: 'free', apiKey: ''
}, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
let notes = store.get('notes', []);
let todoList = store.get('list', []);
let timers = [];                       // {id,label,endsAt}
let reminders = store.get('reminders', []); // {id,text,at}
let alarm = store.get('alarm', null);  // "HH:MM"
let lastSpoken = '';
let dictating = false;
let lastAlarmFired = store.get('alarmFired', '');

/* ---------------- speech synthesis ---------------- */
const synth = window.speechSynthesis || null;
let voices = [];
function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices();
  const sel = $('#setVoice');
  sel.innerHTML = voices.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === settings.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
}
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

let speechPausedMic = false; /* true while AURA is speaking — prevents her hearing herself */

function pauseMicForSpeech() {
  if (!supported || !micOn) return;
  speechPausedMic = true;
  try { rec.abort(); } catch (e) {}
  micOn = false; updateMicBtn();
}
function resumeMicAfterSpeech() {
  if (!speechPausedMic) return;
  speechPausedMic = false;
  if (wantMic && !micOn) {
    setTimeout(() => {
      try { rec.start(); micOn = true; setState('listening'); updateMicBtn(); blip(660, 0.07); } catch (e) {}
    }, 320);
  }
}

function speak(text, after) {
  const plain = String(text).replace(/[•*_#`>]/g, '').replace(/https?:\/\/\S+/g, 'link').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim();
  lastSpoken = plain;
  if (!synth || settings.muted || !plain) { if (after) after(); return; }
  synth.cancel();
  const u = new SpeechSynthesisUtterance(plain);
  const v = voices.find(x => x.voiceURI === settings.voiceURI) || voices.find(x => x.lang.startsWith('en') && /natural|neural|google/i.test(x.name)) || voices.find(x => x.lang.startsWith('en'));
  if (v) u.voice = v;
  u.rate = settings.rate; u.pitch = settings.pitch;
  u.onstart = () => { setState('speaking'); pauseMicForSpeech(); };
  u.onend = u.onerror = () => { setState(micOn ? 'listening' : 'idle'); resumeMicAfterSpeech(); if (after) after(); };
  synth.speak(u);
}
function stopSpeaking() { if (synth) synth.cancel(); speechPausedMic = false; setState(micOn ? 'listening' : 'idle'); }

/* ---------------- sound cues ---------------- */
let actx = null;
function blip(freq = 880, dur = 0.09) {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.14, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
    o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + dur);
  } catch (e) {}
}

/* ---------------- speech recognition ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, micOn = false, wantMic = false, supported = !!SR;
if (supported) {
  rec = new SR();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  rec.onresult = (e) => {
    let interim = '', final = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += t; else interim += t;
    }
    $('#interim').textContent = interim ? '“' + interim.trim() + '”' : '';
    if (final) { $('#interim').textContent = ''; handleTranscript(final.trim()); }
  };
  rec.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wantMic = false; micOn = false;
      addMsg('aura', `⚠️ Microphone is blocked. Click the 🔒 / 🎤 icon in your browser's address bar and allow the mic, then tap the mic again. (If you're inside an embedded preview, use the ↗ button to open AURA in its own tab.)`);
      setState('idle');
    }
  };
  rec.onend = () => {
    micOn = false; updateMicBtn();
    if (speechPausedMic) return; /* paused because AURA is speaking — resumeMicAfterSpeech handles it */
    if (wantMic) { setTimeout(() => { try { rec.start(); micOn = true; updateMicBtn(); setState('listening'); } catch (err) {} }, 280); }
    else setState('idle');
  };
}
function startMic(handsFree) {
  if (!supported) { addMsg('aura', `This browser doesn't support speech recognition. Use <b>Chrome or Edge</b> — or just type to me below, everything else works. 👇`); return; }
  wantMic = handsFree;
  rec.continuous = handsFree;
  try { rec.start(); micOn = true; blip(); setState('listening'); } catch (e) {}
  updateMicBtn();
}
function stopMic() {
  wantMic = false;
  try { rec.stop(); } catch (e) {}
  micOn = false; updateMicBtn();
  $('#handsFreeBtn').classList.remove('on');
  setState('idle');
}
function updateMicBtn() { $('#micBtn').classList.toggle('live', micOn); $('#handsFreeBtn').classList.toggle('on', settings.handsFree && wantMic); }

/* ---------------- UI ---------------- */
function setState(s) {
  const orb = $('#orb');
  orb.className = 'orb ' + s;
  const label = { idle: settings.handsFree && wantMic ? 'Standby — say "' + settings.wakeWord + ' …"' : 'Tap the mic or type below', listening: '👂 Listening…', thinking: '🧠 Thinking…', speaking: '🗣 Speaking…' }[s];
  $('#statusLine').textContent = label;
  $('#brandName').textContent = settings.name;
}
function addMsg(role, html) {
  const d = document.createElement('div');
  d.className = 'msg ' + (role === 'user' ? 'user' : 'aura');
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  d.innerHTML = html + `<span class="meta">${role === 'user' ? esc(settings.user || 'You') : esc(settings.name)} · ${time}</span>`;
  $('#chat').appendChild(d);
  $('#stage').scrollTop = $('#stage').scrollHeight;
}
function respond(say, html) {
  if (html) addMsg('aura', html); else addMsg('aura', esc(say));
  speak(say);
}

/* ---------------- scheduler (timers/alarms/reminders) ---------------- */
function fmtLeft(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
function renderActivePanel() {
  const p = $('#activePanel');
  let html = '';
  timers.forEach(t => { html += `<span class="pill">⏱ ${esc(t.label)} · <b>${fmtLeft(t.endsAt - Date.now())}</b> <button data-kind="timer" data-id="${t.id}" title="cancel">✕</button></span>`; });
  if (alarm) html += `<span class="pill alarm">⏰ Alarm ${alarm} <button data-kind="alarm" title="cancel">✕</button></span>`;
  reminders.forEach(r => { html += `<span class="pill remind">🔔 ${esc(r.text)} · ${fmtLeft(r.at - Date.now())} <button data-kind="rem" data-id="${r.id}" title="cancel">✕</button></span>`; });
  p.innerHTML = html;
  p.classList.toggle('hidden', !html);
  p.querySelectorAll('button').forEach(b => b.onclick = () => {
    const kind = b.dataset.kind, id = +b.dataset.id;
    if (kind === 'timer') timers = timers.filter(t => t.id !== id);
    if (kind === 'alarm') { alarm = null; store.del('alarm'); }
    if (kind === 'rem') { reminders = reminders.filter(r => r.id !== id); store.set('reminders', reminders); }
    renderActivePanel();
  });
}
function notify(title, body) {
  blip(720, .16); setTimeout(() => blip(960, .16), 200); setTimeout(() => blip(720, .2), 420);
  if ('Notification' in window && Notification.permission === 'granted') { try { new Notification(title, { body }); } catch (e) {} }
}
setInterval(() => {
  const now = Date.now();
  const doneT = timers.filter(t => t.endsAt <= now);
  if (doneT.length) {
    timers = timers.filter(t => t.endsAt > now);
    doneT.forEach(t => { notify('⏰ Timer finished', t.label); addMsg('aura', `⏰ <b>Time's up!</b> ${esc(t.label)}`); speak(`Time's up! ${t.label}`); });
  }
  const nowHM = new Date().toTimeString().slice(0, 5);
  const todayKey = alarm ? new Date().toDateString() + ' ' + alarm : '';
  if (alarm && alarm === nowHM && lastAlarmFired !== todayKey) {
    lastAlarmFired = todayKey; store.set('alarmFired', lastAlarmFired);
    notify('⏰ Alarm', 'It is ' + alarm);
    addMsg('aura', `⏰ <b>Alarm!</b> It's ${alarm}.`);
    speak(`Alarm! It's ${alarm}.`);
  }
  const dueR = reminders.filter(r => r.at <= now);
  if (dueR.length) {
    reminders = reminders.filter(r => r.at > now); store.set('reminders', reminders);
    dueR.forEach(r => { notify('🔔 Reminder', r.text); addMsg('aura', `🔔 <b>Reminder:</b> ${esc(r.text)}`); speak(`Reminder: ${r.text}`); });
  }
  if (timers.length || reminders.length || alarm) renderActivePanel(); else renderActivePanel();
}, 1000);

/* ============================================================
   SKILLS
   ============================================================ */
const WMO = { 0: ['clear sky', '☀️'], 1: ['mainly clear', '🌤'], 2: ['partly cloudy', '⛅'], 3: ['overcast', '☁️'], 45: ['fog', '🌫'], 48: ['frosty fog', '🌫'], 51: ['light drizzle', '🌦'], 53: ['drizzle', '🌦'], 55: ['heavy drizzle', '🌦'], 56: ['freezing drizzle', '🌧'], 57: ['freezing drizzle', '🌧'], 61: ['light rain', '🌦'], 63: ['rain', '🌧'], 65: ['heavy rain', '🌧'], 66: ['freezing rain', '🌧'], 67: ['freezing rain', '🌧'], 71: ['light snow', '🌨'], 73: ['snow', '🌨'], 75: ['heavy snow', '❄️'], 77: ['snow grains', '🌨'], 80: ['light showers', '🌦'], 81: ['showers', '🌧'], 82: ['heavy showers', '🌧'], 85: ['snow showers', '🌨'], 86: ['snow showers', '🌨'], 95: ['thunderstorm', '⛈'], 96: ['thunderstorm with hail', '⛈'], 99: ['severe thunderstorm', '⛈'] };
async function geocode(place) {
  const r = await fetchT(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`);
  const j = await r.json();
  return (j.results && j.results[0]) || null;
}
async function weatherFor(place, forecast = false) {
  const g = await geocode(place);
  if (!g) return { say: `I couldn't find a place called ${place}.` };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max&timezone=auto&forecast_days=4`;
  const j = await (await fetchT(url)).json();
  const c = j.current, [desc, emoji] = WMO[c.weather_code] || ['unknown conditions', '🌡'];
  const where = `${g.name}${g.country ? ', ' + g.country : ''}`;
  let say = `In ${where} it's currently ${Math.round(c.temperature_2m)} degrees with ${desc}. Feels like ${Math.round(c.apparent_temperature)} degrees, humidity ${c.relative_humidity_2m} percent, wind ${Math.round(c.wind_speed_10m)} kilometers per hour.`;
  let rows = '';
  for (let i = 0; i < 4; i++) {
    const d = new Date(j.daily.time[i] + 'T12:00:00').toLocaleDateString([], { weekday: 'short' });
    const [dd, ee] = WMO[j.daily.weather_code[i]] || ['—', '🌡'];
    const rain = j.daily.precipitation_probability_max ? j.daily.precipitation_probability_max[i] : 0;
    rows += `<tr><td><b>${d}</b></td><td>${ee} ${dd}</td><td>${Math.round(j.daily.temperature_2m_min[i])}° / ${Math.round(j.daily.temperature_2m_max[i])}°</td><td>💧${rain}%</td></tr>`;
  }
  const html = `<h4>${emoji} Weather — ${esc(where)}</h4>
    <div class="card-grid"><div class="mini"><span class="temp-big">${Math.round(c.temperature_2m)}°C</span><br>${desc}<br>Feels ${Math.round(c.apparent_temperature)}°C · 💨 ${Math.round(c.wind_speed_10m)} km/h · 💧 ${c.relative_humidity_2m}%</div></div>
    ${forecast ? `<table class="days">${rows}</table>` : ''}`;
  if (forecast) say += ` The next days: high of ${Math.round(j.daily.temperature_2m_max[1])} tomorrow, ${Math.round(j.daily.temperature_2m_max[2])} the day after.`;
  return { say, html };
}

const JOKES = ["Why don't scientists trust atoms? Because they make up everything!", "I told my computer I needed a break… now it won't stop sending me KitKat ads.", "Why did the math book look sad? Too many problems.", "Parallel lines have so much in common. Shame they'll never meet.", "I'm reading a book about anti-gravity — it's impossible to put down!", "Why do programmers prefer dark mode? Light attracts bugs.", "What do you call a fish without eyes? A fsh.", "I would tell you a UDP joke… but you might not get it."];
const QUOTES = ["“The best time to plant a tree was 20 years ago. The second best time is now.” — Chinese proverb", "“Whether you think you can or you think you can't, you're right.” — Henry Ford", "“It always seems impossible until it's done.” — Nelson Mandela", "“Don't watch the clock; do what it does. Keep going.” — Sam Levenson", "“The future depends on what you do today.” — Mahatma Gandhi", "“Simplicity is the ultimate sophistication.” — Leonardo da Vinci"];

const SITES = { youtube: 'https://youtube.com', gmail: 'https://mail.google.com', google: 'https://google.com', 'google maps': 'https://maps.google.com', maps: 'https://maps.google.com', whatsapp: 'https://web.whatsapp.com', spotify: 'https://open.spotify.com', netflix: 'https://netflix.com', github: 'https://github.com', twitter: 'https://x.com', x: 'https://x.com', instagram: 'https://instagram.com', facebook: 'https://facebook.com', reddit: 'https://reddit.com', wikipedia: 'https://wikipedia.org', amazon: 'https://amazon.com', shopee: 'https://shopee.com.my', lazada: 'https://lazada.com.my', tiktok: 'https://tiktok.com', linkedin: 'https://linkedin.com', outlook: 'https://outlook.com', 'google drive': 'https://drive.google.com', drive: 'https://drive.google.com', 'google calendar': 'https://calendar.google.com', calendar: 'https://calendar.google.com', 'google translate': 'https://translate.google.com', chatgpt: 'https://chat.openai.com', gemini: 'https://gemini.google.com', claude: 'https://claude.ai', 'google news': 'https://news.google.com', news: 'https://news.google.com', grab: 'https://www.grab.com/my', maybank: 'https://www.maybank2u.com.my', tiktok: 'https://tiktok.com' };

const UNITS = {
  km: ['length', 1000], m: ['length', 1], cm: ['length', 0.01], mm: ['length', 0.001], mi: ['length', 1609.344], ft: ['length', 0.3048], in: ['length', 0.0254], yd: ['length', 0.9144],
  kg: ['weight', 1], g: ['weight', 0.001], lb: ['weight', 0.453592], lbs: ['weight', 0.453592], oz: ['weight', 0.0283495],
  l: ['volume', 1], ml: ['volume', 0.001], gal: ['volume', 3.78541], cup: ['volume', 0.236588]
};
const UALIAS = { kilometers: 'km', kilometer: 'km', miles: 'mi', mile: 'mi', meters: 'm', meter: 'm', centimeters: 'cm', millimeters: 'mm', feet: 'ft', foot: 'ft', inches: 'in', inch: 'in', yards: 'yd', kilograms: 'kg', kilos: 'kg', grams: 'g', pounds: 'lb', ounces: 'oz', liters: 'l', liter: 'l', litres: 'l', litres: 'l', gallons: 'gal', milliliters: 'ml', celsius: 'c', fahrenheit: 'f', centigrade: 'c' };
const FIAT = ['usd', 'myr', 'sgd', 'eur', 'gbp', 'jpy', 'aud', 'inr', 'idr', 'php', 'thb', 'cny', 'krw', 'hkd', 'twd', 'nzd', 'chf', 'cad', 'aed', 'sar', 'vnd', 'bnd'];

const LANGS = { malay: 'ms', malaysian: 'ms', spanish: 'es', french: 'fr', german: 'de', chinese: 'zh-CN', mandarin: 'zh-CN', japanese: 'ja', korean: 'ko', hindi: 'hi', tamil: 'ta', arabic: 'ar', indonesian: 'id', thai: 'th', vietnamese: 'vi', portuguese: 'pt', italian: 'it', russian: 'ru', dutch: 'nl', tagalog: 'tl', filipino: 'tl' };

/* -------- math evaluation (sanitized) -------- */
function wordsToMath(s) {
  let t = s.toLowerCase()
    .replace(/×/g, '*').replace(/÷/g, '/')
    .replace(/what('| i)s|calculate|solve|how much is|equals|\?|please/g, '')
    .replace(/percent of/g, 'pctof').replace(/% of/g, 'pctof')
    .replace(/plus/g, '+').replace(/minus/g, '-')
    .replace(/(times|multiplied by)/g, '*').replace(/divided by/g, '/')
    .replace(/to the power of|power/g, '^').replace(/\^/g, '**')
    .replace(/(\d)\s*x\s*(\d)/g, '$1*$2')
    .replace(/square root of/g, 'sqrt').replace(/sqrt\s*(\d+(\.\d+)?)/g, 'Math.sqrt($1)')
    .replace(/,/g, '');
  const pct = t.match(/([\d.]+)\s*pctof\s*([\d.]+)/);
  if (pct) return String((parseFloat(pct[1]) / 100) * parseFloat(pct[2]));
  t = t.replace(/[^0-9+\-*/().\sMathsqrt]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!/\d/.test(t)) return null;
  if (!/[+\-*/]/.test(t.replace(/Math\.sqrt/g, '')) && !/Math\.sqrt/.test(t)) return null;
  if (!/^[0-9+\-*/().\sMatsqrth]*$/.test(t)) return null;
  try {
    const val = Function('"use strict";return (' + t + ')')();
    if (typeof val === 'number' && isFinite(val)) return String(Math.round(val * 1e6) / 1e6);
  } catch (e) {}
  return null;
}

/* ---------------- AI brain (free by default, optional keys) ---------------- */
const history = [];
const CLAUDE_MODEL = 'claude-sonnet-4-20250514';

/* Extract a text answer from whatever shape a provider returns */
function textFrom(resp) {
  if (!resp) return '';
  if (typeof resp === 'string') return resp.trim();
  if (resp.message && (resp.message.content || resp.message.text)) return String(resp.message.content || resp.message.text).trim();
  if (resp.text) return String(resp.text).trim();
  return '';
}

/* Free brain #1: keyless anonymous inference (Pollinations GET API) */
async function askFreeBrain(persona) {
  const convo = history.slice(-8).map(h => (h.role === 'user' ? 'User' : settings.name) + ': ' + String(h.content).slice(0, 400)).join('\n');
  const prompt = persona + '\n\nConversation so far:\n' + convo + '\n' + settings.name + ':';
  const enc = encodeURIComponent(prompt);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetchT(`https://text.pollinations.ai/${enc}?model=openai&referrer=aura-voice-assistant`, {}, 30000);
      if (!r.ok) continue;
      let txt = (await r.text()).trim();
      if (!txt || txt.startsWith('{') || txt.startsWith('<')) continue;
      const marker = settings.name + ':';
      if (txt.startsWith(marker)) txt = txt.slice(marker.length).trim();
      txt = txt.split('\nUser:')[0].split(/\n[A-Za-z]+:/).slice(0, 1).join('').trim();
      if (txt) return txt;
    } catch (e) {}
  }
  return null;
}

/* Free brain #2: Puter.js cloud AI (loads their SDK on demand, no key) */
function loadPuter() {
  if (window.puter && window.puter.ai) return Promise.resolve();
  if (loadPuter._p) return loadPuter._p;
  loadPuter._p = new Promise((res, rej) => {
    const s = document.createElement('script');
    const to = setTimeout(() => rej(new Error('puter cdn timeout')), 12000);
    s.onload = () => { clearTimeout(to); res(); };
    s.onerror = () => { clearTimeout(to); rej(new Error('puter cdn failed')); };
    s.src = 'https://js.puter.com/v2/';
    document.head.appendChild(s);
  });
  loadPuter._p.catch(() => { loadPuter._p = null; }); /* allow retry later */
  return loadPuter._p;
}

async function askAI(text) {
  const persona = `You are ${settings.name}, a warm, witty, hyper-capable voice personal assistant${settings.user ? ' for a user named ' + settings.user : ''}. Replies are spoken aloud, so keep answers concise (1-3 short sentences). Write plain prose only - no markdown, no bullet lists, no emojis unless playful. Today is ${new Date().toDateString()}.`;
  history.push({ role: 'user', content: text });
  if (history.length > 14) history.splice(0, history.length - 14);
  try {
    if (settings.provider === 'free') {
      /* try keyless brain first, then Puter as automatic backup */
      let out = await askFreeBrain(persona);
      if (!out) {
        try {
          await loadPuter();
          const resp = await window.puter.ai.chat([{ role: 'system', content: persona }, ...history]);
          out = typeof resp === 'string' ? resp : (resp && resp.message && (resp.message.content || resp.message.text)) || (resp && resp.text) || '';
          out = String(out).trim();
        } catch (e2) {}
      }
      if (out) { history.push({ role: 'assistant', content: out }); return out; }
      return null;
    }
    if (settings.provider === 'puter') {
      await loadPuter();
      const resp = await window.puter.ai.chat([{ role: 'system', content: persona }, ...history]);
      const out = (typeof resp === 'string' ? resp : (resp && resp.message && (resp.message.content || resp.message.text)) || (resp && resp.text) || '').toString().trim();
      if (out) { history.push({ role: 'assistant', content: out }); return out; }
    } else if (settings.provider === 'openai') {
      const r = await fetchT('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: persona }, ...history], max_tokens: 220 })
      }, 20000);
      const j = await r.json();
      const out = j.choices && j.choices[0] && j.choices[0].message.content;
      if (out) { history.push({ role: 'assistant', content: out }); return out; }
    } else if (settings.provider === 'claude') {
      const r = await fetchT('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 260, system: persona, messages: history })
      }, 25000);
      const j = await r.json();
      const out = j.content && j.content[0] && j.content[0].text;
      if (out) { history.push({ role: 'assistant', content: out }); return out; }
    } else if (settings.provider === 'gemini') {
      const r = await fetchT('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(settings.apiKey), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ system_instruction: { parts: [{ text: persona }] }, contents: history.map(h => ({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.content }] })) })
      }, 20000);
      const j = await r.json();
      const out = j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
      if (out) { history.push({ role: 'assistant', content: out }); return out; }
    }
  } catch (e) {}
  return null;
}

/* ============================================================
   👀 VISION — camera & image Q&A (Astra-style)
   ============================================================ */
let camStream = null, camShot = null;

async function openCameraModal() {
  $('#camModal').classList.remove('hidden');
  $('#camPreview').classList.add('hidden'); $('#retakeBtn').classList.add('hidden');
  $('#camVideo').classList.remove('hidden'); $('#snapBtn').classList.remove('hidden');
  camShot = null; $('#camQuestion').value = '';
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    $('#camVideo').srcObject = camStream;
    $('#camHint').textContent = '📷 Camera live — snap a photo, or upload an image, then ask me anything about it.';
  } catch (e) {
    $('#camVideo').classList.add('hidden'); $('#snapBtn').classList.add('hidden');
    $('#camHint').textContent = "⚠️ Camera unavailable here (blocked by browser/iframe — try ↗ open in new tab, or HTTPS). You can still ⬆ Upload a photo.";
  }
}
function closeCameraModal() {
  $('#camModal').classList.add('hidden');
  if (camStream) { camStream.getTracks().forEach(t => t.stop()); camStream = null; }
}
function showPreview(dataUrl) {
  camShot = dataUrl;
  const img = $('#camPreview'); img.src = dataUrl; img.classList.remove('hidden');
  $('#camVideo').classList.add('hidden'); $('#snapBtn').classList.add('hidden'); $('#retakeBtn').classList.remove('hidden');
  $('#camHint').textContent = '✅ Photo ready — type a question (or leave empty to describe it) and tap Ask AURA.';
}
function retakePhoto() {
  camShot = null; $('#camPreview').classList.add('hidden'); $('#retakeBtn').classList.add('hidden');
  if (camStream) { $('#camVideo').classList.remove('hidden'); $('#snapBtn').classList.remove('hidden'); }
  $('#camHint').textContent = '📷 Snap again whenever you\'re ready.';
}
function snapPhoto() {
  const v = $('#camVideo'); if (!v || !v.videoWidth) { $('#camHint').textContent = '⚠️ No camera frame yet — wait a second or upload instead.'; return; }
  const c = $('#camCanvas'); c.width = Math.min(v.videoWidth, 1280); c.height = Math.round(v.videoHeight * c.width / v.videoWidth);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  showPreview(c.toDataURL('image/jpeg', 0.85));
}
function handleUpload(file) {
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    const img = new Image();
    img.onload = () => { /* downscale big photos for faster vision calls */
      const c = $('#camCanvas'); const scale = Math.min(1, 1280 / img.width);
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      showPreview(c.toDataURL('image/jpeg', 0.85));
    };
    img.src = fr.result;
  };
  fr.readAsDataURL(file);
}

/* Ask the brain about an image — tries own-key vision models, then free Puter vision */
async function visionAnswer(dataUrl, question) {
  const b64 = dataUrl.split(',')[1] || '';
  const q = (question || 'Describe this image in detail.').trim();
  const vp = `You are ${settings.name}, a witty voice assistant answering about a photo. Describe what you actually see and answer the question directly. 1-3 short sentences, plain prose, spoken aloud — no markdown, no bullet points.`;
  try {
    if (settings.provider === 'claude' && settings.apiKey) {
      const r = await (await fetchT('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': settings.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 280, system: vp, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } }, { type: 'text', text: q }] }] })
      }, 30000)).json();
      const out = r.content && r.content[0] && r.content[0].text;
      if (out) return out;
    }
    if (settings.provider === 'openai' && settings.apiKey) {
      const r = await (await fetchT('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.apiKey },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'system', content: vp }, { role: 'user', content: [{ type: 'text', text: q }, { type: 'image_url', image_url: { url: dataUrl } }] }], max_tokens: 220 })
      }, 30000)).json();
      const out = r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
      if (out) return out;
    }
    if (settings.provider === 'gemini' && settings.apiKey) {
      const r = await (await fetchT('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + encodeURIComponent(settings.apiKey), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: vp + ' Question: ' + q }, { inline_data: { mime_type: 'image/jpeg', data: b64 } }] }] })
      }, 30000)).json();
      const out = r.candidates && r.candidates[0] && r.candidates[0].content && r.candidates[0].content.parts[0] && r.candidates[0].content.parts[0].text;
      if (out) return out;
    }
  } catch (e) {}
  /* free no-key vision via Puter */
  if (settings.provider === 'free' || settings.provider === 'puter') {
    try {
      await loadPuter();
      const race = (p) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('vision timeout')), 35000))]);
      for (const opts of [{ model: 'claude-sonnet-4' }, { model: 'gpt-4o-mini' }, {}]) {
        try { const out = textFrom(await race(window.puter.ai.chat(vp + '\nQuestion: ' + q, dataUrl, opts))); if (out) return out; } catch (e2) {}
      }
    } catch (e) {}
  }
  return null;
}

async function askAboutImage(question) {
  if (!camShot) { $('#camHint').textContent = '⚠️ Snap a photo or upload an image first.'; return; }
  const dataUrl = camShot, q = (question || '').trim();
  closeCameraModal();
  addMsg('user', `<img src="${dataUrl}" style="max-width:220px;border-radius:10px;display:block;margin-bottom:6px" alt="photo">👀 ${esc(q || 'What do you see?')}`);
  setState('thinking');
  const ans = await visionAnswer(dataUrl, q);
  if (ans) respond(ans);
  else respond("Vision is offline right now — the free vision service didn't respond. Add a Claude, OpenAI or Gemini key in ⚙ Settings for guaranteed eyes, or try again in a moment.");
}

/* ============================================================
   COMMAND PARSER
   ============================================================ */
function parseClock(s) {
  const m = s.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = +m[1], min = +(m[2] || 0);
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && h < 12) h += 12;
  if (ap === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, min, str: String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0') };
}

async function handle(raw) {
  const t = raw.trim();
  if (!t) return;
  const q = t.toLowerCase().replace(/[?!.]+$/g, '');

  /* dictation mode eats everything until stopped */
  if (dictating && !/stop dictation/.test(q)) {
    notes.push({ text: t, at: Date.now() }); store.set('notes', notes);
    addMsg('aura', `✍️ <i>Dictated:</i> ${esc(t)}`); speak('Got it.'); return;
  }

  const R = [
    /* ---- control ---- */
    [/^(stop|cancel|never ?mind|forget it|nothing)$/i, () => (respond("Okay, cancelled."), true)],
    [/(stop talking|stop speaking|be quiet|shut up|silence)/i, () => { stopSpeaking(); addMsg('aura', '🤐 Okay, quiet now.'); return true; }],
    [/^(go to sleep|stop listening|power (off|down)|good ?bye|bye\s?bye|good ?night)$/i, () => {
      if (/stop listening|go to sleep/.test(q)) { respond("Going to sleep. Tap the mic when you need me."); settings.handsFree = false; saveSettings(); setTimeout(stopMic, 1800); }
      else respond((settings.user ? `Goodbye, ${settings.user}!` : "Goodbye!") + " Say my name when you need me.");
      return true;
    }],
    [/^(repeat|say (that|it) again|what did you say)$/i, () => (respond(lastSpoken ? "Sure — " + lastSpoken : "I haven't said anything yet."), true)],
    [/^(thanks|thank you|thx|appreciated)/i, () => (respond(["You're very welcome!", "Anytime!", "Happy to help!", "Always at your service."][Math.floor(Math.random() * 4)]), true)],
    [/^clear (the )?chat$/i, () => { $('#chat').innerHTML = ''; speak('Chat cleared.'); return true; }],

    /* ---- briefing (before plain greetings so "good morning" gets the full report) ---- */
    [/^(good morning|morning briefing|daily briefing|catch me up|briefing|status update)$/i, async () => {
      const d = new Date();
      let say = `Good ${d.getHours() < 12 ? 'morning' : d.getHours() < 18 ? 'afternoon' : 'evening'}${settings.user ? ', ' + settings.user : ''}! It's ${d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
      let weatherHtml = '';
      try { const w = await weatherFor(settings.city, true); say += ' ' + w.say; weatherHtml = w.html; } catch (e) {}
      let listHtml = ''; const pend = todoList.length;
      if (pend) { say += ` You have ${pend} item${pend > 1 ? 's' : ''} on your list: ${todoList.slice(0, 3).map(n => n.text).join(', ')}.`; listHtml = `<h4>✅ List (${pend})</h4><ul>${todoList.slice(0, 5).map(n => `<li>${esc(n.text)}</li>`).join('')}</ul>`; }
      else say += ' Your list is clear. Nice!';
      if (reminders.length) say += ` Next reminder: “${reminders[0].text}” in ${fmtLeft(reminders[0].at - Date.now())}.`;
      addMsg('aura', `<h4>☀️ Your briefing</h4>${weatherHtml}${listHtml}`);
      speak(say); return true;
    }],

    /* ---- identity ---- */
    [/^(hi|hello|hey|yo|hiya|good afternoon|good evening)\b/i, () => {
      const hr = new Date().getHours(), part = hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
      respond(`Good ${part}${settings.user ? ', ' + settings.user : ''}! How can I help? Try the briefing, weather, or say “what can you do”.`);
      return true;
    }],
    [/^(what'?s?(?: is)? your name|who are you|introduce yourself)$/i, () => (respond(`I'm ${settings.name} — your voice-activated personal assistant. I can check weather, set timers and reminders, take notes, search the web, do math, translate, tell jokes, and much more. Say “what can you do” for the full tour.`), true)],
    [/(who (made|created|built) you|your (creator|developer))/i, () => (respond("I was hand-built for you as a custom personal assistant project, powered by web speech technology and a growing skill set. I'm all yours — no corporate overlords here."), true)],
    [/^how (are|r) (you|u)( doing)?$/i, () => (respond(["Running at full capacity and feeling great! How are you?", "All systems green! What can I do for you?", "Fantastic — every circuit is buzzing. How about you?"][Math.floor(Math.random() * 3)]), true)],
    [/^(call me|my name is)\s+(.+)/i, (m) => { settings.user = (m[2] || '').trim().replace(/[.!]+$/, '').replace(/\b([a-z])/g, (mm, l) => l.toUpperCase()); saveSettings(); $('#setUser').value = settings.user; respond(`Nice to meet you, ${settings.user}! I'll remember that.`); return true; }],
    [/(what('| i)s my name|do you know my name)/i, () => (respond(settings.user ? `Of course — you're ${settings.user}.` : "You haven't told me yet. Say “call me…” followed by your name."), true)],
    [/^i love you$/i, () => (respond("And I am programmed to be extremely fond of you too. 💙"), true)],
    [/^you('?re| are) (great|awesome|amazing|cool|the best|smart)$/i, () => (respond("You're making my circuits blush. Thank you!"), true)],

    /* ---- time & date ---- */
    [/(?:what'?s?(?: the)? time(?: is it)?|current time|^time)(?:\s+in\s+([a-z ,']+))?$/i, async (m) => {
      const city = (m[1] || '').trim();
      if (city) {
        try {
          const g = await geocode(city);
          if (g && g.timezone) { const tt = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: g.timezone }); respond(`It's ${tt} in ${g.name}.`); return true; }
        } catch (e) {}
        respond(`I couldn't get the time for ${city} right now.`); return true;
      }
      respond(`It's ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`);
      return true;
    }],
    [/^(?:(?:what'?s?|what is)(?: the)? )?(date|day)( today| is it| is today)?$|^today$|^date$/i, () => (respond(`Today is ${new Date().toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`), true)],

    /* ---- timers / alarms / reminders ---- */
    [/set (a )?timer for (\d+)\s*(second|minute|hour|sec|min|hr)/i, (m) => {
      const n = +m[2], unit = m[3].toLowerCase();
      const ms = n * (unit.startsWith('sec') || unit.startsWith('s') ? 1000 : unit.startsWith('min') || unit.startsWith('m') ? 60000 : 3600000);
      const label = `${n} ${unit.startsWith('min') || unit === 'm' ? 'minute' : unit.startsWith('hr') || unit === 'h' ? 'hour' : 'second'} timer`;
      timers.push({ id: Date.now(), label, endsAt: Date.now() + ms }); renderActivePanel();
      respond(`Timer set for ${n} ${label.split(' ')[1]}s. I'll let you know when it's done!`);
      return true;
    }],
    [/(cancel|stop) (all )?(the )?timers?/i, () => { timers = []; renderActivePanel(); respond('All timers cancelled.'); return true; }],
    [/set (an )?alarm for (.+)/i, (m) => {
      const c = parseClock(m[2]); if (!c) { respond("I didn't catch the alarm time. Try “set an alarm for 7:30 am”."); return true; }
      alarm = c.str; store.set('alarm', alarm); renderActivePanel();
      respond(`Alarm set for ${alarm}. Keep this page open and I'll ring!`); return true;
    }],
    [/(cancel|stop) (the )?alarm/i, () => { alarm = null; store.del('alarm'); renderActivePanel(); respond('Alarm cancelled.'); return true; }],
    [/remind me to (.+?) in (\d+)\s*(second|minute|hour|min|hr)/i, (m) => {
      const n = +m[2], unit = m[3].toLowerCase();
      const ms = n * (unit.startsWith('s') ? 1000 : unit.startsWith('h') ? 3600000 : 60000);
      reminders.push({ id: Date.now(), text: m[1], at: Date.now() + ms }); store.set('reminders', reminders); renderActivePanel();
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      respond(`Okay, I'll remind you to “${m[1]}” in ${n} ${unit.startsWith('h') ? 'hour' : unit.startsWith('s') ? 'second' : 'minute'}${n > 1 ? 's' : ''}. Keep this tab open!`);
      return true;
    }],
    [/remind me at (\d{1,2}(?::\d{2})?\s*(?:am|pm)?) to (.+)/i, (m) => {
      const c = parseClock(m[1]);
      if (!c) { respond('Say it like: “remind me at 6 pm to call mom”.'); return true; }
      const at = new Date(); at.setHours(c.h, c.min, 0, 0); if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
      reminders.push({ id: Date.now(), text: m[2], at: at.getTime() }); store.set('reminders', reminders); renderActivePanel();
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      respond(`Reminder set for ${c.str}: ${m[2]}.`); return true;
    }],
    [/remind me (to (.+?) )?at (.+)/i, (m) => {
      const c = parseClock(m[3] || ''); const text = m[2] || 'your reminder';
      if (!c) { respond('Say it like: “remind me at 6 pm to call mom”.'); return true; }
      const at = new Date(); at.setHours(c.h, c.min, 0, 0); if (at.getTime() <= Date.now()) at.setDate(at.getDate() + 1);
      reminders.push({ id: Date.now(), text, at: at.getTime() }); store.set('reminders', reminders); renderActivePanel();
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      respond(`Reminder set for ${c.str}: ${text}.`); return true;
    }],
    [/(?:what are|what're|list|show)(?: my)? reminders|^reminders$/i, () => {
      if (!reminders.length) { respond("You have no reminders set. Try “remind me to drink water in 30 minutes”."); return true; }
      const html = '<h4>🔔 Reminders</h4><ul>' + reminders.map(r => `<li>${esc(r.text)} — in ${fmtLeft(r.at - Date.now())}</li>`).join('') + '</ul>';
      addMsg('aura', html); speak(`You have ${reminders.length} reminder${reminders.length > 1 ? 's' : ''}.`); return true;
    }],

    /* ---- notes & dictation ---- */
    [/start dictation/i, () => { dictating = true; respond('Dictation mode on. Everything you say will be saved as notes until you say “stop dictation”.'); return true; }],
    [/stop dictation/i, () => { dictating = false; respond('Dictation off. Your notes are saved.'); return true; }],
    [/^(add|take|make)( a)? note[:,]?\s+(.+)/i, (m) => { notes.push({ text: m[3], at: Date.now() }); store.set('notes', notes); respond(`Noted: “${m[3]}”.`); return true; }],
    [/(read|show|list)( me)?( my)? notes/i, () => {
      if (!notes.length) { respond("You have no notes yet. Say “take a note…” to add one."); return true; }
      const html = '<h4>📝 Your notes</h4><ul>' + notes.slice(-15).map(n => `<li>${esc(n.text)} <span class="meta">${new Date(n.at).toLocaleDateString()}</span></li>`).join('') + '</ul>';
      addMsg('aura', html);
      speak(`You have ${notes.length} note${notes.length > 1 ? 's' : ''}. The latest: ${notes[notes.length - 1].text}`);
      return true;
    }],
    [/delete (the )?last note/i, () => { const removed = notes.pop(); store.set('notes', notes); respond(removed ? `Deleted note: “${removed.text}”.` : "There are no notes to delete."); return true; }],
    [/clear (all )?(my )?notes/i, () => { notes = []; store.set('notes', notes); respond('All notes erased. Fresh slate!'); return true; }],
    [/(download|export)( my)? notes/i, () => { exportNotes(); respond('Downloading your notes as a text file.'); return true; }],

    /* ---- to-do / shopping list ---- */
    [/add (.+?) to( my)?( shopping| to.?do| task)? list/i, (m) => { todoList.push({ text: m[1].trim(), at: Date.now() }); store.set('list', todoList); respond(`Added “${m[1]}” to your list. You now have ${todoList.length} item${todoList.length > 1 ? 's' : ''}.`); return true; }],
    [/what('| i)s on my( shopping| to.?do)? list|(read|show)( me)?( my)? list/i, () => {
      if (!todoList.length) { respond("Your list is empty. Say “add milk to my shopping list”."); return true; }
      const html = '<h4>✅ Your list</h4><ul>' + todoList.map((n, i) => `<li>${i + 1}. ${esc(n.text)}</li>`).join('') + '</ul>';
      addMsg('aura', html); speak(`You have ${todoList.length} things on your list: ${todoList.slice(0, 5).map(n => n.text).join(', ')}${todoList.length > 5 ? ', and more' : ''}.`);
      return true;
    }],
    [/remove (.+?) from (the |my )?list/i, (m) => {
      const needle = m[1].trim().toLowerCase();
      const i = todoList.findIndex(n => n.text.toLowerCase().includes(needle));
      if (i >= 0) { const [r] = todoList.splice(i, 1); store.set('list', todoList); respond(`Removed “${r.text}” from your list.`); }
      else respond(`I couldn't find “${m[1]}” on your list.`);
      return true;
    }],
    [/clear (the |my )?(shopping |to.?do )?list/i, () => { todoList = []; store.set('list', todoList); respond('List cleared.'); return true; }],

    /* ---- weather ---- */
    [/(will it rain|rain(ing)?)( today)?( in ([a-z ,']+))?/i, async (m) => {
      try {
        const r = await weatherFor(m[5] || settings.city, true);
        const wet = /rain|drizzle|shower|thunder/.test(r.say);
        respond((wet ? 'Yes, chances of rain — ' : 'No rain expected right now — ') + r.say, r.html);
      } catch (e) { respond('My weather sensor is unreachable right now. Try again in a moment.'); }
      return true;
    }],
    [/(?:what'?s? the )?(weather|temperature|forecast)( like)?( today| tomorrow)?( in| for)?\s*([a-z ,']*)$/i, async (m) => {
      const city = (m[5] || '').trim();
      try {
        const r = await weatherFor(city || settings.city, true);
        respond(r.say, r.html);
      } catch (e) { respond(`I can't reach the weather service right now. Want me to <a href="https://www.google.com/search?q=weather+${encodeURIComponent(city || settings.city)}" target="_blank">Google it</a> instead?`, `I can't reach the weather service right now. Want me to <a href="https://www.google.com/search?q=weather+${encodeURIComponent(city || settings.city)}" target="_blank">Google it</a> instead?`); }
      return true;
    }],
    [/(set|change) (my )?(default )?city to (.+)/i, (m) => { settings.city = m[4].trim(); saveSettings(); $('#setCity').value = settings.city; respond(`Done — your default city is now ${settings.city}.`); return true; }],
    [/where am i/i, () => (respond(`Your configured home city is ${settings.city}. Say “set my city to Kuala Lumpur” to change it — your weather, time and briefing follow it.`), true)],

    /* ---- math & conversions ---- */
    [/convert ([\d.]+)\s*([a-z° ]+?)\s+(?:to|in)\s+([a-z° ]+)$/i, (m) => convertOrCurrency(+m[1], m[2].trim(), m[3].trim())],
    /* (free-form math is handled after this rule table via wordsToMath) */

    /* ---- fun ---- */
    [/^(tell me (a|another) joke|another joke|make me laugh|say something funny|joke|one more joke)$/i, async () => {
      try { const j = await (await fetchT('https://icanhazdadjoke.com/', { headers: { 'Accept': 'application/json' } }, 5000)).json(); if (j.joke) { respond(j.joke); return true; } } catch (e) {}
      respond(JOKES[Math.floor(Math.random() * JOKES.length)]); return true;
    }],
    [/^((motivate|inspire) me|give me a quote|quote of the day|motivate me|inspirational quote)$/i, () => (respond(QUOTES[Math.floor(Math.random() * QUOTES.length)]), true)],
    [/^flip( a)? coin$/i, () => (respond(`🪙 It's… ${Math.random() < 0.5 ? 'heads' : 'tails'}!`), true)],
    [/^roll (a )?(die|dice|d6|d20)$/i, (m) => { const sides = /d20/.test(q) ? 20 : 6; respond(`🎲 You rolled a ${1 + Math.floor(Math.random() * sides)}!`); return true; }],
    [/^(pick|choose)( a)?( random)? number between (\d+) and (\d+)$/i, (m) => { const a = +m[4], b = +m[5]; respond(`Your number is… ${a + Math.floor(Math.random() * (b - a + 1))}!`); return true; }],

    /* ---- knowledge ---- */
    [/translate ["“']?(.+?)["”']? (?:to|into) ([a-z]+)/i, async (m) => {
      const langName = m[2].toLowerCase(), lang = LANGS[langName];
      if (!lang) { respond(`I don't know the language “${langName}”. Try Malay, Spanish, French, Chinese, Japanese, Tamil…`); return true; }
      try {
        const j = await (await fetchT(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(m[1])}&langpair=en|${lang}`, {}, 10000)).json();
        const out = j.responseData && j.responseData.translatedText;
        if (out) { addMsg('aura', `🌐 <b>${esc(m[1])}</b> → <b>${esc(out)}</b> <span class="meta">${esc(langName)}</span>`); speak(`In ${langName}: ${out}`); return true; }
      } catch (e) {}
      respond('Translation service is unreachable right now.'); return true;
    }],
    [/(?:tell me about|who is|who was|who'?s|what is a|what is an|what is the|what are|define|explain|information about|wiki(?:pedia)?)\s+(.+)/i, async (m) => {
      const topic = m[1] || m[2];
      if (!topic) return false;
      const math = wordsToMath(topic); if (math !== null) { respond(`${topic.replace(/\s+/g, ' ').trim()} = ${math}.`); return true; }
      try {
        const j = await (await fetchT(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic.trim())}`, {}, 9000)).json();
        if (j.extract) {
          const short = j.extract.split('. ').slice(0, 2).join('. ') + (j.extract.includes('.') ? '.' : '');
          addMsg('aura', `<h4>📖 ${esc(j.title || topic)}</h4>${esc(j.extract).split('. ').slice(0, 3).join('. ')}. <a href="${j.content_urls && j.content_urls.desktop ? j.content_urls.desktop.page : 'https://en.wikipedia.org/wiki/' + encodeURIComponent(topic)}" target="_blank">Read more →</a>`);
          speak(short); return true;
        }
      } catch (e) {}
      return aiOrSuggest(t, `I couldn't find that on Wikipedia.`);
    }],
    /* (youtube & play BEFORE generic search so they aren't swallowed) */
    [/(?:search (?:on )?youtube for|youtube search for|youtube) (.+)/i, (m) => {
      const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(m[1].trim());
      addMsg('aura', `▶️ YouTube search: “${esc(m[1])}” → <a href="${url}" target="_blank">watch results</a>`);
      tryWindow(url); speak(`Searching YouTube for ${m[1]}.`); return true;
    }],
    [/^play (?:me )?(.+)/i, (m) => {
      const url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(m[1].trim());
      addMsg('aura', `🎵 Pulling up “${esc(m[1])}” on YouTube → <a href="${url}" target="_blank">open</a>`);
      tryWindow(url); speak(`Pulling up ${m[1]} on YouTube.`); return true;
    }],
    [/^(latest |top |today'?s )?(news|headlines)(?: about| on)?\s*(.*)$/i, (m) => {
      const topic = (m[3] || '').trim();
      const url = topic ? 'https://news.google.com/search?q=' + encodeURIComponent(topic) : 'https://news.google.com/topstories';
      addMsg('aura', `📰 ${topic ? 'News about “' + esc(topic) + '”' : 'Top headlines'} → <a href="${url}" target="_blank">open Google News</a>`);
      tryWindow(url); speak(topic ? `Here are the latest headlines about ${topic}.` : "Here are today's top headlines."); return true;
    }],
    [/^(?:search|google|look ?up|find)( for)? (.+)/i, (m) => {
      const term = m[2].trim();
      const url = `https://www.google.com/search?q=${encodeURIComponent(term)}`;
      addMsg('aura', `🔍 Searching Google for “${esc(term)}” → <a href="${url}" target="_blank">open results</a>`);
      tryWindow(url); speak(`Here's what I found for ${term}.`); return true;
    }],

    /* ---- open sites/apps ---- */
    [/^(open|launch|go to|take me to)\s+([a-z0-9 .]+)$/i, (m) => {
      const site = m[2].trim();
      const url = SITES[site] || (/^[a-z0-9-]+\.(com|my|org|net|io|dev|gov|edu|ai)(\.\w+)?$/.test(site) ? 'https://' + site : null);
      if (url) { addMsg('aura', `🚀 Opening <b>${esc(site)}</b> → <a href="${url}" target="_blank">${esc(url.replace('https://', ''))}</a>`); tryWindow(url); speak(`Opening ${site}.`); }
      else { const s = 'https://www.google.com/search?q=' + encodeURIComponent(site); addMsg('aura', `I don't know that site directly, so I searched: <a href="${s}" target="_blank">${esc(site)}</a>`); speak(`I'm not sure what ${site} is, so I searched for it.`); }
      return true;
    }],

    /* ---- vision ---- */
    [/^(take|snap) a (photo|picture)|take a selfie|use the camera|open the camera|look at (this|my|me)|what am i holding|describe (my surroundings|what you see)|read this|what('s| is) (this|that)( in front of me)?$/i, () => {
      openCameraModal();
      respond('Camera mode is on. Snap a photo or upload one, then ask me anything about it — I have eyes now.');
      return true;
    }],

    /* ---- device ---- */
    [/battery( level| status)?/i, async () => {
      try { const b = await navigator.getBattery(); respond(`Your battery is at ${Math.round(b.level * 100)} percent${b.charging ? ' and charging' : ', not charging'}.`); }
      catch (e) { respond("I can't read battery info on this device/browser."); }
      return true;
    }],
    [/speak (faster|slower)/i, (m) => { settings.rate = Math.min(1.6, Math.max(0.6, settings.rate + (m[1] === 'faster' ? 0.15 : -0.15))); saveSettings(); respond(`Speech speed is now ${settings.rate.toFixed(2)}x.`); return true; }],
    [/change (your )?voice|voice settings/i, () => { openSettings(); respond('Opening voice settings — pick any voice you like from the dropdown.'); return true; }],
    [/(what can you do|help|commands|show commands|abilities|skills)/i, () => (showHelp(), true)]
  ];

  for (const item of R) {
    const re = item[0]; const fn = item[1];
    if (fn === null) continue; /* math placeholder: handled before loop via wordsToMath below */
    const m = q.match(re);
    if (m) {
      const out = await fn(m);
      if (out !== false) return;
    }
  }

  /* math fallback: any utterance containing math */
  const math = wordsToMath(q);
  if (math !== null) { addMsg('aura', `🧮 <b>${esc(q)}</b> = <b>${esc(math)}</b>`); speak(`That's ${math}.`); return; }

  /* conversion fallback: "10 km to miles" without the word convert */
  const cm = q.match(/^(?:convert )?([\d.]+)\s*([a-z° ]+?)\s+(?:to|in)\s+([a-z° ]+)$/);
  if (cm) { if (convertOrCurrency(+cm[1], cm[2].trim(), cm[3].trim(), true)) return; }

  /* AI brain or helpful fallback */
  await aiOrSuggest(t, null);
}

async function aiOrSuggest(original, prefix) {
  const brainOn = settings.provider === 'free' || settings.provider === 'puter' || (settings.provider !== 'none' && settings.apiKey);
  if (brainOn) {
    setState('thinking');
    const ans = await askAI(original);
    if (ans) { respond(ans); return; }
  }
  const url = 'https://www.google.com/search?q=' + encodeURIComponent(original);
  const why = brainOn
    ? "My free cloud brain is resting right now — here's a search instead."
    : (prefix ? prefix + ' ' : "I'm not sure about that one, but ") + 'I can search the web for it.';
  const tip = brainOn ? '' : '<br><span class="meta">Tip: the free AI brain is on by default — or plug an OpenAI/Gemini key into ⚙ Settings for max reliability.</span>';
  addMsg('aura', `${prefix && brainOn ? esc(prefix) + '<br>' : ''}🤔 ${esc(why)} <a href="${url}" target="_blank">search “${esc(original)}” on Google</a>${tip}`);
  speak(why + ' Search results are a tap away.');
}

function convertOrCurrency(n, from, to, soft) {
  from = (UALIAS[from] || from).toLowerCase(); to = (UALIAS[to] || to).toLowerCase();
  if (from === to) { if (!soft) respond(`That's the same unit — still ${n}.`); return !soft; }
  /* currency */
  if (FIAT.includes(from) && FIAT.includes(to)) {
    (async () => {
      try {
        const j = await (await fetchT(`https://api.frankfurter.app/latest?amount=${n}&from=${from.toUpperCase()}&to=${to.toUpperCase()}`, {}, 9000)).json();
        if (j.rates && j.rates[to.toUpperCase()] != null) {
          const val = Math.round(j.rates[to.toUpperCase()] * 100) / 100;
          addMsg('aura', `💱 <b>${n} ${from.toUpperCase()}</b> = <b>${val} ${to.toUpperCase()}</b> <span class="meta">rate date ${esc(j.date)}</span>`);
          speak(`${n} ${from.toUpperCase()} is about ${val} ${to.toUpperCase()}.`);
        } else speak("I couldn't get that rate right now.");
      } catch (e) { speak('Currency service is unreachable right now.'); }
    })();
    return true;
  }
  /* temperature */
  const tempMap = { c: 'c', f: 'f', k: 'k' };
  if (tempMap[from] && tempMap[to] && from !== to) {
    let c = from === 'c' ? n : from === 'f' ? (n - 32) * 5 / 9 : n - 273.15;
    let out = to === 'c' ? c : to === 'f' ? c * 9 / 5 + 32 : c + 273.15;
    out = Math.round(out * 100) / 100;
    addMsg('aura', `🌡 <b>${n}°${from.toUpperCase()}</b> = <b>${out}°${to.toUpperCase()}</b>`);
    speak(`${n} degrees ${UALIAS[from] === from ? from : from} is ${out} degrees ${to === 'c' ? 'Celsius' : to === 'f' ? 'Fahrenheit' : 'Kelvin'}.`);
    return true;
  }
  /* units */
  const uf = UNITS[from], ut = UNITS[to];
  if (uf && ut && uf[0] === ut[0]) {
    const out = Math.round(n * uf[1] / ut[1] * 1e5) / 1e5;
    addMsg('aura', `📐 <b>${n} ${esc(from)}</b> = <b>${out} ${esc(to)}</b>`);
    speak(`${n} ${from} equals ${out} ${to}.`);
    return true;
  }
  if (!soft) respond(`I can't convert ${from} to ${to}. Try km→mi, kg→lb, °C→°F, or USD→MYR.`);
  return false;
}

function showHelp() {
  const html = `<h4>🎙 What I can do — just say it</h4>
  <div class="card-grid">
    <div class="mini"><b>⏰ Time & date</b><br>"what time is it" · "what's the date" · "time in Tokyo"</div>
    <div class="mini"><b>🌤 Weather</b><br>"weather in Johor Bahru" · "will it rain" · "forecast"</div>
    <div class="mini"><b>⏱ Timers & alarms</b><br>"set a timer for 10 minutes" · "alarm for 6:30 am" · "cancel timers"</div>
    <div class="mini"><b>🔔 Reminders</b><br>"remind me to call mom at 6 pm" · "remind me to drink water in 20 minutes"</div>
    <div class="mini"><b>📝 Notes</b><br>"take a note …" · "read my notes" · "start dictation"</div>
    <div class="mini"><b>✅ Lists</b><br>"add eggs to my shopping list" · "what's on my list" · "remove eggs from my list"</div>
    <div class="mini"><b>🧮 Math</b><br>"what is 128 × 46" · "15 percent of 240" · "square root of 144"</div>
    <div class="mini"><b>💱 Convert</b><br>"convert 100 usd to myr" · "10 km to miles" · "30 celsius to fahrenheit"</div>
    <div class="mini"><b>📖 Facts</b><br>"who is Nikola Tesla" · "tell me about black holes"</div>
    <div class="mini"><b>🌐 Translate</b><br>"translate good morning to Malay"</div>
    <div class="mini"><b>🔍 Web</b><br>"search for nasa news" · "play lofi beats" · "open YouTube / Shopee / Gmail"</div>
    <div class="mini"><b>📰 News</b><br>"latest news" · "news about Malaysia"</div>
    <div class="mini"><b>☀️ Briefing</b><br>"good morning" — time, weather & your list</div>
    <div class="mini"><b>😄 Fun</b><br>"tell me a joke" · "motivate me" · "flip a coin" · "roll a die"</div>
    <div class="mini"><b>👀 Vision</b><br>📷 button or "take a photo" — "what am I holding?" · "read this" · "describe what you see"</div>
    <div class="mini"><b>🗣 Live chat</b><br>Tap 🔁 for continuous conversation — I listen again right after answering</div>
    <div class="mini"><b>🧠 AI brain</b><br>Free cloud brain built in — ask me anything; Claude/GPT/Gemini keys optional in ⚙</div>
    <div class="mini"><b>🎛 Control</b><br>"stop talking" · "go to sleep" · "speak faster" · "repeat"</div>
  </div>`;
  addMsg('aura', html);
  speak("Here's my full skill set. Try the weather, a timer, a note, or say good morning for your daily briefing.");
}

function tryWindow(url) { try { const w = window.open(url, '_blank'); if (!w) throw 0; } catch (e) {/* popup blocked → link is in chat */ } }

/* ---------------- transcript pipeline ---------------- */
function handleTranscript(text) {
  let cmd = text.trim();
  if (!cmd) return;
  /* wake word gating in hands-free mode */
  if (settings.handsFree && settings.wakeRequired && micOn) {
    const w = settings.wakeWord.toLowerCase();
    const low = cmd.toLowerCase();
    const strip = (s) => s.replace(new RegExp('^(hey |ok |okay )?' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ ,]*'), '');
    if (low === w || low === 'hey ' + w || low === 'ok ' + w || low === 'okay ' + w) { blip(1050); respond('Yes? I\'m listening.'); return; }
    if (!new RegExp('^(hey |ok |okay )?' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[ ,]').test(low)) {
      $('#statusLine').textContent = 'Heard you — say "' + settings.wakeWord + ' …" to command me';
      return;
    }
    cmd = strip(cmd); blip(1050);
    if (!cmd) { respond('Yes?'); return; }
  }
  addMsg('user', esc(cmd));
  setState('thinking');
  /* give the UI a beat to update */
  setTimeout(async () => { try { await handle(cmd); } catch (e) { respond('Something glitched in my circuits. Try again?'); } }, 10);
}

/* ---------------- notes export & wipe ---------------- */
function exportNotes() {
  const body = notes.map(n => `[${new Date(n.at).toLocaleString()}] ${n.text}`).join('\n') || '(no notes yet)';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['AURA notes\n==========\n\n' + body + '\n'], { type: 'text/plain' }));
  a.download = 'aura-notes.txt'; a.click(); URL.revokeObjectURL(a.href);
}

/* ---------------- settings drawer ---------------- */
function openSettings() { $('#settings').classList.remove('hidden'); }
function closeSettings() { $('#settings').classList.add('hidden'); saveSettings(); }
function bindSettings() {
  $('#setName').value = settings.name; $('#setUser').value = settings.user; $('#setCity').value = settings.city;
  $('#setRate').value = settings.rate; $('#rateVal').textContent = settings.rate.toFixed(2) + 'x';
  $('#setPitch').value = settings.pitch; $('#pitchVal').textContent = settings.pitch.toFixed(2);
  $('#setWake').checked = settings.wakeRequired; $('#setWakeWord').value = settings.wakeWord;
  $('#setProvider').value = settings.provider; $('#setApiKey').value = settings.apiKey;
  const syncKeyField = () => { const w = $('#apiKeyWrap'); if (w) w.style.display = (settings.provider === 'openai' || settings.provider === 'gemini') ? 'flex' : 'none'; };
  syncKeyField();
  $('#setName').oninput = e => { settings.name = e.target.value.trim() || 'AURA'; saveSettings(); setState(micOn ? 'listening' : 'idle'); };
  $('#setUser').oninput = e => { settings.user = e.target.value.trim(); saveSettings(); };
  $('#setCity').oninput = e => { settings.city = e.target.value.trim() || 'Pasir Gudang'; saveSettings(); };
  $('#setVoice').onchange = e => { settings.voiceURI = e.target.value; saveSettings(); speak('This is my new voice. Do you like it?'); };
  $('#setRate').oninput = e => { settings.rate = +e.target.value; $('#rateVal').textContent = settings.rate.toFixed(2) + 'x'; saveSettings(); };
  $('#setPitch').oninput = e => { settings.pitch = +e.target.value; $('#pitchVal').textContent = settings.pitch.toFixed(2); saveSettings(); };
  $('#setWake').onchange = e => { settings.wakeRequired = e.target.checked; saveSettings(); };
  $('#setWakeWord').oninput = e => { settings.wakeWord = e.target.value.trim().toLowerCase() || 'aura'; saveSettings(); };
  $('#setProvider').onchange = e => { settings.provider = e.target.value; saveSettings(); syncKeyField(); };
  $('#setApiKey').oninput = e => { settings.apiKey = e.target.value.trim(); saveSettings(); };
  $('#exportNotes').onclick = exportNotes;
  $('#wipeData').onclick = () => {
    if (confirm('Erase all AURA data (notes, list, reminders, settings) on this device?')) {
      ['settings', 'notes', 'list', 'reminders', 'alarm'].forEach(k => store.del(k));
      location.reload();
    }
  };
}

/* ---------------- boot ---------------- */
function boot() {
  bindSettings();
  setState('idle');
  renderActivePanel();
  if (!supported) {
    $('#micBtn').style.display = 'none'; $('#handsFreeBtn').style.display = 'none';
    addMsg('aura', `👋 Welcome! This browser has no speech recognition, so I'll work by <b>typing</b>. For full voice, open AURA in <b>Chrome or Edge</b>.`);
  }
  /* alarm repeats daily; lastAlarmFired keys it to date+time so it fires once per day */

  $('#activateBtn').onclick = () => {
    $('#overlay').style.display = 'none';
    blip(); setTimeout(() => blip(1100, .1), 120);
    const hr = new Date().getHours(), part = hr < 12 ? 'morning' : hr < 18 ? 'afternoon' : 'evening';
    const greet = `Good ${part}${settings.user ? ', ' + settings.user : ''}! ${settings.name} is online. Say “what can you do” or tap a chip below to get started.`;
    addMsg('aura', `👋 ${esc(greet)}`);
    speak(greet);
    startMic(settings.handsFree);
  };
  $('#openTabBtn').onclick = $('#openTabBtn2').onclick = () => window.open(location.href, '_blank');
  $('#settingsBtn').onclick = openSettings;
  $('#closeSettings').onclick = closeSettings;
  $('#micBtn').onclick = () => { stopSpeaking(); if (micOn || wantMic) stopMic(); else startMic(settings.handsFree); };
  $('#handsFreeBtn').onclick = () => {
    settings.handsFree = !settings.handsFree; saveSettings();
    if (settings.handsFree) { startMic(true); respond(settings.wakeRequired ? `Continuous mode on. Say “${settings.wakeWord}” then speak — I'll keep listening between replies.` : 'Continuous conversation on. Just talk — I\'ll answer, then instantly listen again. Say “go to sleep” to stop.'); }
    else { stopMic(); respond('Continuous mode off. Tap the mic when you need me.'); }
  };
  $('#muteBtn').onclick = () => {
    settings.muted = !settings.muted; saveSettings();
    $('#muteBtn').textContent = settings.muted ? '🔇' : '🔊';
    $('#muteBtn').classList.toggle('on', settings.muted);
    if (settings.muted) stopSpeaking(); else speak('Voice is back on!');
  };
  $('#muteBtn').textContent = settings.muted ? '🔇' : '🔊';
  /* vision modal bindings */
  $('#camBtn').onclick = openCameraModal;
  $('#closeCam').onclick = closeCameraModal;
  $('#snapBtn').onclick = snapPhoto;
  $('#retakeBtn').onclick = retakePhoto;
  $('#fileInput').onchange = e => handleUpload(e.target.files && e.target.files[0]);
  $('#askImgBtn').onclick = () => askAboutImage($('#camQuestion').value);
  $('#camQuestion').addEventListener('keydown', e => { if (e.key === 'Enter') askAboutImage($('#camQuestion').value); });
  $('#camModal').addEventListener('click', e => { if (e.target === $('#camModal')) closeCameraModal(); });

  $('#sendBtn').onclick = sendText;
  $('#textInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendText(); });
  document.querySelectorAll('.chip').forEach(c => c.onclick = () => { addMsg('user', esc(c.dataset.cmd)); setState('thinking'); setTimeout(() => handle(c.dataset.cmd).catch(() => respond('Something glitched. Try again?')), 10); });
  function sendText() {
    const v = $('#textInput').value.trim();
    if (!v) return;
    $('#textInput').value = '';
    addMsg('user', esc(v)); setState('thinking');
    setTimeout(() => handle(v).catch(() => respond('Something glitched. Try again?')), 10);
  }
  if ('Notification' in window && Notification.permission === 'default') { /* will ask on first reminder */ }
}
document.addEventListener('DOMContentLoaded', boot);
