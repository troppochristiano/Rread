# RRead

A browser-based text-to-speech reader. Paste text or import a file and listen to it read aloud using your device's built-in speech voices.

## Features

- **File import** — TXT, MD, PDF, EPUB (PDF and EPUB parsed client-side, no server needed)
- **Voice control** — choose any voice installed on the device; adjust speed, pitch, and volume
- **Word-level highlighting** — the active word is highlighted in sync with speech
- **Click to seek** — click any word in the text to jump playback to that position
- **Session resume** — position is saved to localStorage; pick up where you left off
- **Dark/light theme** — defaults to your OS preference, toggleable
- **Locale** — UI in English or Italian, defaults to your browser language

## Stack

- React 19 + Vite
- Web Speech API (no external TTS service)
- pdfjs-dist, epub.js (loaded on demand)

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview   # serve the production build locally
```
