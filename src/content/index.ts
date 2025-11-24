import { performOCR, translateText } from '../lib/ml/pipeline';

console.log('Manga Translator Content Script Loaded');

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'TRANSLATE_PAGE') {
    processPage(request.source, request.target).catch(err => {
      console.error('Page translation failed', err);
    });
    sendResponse({ status: 'started' });
  }
  return true;
});

async function processPage(sourceLang: string, targetLang: string) {
  const images = Array.from(document.querySelectorAll<HTMLImageElement>('img'))
    .filter(img => img.width > 300 && img.height > 300);

  console.log(`Found ${images.length} images to translate.`);

  for (const img of images) {
    if (img.dataset.mangaTlProcessed === 'true' || img.dataset.mangaTlProcessing === 'true') continue;
    img.dataset.mangaTlProcessing = 'true';
    await processImage(img, sourceLang, targetLang);
  }
}

type OverlayAnchor = {
  element: HTMLDivElement;
  dispose: () => void;
};

function createOverlayAnchor(img: HTMLImageElement): OverlayAnchor {
  const el = document.createElement('div');
  el.className = 'manga-tl-overlay';
  el.style.position = 'absolute';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '2147483647';
  el.style.border = '2px solid #a855f7';
  el.style.boxSizing = 'border-box';
  el.style.top = '0';
  el.style.left = '0';
  el.style.transformOrigin = 'top left';
  el.style.willChange = 'transform, width, height';
  el.style.contain = 'layout paint size';
  el.style.userSelect = 'none';
  el.style.overflow = 'hidden';
  document.body.appendChild(el);

  let rafId: number | null = null;
  const resizeObserver = new ResizeObserver(() => syncOnce());

  const syncBounds = () => {
    const rect = img.getBoundingClientRect();
    const pageLeft = rect.left + window.scrollX;
    const pageTop = rect.top + window.scrollY;
    el.style.transform = `translate3d(${pageLeft}px, ${pageTop}px, 0)`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  };

  let pending = false;
  const syncOnce = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      syncBounds();
    });
  };

  const loop = () => {
    syncBounds();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);
  resizeObserver.observe(img);

  const onScrollOrResize = () => syncOnce();
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize, true);

  const dispose = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    resizeObserver.disconnect();
    window.removeEventListener('scroll', onScrollOrResize, true);
    window.removeEventListener('resize', onScrollOrResize, true);
    el.remove();
  };

  return { element: el, dispose };
}

