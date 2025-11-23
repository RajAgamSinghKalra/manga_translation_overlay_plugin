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
  el.style.position = 'fixed';
  el.style.pointerEvents = 'none';
  el.style.zIndex = '2147483647';
  el.style.border = '2px solid #a855f7';
  document.body.appendChild(el);

  let rafId: number | null = null;

  const sync = () => {
    const rect = img.getBoundingClientRect();
    el.style.top = `${rect.top}px`;
    el.style.left = `${rect.left}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
  };

  const loop = () => {
    sync();
    rafId = requestAnimationFrame(loop);
  };
  rafId = requestAnimationFrame(loop);

  const dispose = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
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

  const overlayAnchor = createOverlayAnchor(img);
  const overlay = overlayAnchor.element;

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
    const imageSize = (ocrResult as any)?.imageSize;
    const sourceWidth = imageSize?.width || img.naturalWidth || overlay.clientWidth;
    const sourceHeight = imageSize?.height || img.naturalHeight || overlay.clientHeight;
    const scaleX = overlay.clientWidth / sourceWidth;
    const scaleY = overlay.clientHeight / sourceHeight;

    if (blocks.length === 0) {
      const translatedText = await translateText(cleanText, sourceLang, targetLang);
      console.log('Translation complete (fallback single block):', translatedText);
      overlay.appendChild(makeOverlayBox(10, 10, overlay.clientWidth - 20, translatedText, undefined, overlay.clientWidth, overlay.clientHeight));
    } else {
      for (const block of blocks) {
        const translatedText = await translateText(block.text, sourceLang, targetLang);
        const x = block.bbox.x0 * scaleX;
        const y = block.bbox.y0 * scaleY;
        const w = (block.bbox.x1 - block.bbox.x0) * scaleX;
        const h = (block.bbox.y1 - block.bbox.y0) * scaleY;
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

function extractBlocks(ocrResult: any) {
  const normalize = (text: string) => text?.replace(/\s+/g, ' ').trim() || '';
  const mapItems = (items: any) => {
    const arr = Array.isArray(items) ? items : [];
    return arr
      .map(item => ({
        bbox: item?.bbox,
        text: normalize(item?.text),
        confidence: item?.confidence ?? item?.conf ?? 0,
      }))
      .filter(b => b.text.length > 0 && b.bbox && b.confidence >= 0);
  };

  const data = ocrResult || {};
  // Prefer word-level for precise placement; fall back to lines/paragraphs.
  let items = mapItems(data.words);
  if (items.length === 0) items = mapItems(data.lines);
  if (items.length === 0) items = mapItems(data.paragraphs);
  if (items.length === 0) items = mapItems(data.blocks);
  return items;
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
