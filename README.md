# Manga Translator Extension

A local, offline-capable Chrome extension for translating manga using AI.

## Installation

1. **Build the extension** (if not already built):
   ```bash
   npm run build
   ```

2. **Load in Chrome**:
   - Open `chrome://extensions/`
   - Enable **Developer mode** (toggle in top-right corner)
   - Click **Load unpacked**
   - **IMPORTANT**: Navigate to and select the **`dist`** folder inside this project directory
     - Correct path: `d:\the_code\translation plugin\dist`
     - ⚠️ Do NOT select the root project folder!

3. **Verify**:
   - The extension should load without errors
   - You should see "Manga Translator (Local)" in your extensions list

## Usage

1. Navigate to a webpage with manga images
2. Click the extension icon
3. Select source language (e.g., Japanese) and target language (e.g., English)
4. Click "Translate Page"
5. Wait for the translation to complete (first run downloads models, ~1GB)

## Features

- ✅ Local OCR with Tesseract.js
- ✅ Local translation with Transformers.js (NLLB-200)
- ✅ Offline capable (after first model download)
- ✅ Modern glassmorphism UI
- ✅ Cross-browser compatible manifest

## Troubleshooting

**Error: "Invalid script mime type" or "Service worker registration failed"**
- Make sure you're loading the **`dist`** folder, not the root project folder
- The manifest in the `dist` folder has the correct compiled JavaScript paths