async function processImage(img: HTMLImageElement, sourceLang: string, targetLang: string) {
  if (!img.complete || !img.naturalWidth || !img.naturalHeight) {
    const loaded = await waitForImage(img);
    if (!loaded) {
      console.warn('Image failed to load, skipping', img.src);
      return;
    }
  }

  const layoutReady = await waitForLayout(img);
  if (!layoutReady) {
    console.warn('Image layout never stabilized, skipping', img.src);
    return;
  }

  const overlayAnchor = createOverlayAnchor(img);
  const overlay = overlayAnchor.element;

  const overlayReady = await waitForOverlay(overlay);
  if (!overlayReady) {
    console.warn('Overlay has zero size, skipping image (layout not ready).', img.src);
    overlayAnchor.dispose();
    return;
  }

  let objectUrl: string | null = null;
  let success = false;

  try {
    console.log('Processing image:', img.src);

    let imageBlob: Blob | null = null;
    try {
      const response = await fetch(img.src, { mode: 'cors' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      imageBlob = await response.blob();
    } catch (err) {
      console.warn('Fetch failed, falling back to image src directly', err);
    }

    const imageUrl = imageBlob ? (objectUrl = URL.createObjectURL(imageBlob)) : img.src;

    const ocrResult = await performOCR(imageUrl, sourceLang);
    console.log('OCR Result:', ocrResult);

    if (!ocrResult || !ocrResult.text || ocrResult.text.trim().length === 0) {
      console.log('No text detected in image');
      return;
    }

    const cleanText = ocrResult.text.replace(/\s+/g, ' ').trim();
    console.log('Clean text to translate:', cleanText);

    // Build per-block overlays so translated text sits over the source bubbles.
    const blocks = extractBlocks(ocrResult);
    const { scaleX, scaleY, sourceWidth, sourceHeight } = getScaleFactors(ocrResult, img, overlay);

    if (blocks.length === 0) {
      // Strict Fallback: Don't translate if confidence is low or text is garbage
      if (ocrResult.confidence < 30 || isGarbage(cleanText)) {
        console.log('Skipping fallback translation: Low confidence or garbage text detected.', ocrResult.confidence);
        return;
      }

      const translatedText = await translateText(cleanText, sourceLang, targetLang);
      if (translatedText) {
        console.log('Translation complete (fallback single block):', translatedText);
        overlay.appendChild(makeOverlayBox(10, 10, overlay.clientWidth - 20, translatedText, undefined, overlay.clientWidth, overlay.clientHeight));
      }
    } else {
      // Parallelize translation requests
      const translationPromises = blocks.map(async (block) => {
        try {
          const translatedText = await translateText(block.text, sourceLang, targetLang);
          return { block, translatedText };
        } catch (err) {
          console.error('Failed to translate block:', block.text, err);
          return null;
        }
      });

      const results = await Promise.all(translationPromises);

      for (const result of results) {
        if (!result) continue;
        const { block, translatedText } = result;
        const inflated = inflateBBox(block.bbox, sourceWidth, sourceHeight);
        const x = inflated.x0 * scaleX;
        const y = inflated.y0 * scaleY;
        const w = (inflated.x1 - inflated.x0) * scaleX;
        const h = (inflated.y1 - inflated.y0) * scaleY;
        const isVertical = h > w * 1.4;
        overlay.appendChild(makeOverlayBox(x, y, w, translatedText, h, overlay.clientWidth, overlay.clientHeight, isVertical));
      }
    }
    success = true;
    img.dataset.mangaTlProcessed = 'true';
  } catch (e) {
    console.error('Translation failed for image', e);
    overlay.style.borderColor = 'red';
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
    }
    if (!overlay.hasChildNodes()) {
      overlayAnchor.dispose();
    }
    delete img.dataset.mangaTlProcessing;
    if (!success) {
      delete img.dataset.mangaTlProcessed;
    }
  }
}

// Helper to detect garbage text
const isGarbage = (text: string) => {
  if (!text) return true;
  if (text.length < 2 && !/[a-zA-Z0-9\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]/.test(text)) return true; // Single char non-alphanumeric/non-japanese
  if (/^[^a-zA-Z0-9\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uff9f\u4e00-\u9faf]+$/.test(text)) return true; // Only symbols
  if (/^(.)\1+$/.test(text) && text.length > 3) return true; // Repeated characters like "HHHHH"

  // Explicitly blacklist known hallucination patterns
  if (text.includes('SQ of the') || text.includes('The SQ')) return true;

  // Detect repeated phrases (e.g., "SQ of the SQ of the SQ")
  const words = text.split(' ');
  if (words.length > 6) {
    const half = Math.floor(words.length / 2);
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half, half * 2).join(' ');
    if (firstHalf === secondHalf) return true;
  }

  return false;
};

function extractBlocks(ocrResult: any) {
  const normalize = (text: string) => text?.replace(/\s+/g, ' ').trim() || '';

  const mapItems = (items: any) => {
    const arr = Array.isArray(items) ? items : [];
    const imgWidth = (ocrResult as any)?.imageSize?.width || 1000; // Default if missing
    const imgHeight = (ocrResult as any)?.imageSize?.height || 1000;

    return arr
      .map(item => ({
        bbox: item?.bbox,
        text: normalize(item?.text),
        confidence: item?.confidence ?? item?.conf ?? 0,
        level: item?.level,
      }))
      .filter(b => {
        if (b.text.length === 0 || !b.bbox) return false;
        if (b.confidence < 20) {
          console.log('Filtered block (low confidence):', b.text, b.confidence);
          return false;
        }
        if (isGarbage(b.text)) {
          console.log('Filtered block (garbage):', b.text);
          return false;
        }

        const w = b.bbox.x1 - b.bbox.x0;
        const h = b.bbox.y1 - b.bbox.y0;

        // 1. Size Limit: Ignore blocks covering > 80% of the image area
        const blockArea = w * h;
        const imgArea = imgWidth * imgHeight;
        if (blockArea > (imgArea * 0.8)) {
          console.log('Filtered block (too large):', b.text);
          return false;
        }

        // 2. Aspect Ratio: Ignore extremely thin/tall blocks
        if (w > 0 && h > 0) {
          const ratio = w / h;
          if (ratio > 60 || ratio < 0.02) return false;
        }

        return true;
      });
  };

  const data = ocrResult || {};

  // Prefer blocks -> paragraphs -> lines; only fall back to words as a last resort.
  let items = mapItems(data.blocks);
  if (items.length === 0) items = mapItems(data.paragraphs);
  if (items.length === 0) items = mapItems(data.lines);
  if (items.length === 0) items = mapItems(data.words);

  return items;
}

