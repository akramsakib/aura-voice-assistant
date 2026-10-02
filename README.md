# 🎙 AURA — Voice-Activated Personal Assistant

A full Jarvis-style personal assistant that runs entirely in your browser.
Talk to it or type — it answers back with a real voice, shows rich cards, and
remembers your notes, lists, reminders and preferences **on your device only**
(localStorage — no accounts, no cloud).

## 🚀 Quick start

**Use it right now:** open the live preview of this workspace (the server is running),
click **⚡ Activate AURA**, and allow microphone access.

**Best setup for voice:**
- Browser: **Google Chrome** or **Microsoft Edge** (speech recognition requires them).
- If the mic is blocked inside an embedded preview, click **↗ Open in new tab** so the
  browser grants full mic permission.
- Voice output (talking back) works in all modern browsers; typing works everywhere.

**Run it locally instead:** any static file server works —
```bash
cd voice-assistant
python3 -m http.server 8080
# then open http://localhost:8080 in Chrome/Edge
```

## 🧠 Skills — just say it

| Category | Example voice commands |
|---|---|
| ☀️ **Daily briefing** | “good morning” · “catch me up” — time, weather, your list & next reminder |
| ⏰ Time & date | “what time is it” · “time in Tokyo” · “what's the date” |
| 🌤 Weather | “what's the weather” · “weather in Kuala Lumpur” · “will it rain in London” · “forecast” |
| ⏱ Timers | “set a timer for 10 minutes” · “cancel timers” |
| ⏰ Alarms | “set an alarm for 6:30 am” (repeats daily; keep tab open) · “cancel alarm” |
| 🔔 Reminders | “remind me to call mom at 6 pm” · “remind me to drink water in 30 minutes” · “what are my reminders” |
| 📝 Notes | “take a note buy a gift for Sara” · “read my notes” · “download my notes” · voice **dictation mode** (“start dictation”) |
| ✅ Lists | “add eggs to my shopping list” · “what's on my list” · “remove eggs from my list” |
| 🧮 Math | “what's 128 times 46” · “15 percent of 240” · “square root of 144” · “2 to the power of 10” |
| 💱 Conversions | “convert 100 USD to MYR” · “10 km to miles” · “30 celsius to fahrenheit” · “75 kg to lb” |
| 📖 Facts | “who is Nikola Tesla” · “tell me about black holes” (Wikipedia) |
| 🌐 Translation | “translate good morning to Malay” (20+ languages) |
| 🔍 Web | “search for nasa news” · “search youtube for lofi” · “play despacito” |
| 🚀 Open apps/sites | “open YouTube” · “open Gmail” · “open Shopee” · “open WhatsApp” … |
| 📰 News | “latest news” · “news about Malaysia” |
| 😄 Fun | “tell me a joke” · “motivate me” · “flip a coin” · “roll a d20” |
| 👀 **Vision (Astra-style)** | 📷 button or “take a photo” → ask “what am I holding?” · “read this text” · “describe what you see” — camera or upload, answers about real images |
| 🗣 **Live conversation** | Tap 🔁 once → talk back-and-forth continuously; AURA listens again the moment she finishes answering. “go to sleep” to stop |
| 🎛 Control | “stop talking” · “repeat” · “speak faster” · “go to sleep” · “what can you do” |
| 🔋 Device | “battery status” |

## 👤 Make it personal

- “**Call me Alex**” — AURA greets and addresses you by name (stored locally).
- ⚙️ **Settings:** rename the assistant, default weather city, pick from dozens of
  installed system voices, speed/pitch sliders, **hands-free mode** with an optional
  **wake word** (default “aura”), mute toggle.
- 🔁 **Hands-free:** tap the 🔁 button and AURA listens continuously. Enable
  “Require wake word” so it only responds when you start with its name.

## 🧠 AI brain — free, no key needed (plus optional upgrades)

AURA answers open-ended questions **out of the box** — no API keys, no accounts,
no setup. The built-in free brain chains two keyless providers with automatic
fallback:

1. **Pollinations** anonymous inference (primary)
2. **Puter.js** free cloud AI (automatic backup, loads on demand)

If any built-in skill can't handle a phrase, the AI brain replies with a short,
speakable answer and remembers the conversation context. If both free providers
are momentarily unreachable, AURA degrades gracefully to a Google search link.

**🚀 Auto-Brain mode (default)** — paste any keys in ⚙ Settings and AURA
automatically routes every question through the best model you have:

**Gemini → Claude → GPT-4o-mini → free cloud chain**

Each failure silently falls to the next brain — AURA never goes quiet.

### Want the *exact same* brain as Astra or Claude? Here's how it actually works

Astra **is** Gemini. Claude **is** Anthropic's API model. Both are gated services —
the only way to get identical intelligence/speed is their official APIs, and the
good news is **Google gives a free tier**:

1. Go to **aistudio.google.com/apikey** → sign in → **Create API key** (2 min, no credit card)
2. Paste it into ⚙ Settings → **Gemini key**. Done.

You now have an **Astra-class brain** (Gemini 3.8 Flash — ~1,500 free requests/day,
vision included, same model ID paid users get). Add a **Claude key**
(console.anthropic.com) and/or an **OpenAI key** and Auto mode routes between all
three — closest possible thing to "Astra and Claude combined."

⚠️ Free-tier trade-off: Google may use free-tier inputs to improve its models —
keep sensitive questions off it, or use a paid key.

**Zero-key mode still works**: with no keys at all, Auto falls back to the free
cloud chain (Pollinations → Puter Claude-class models), so AURA always answers.

## 👀 Vision

Tap 📷 or say **“take a photo”** → snap with your camera (or upload any image)
→ ask anything about it: *“what am I holding?”*, *“read this label”*,
*“translate what's on this sign”*, *“is this plant healthy?”* …

Vision uses the same Auto-Brain routing — with a free Gemini key it runs on the
Astra-class multimodal stack; Claude / GPT keys work too; the free no-key path
tries Puter's vision models automatically.

## 🗣 Continuous conversation

Tap 🔁 once and just keep talking — AURA answers, then instantly re-opens her
ears (the mic pauses while she speaks so she never hears herself). Say
**“go to sleep”** or toggle 🔁 off to stop. Enable “Require wake word” in ⚙
Settings if you want her to only respond when addressed by name.

## 🌍 Hosted version

This project is deployed at **GitHub Pages** — free, fast, HTTPS everywhere,
works on any phone, tablet, laptop or TV browser. Every push to `main`
re-deploys automatically (usually live within a minute).

- Live app: `https://<username>.github.io/<repo>/`
- Updates: edit files → `git push` → done.

## 🔒 Privacy

- Notes, lists, reminders, settings: **never leave your device**.
- Speech recognition audio is processed by your browser's speech service
  (e.g., Google's, in Chrome) — that's how all browser voice assistants work.
- Weather, Wikipedia, jokes, currency and translation use free public APIs
  (Open-Meteo, Wikipedia REST, icanhazdadjoke, Frankfurter, MyMemory) — only
  the query you asked for is sent.

## 🗂 Project structure

```
voice-assistant/
├── index.html   # UI: orb, chat, drawers, overlays
├── style.css    # dark sci-fi theme, orb animations, cards
├── app.js       # skills engine: recognition, TTS, 30+ commands, scheduler, AI hook
└── README.md
```

Built as a zero-dependency, no-build static app — every skill is hand-written
JavaScript you can read, extend, and make your own. 🦾