function getScaleFactors(ocrResult: any, img: HTMLImageElement, overlay: HTMLDivElement) {
  const imageSize = (ocrResult as any)?.imageSize;
  const sourceWidth = imageSize?.width || img.naturalWidth || overlay.clientWidth || 1;
  const sourceHeight = imageSize?.height || img.naturalHeight || overlay.clientHeight || 1;
  const scaleX = overlay.clientWidth / sourceWidth;
  const scaleY = overlay.clientHeight / sourceHeight;
  return { scaleX, scaleY, sourceWidth, sourceHeight };
}

function inflateBBox(bbox: { x0: number; y0: number; x1: number; y1: number }, imgW: number, imgH: number) {
  const w = bbox.x1 - bbox.x0;
  const h = bbox.y1 - bbox.y0;
  // Expand box slightly to fully cover the speech bubble while keeping it clamped to the image.
  const pad = Math.max(6, Math.min(w, h) * 0.08);
  const x0 = Math.max(0, bbox.x0 - pad);
  const y0 = Math.max(0, bbox.y0 - pad);
  const x1 = Math.min(imgW, bbox.x1 + pad);
  const y1 = Math.min(imgH, bbox.y1 + pad);
  return { x0, y0, x1, y1 };
}

function makeOverlayBox(x: number, y: number, width: number, text: string, minHeight?: number, containerWidth?: number, containerHeight?: number, vertical?: boolean) {
  const box = document.createElement('div');
  const maxWidth = containerWidth ?? width;
  const maxHeight = containerHeight ?? Number.MAX_SAFE_INTEGER;
  const clampedWidth = Math.max(60, Math.min(width, maxWidth));
  const clampedX = Math.max(0, Math.min(x, (containerWidth ?? x + clampedWidth) - clampedWidth));
  const clampedY = Math.max(0, Math.min(y, (containerHeight ?? y + (minHeight || 0)) - (minHeight || 0)));

  box.style.position = 'absolute';
  box.style.left = `${clampedX}px`;
  box.style.top = `${clampedY}px`;
  box.style.width = `${clampedWidth}px`;
  if (minHeight) box.style.minHeight = `${Math.min(minHeight, maxHeight)}px`;
  box.style.backgroundColor = 'rgba(255, 255, 255, 0.92)';
  box.style.color = 'black';
  box.style.fontSize = '14px';
  box.style.fontFamily = 'Arial, sans-serif';
  box.style.fontWeight = 'bold';
  box.style.padding = '10px';
  box.style.boxSizing = 'border-box';
  box.style.zIndex = '10000';
  box.style.borderRadius = '6px';
  box.style.boxShadow = '0 2px 8px rgba(0,0,0,0.35)';
  box.style.lineHeight = '1.4';
  box.style.whiteSpace = 'pre-wrap';
  box.style.wordBreak = 'break-word';
  box.style.pointerEvents = 'none';
  if (vertical) {
    box.style.writingMode = 'vertical-rl';
    box.style.textOrientation = 'mixed';
  }
  box.innerText = text;
  return box;
}

function waitForImage(img: HTMLImageElement): Promise<boolean> {
  return new Promise(resolve => {
    const cleanup = () => {
      img.removeEventListener('load', onLoad);
      img.removeEventListener('error', onError);
    };
    const onLoad = () => {
      cleanup();
      resolve(true);
    };
    const onError = () => {
      cleanup();
      resolve(false);
    };
    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
  });
}

// Wait until the image has a non-zero client rect so overlays can be sized correctly.
async function waitForLayout(img: HTMLImageElement, timeoutMs = 1500): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const rect = img.getBoundingClientRect();
    if (rect.width > 2 && rect.height > 2) return true;
    await new Promise(res => requestAnimationFrame(res));
  }
  return false;
}

// Wait for the overlay element to acquire layout (non-zero size).
async function waitForOverlay(el: HTMLDivElement, timeoutMs = 1000): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    if (el.clientWidth > 2 && el.clientHeight > 2) return true;
    await new Promise(res => requestAnimationFrame(res));
  }
  return false;
}
