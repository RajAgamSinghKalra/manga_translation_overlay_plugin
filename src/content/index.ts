import { performOCR, translateText } from '../lib/ml/pipeline';

console.log('Manga Translator Content Script Loaded');

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'TRANSLATE_PAGE') {
        console.log('Received TRANSLATE_PAGE request');
        processPage(request.source, request.target);
        sendResponse({ status: 'started' });
    }
    return true;
});

async function processPage(sourceLang: string, targetLang: string) {
    const images = Array.from(document.querySelectorAll('img'));
    // Filter small images/icons
    const largeImages = images.filter(img => img.width > 300 && img.height > 300);

    console.log(`Found ${largeImages.length} images to translate.`);

    for (const img of largeImages) {
        await processImage(img, sourceLang, targetLang);
    }
}

async function processImage(img: HTMLImageElement, sourceLang: string, targetLang: string) {
    // Create overlay container
    const overlay = document.createElement('div');
    overlay.className = 'manga-tl-overlay';
    overlay.style.position = 'absolute';

    const rect = img.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    overlay.style.top = `${rect.top + scrollTop}px`;
    overlay.style.left = `${rect.left + scrollLeft}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;
    overlay.style.pointerEvents = 'none';
    overlay.style.zIndex = '9999';
    overlay.style.border = '2px solid #a855f7'; // Purple border to show detection

    document.body.appendChild(overlay);

    try {
        console.log('Processing image:', img.src);
        // Fetch image as blob to avoid CORS issues if possible (requires permissions)
        // Or just pass URL if Tesseract handles it (it does if CORS allows)
        // Better to fetch it ourselves.
        const response = await fetch(img.src);
        const blob = await response.blob();
        const imageUrl = URL.createObjectURL(blob);

        // 1. OCR
        const ocrResult = await performOCR(imageUrl, sourceLang);

        // 2. Process blocks
        // Tesseract blocks might be too large (paragraphs). We might want lines or words.
        // blocks -> paragraphs -> lines.
        // Let's iterate over paragraphs or lines.

        // Using paragraphs for now
        if (ocrResult && ocrResult.blocks) {
            for (const block of ocrResult.blocks) {
                if (block.confidence < 50) continue; // Skip low confidence

                const bbox = block.bbox;
                const scaleX = img.width / img.naturalWidth;
                const scaleY = img.height / img.naturalHeight;

                const box = document.createElement('div');
                box.style.position = 'absolute';
                box.style.left = `${bbox.x0 * scaleX}px`;
                box.style.top = `${bbox.y0 * scaleY}px`;
                box.style.width = `${(bbox.x1 - bbox.x0) * scaleX}px`;
                box.style.height = `${(bbox.y1 - bbox.y0) * scaleY}px`;
                box.style.backgroundColor = 'white';
                box.style.color = 'black';
                box.style.fontSize = '14px';
                box.style.fontFamily = 'Comic Sans MS, sans-serif'; // Manga style
                box.style.fontWeight = 'bold';
                box.style.display = 'flex';
                box.style.alignItems = 'center';
                box.style.justifyContent = 'center';
                box.style.textAlign = 'center';
                box.style.zIndex = '10000';
                box.style.padding = '2px';
                box.style.boxSizing = 'border-box';
                box.style.lineHeight = '1.2';
                box.style.pointerEvents = 'auto'; // Allow selecting text
                box.innerText = '...'; // Loading

                overlay.appendChild(box);

                // 3. Translate
                // Clean text (remove newlines etc)
                const cleanText = block.text.replace(/\s+/g, ' ').trim();
                if (cleanText.length > 0) {
                    const translatedText = await translateText(cleanText, sourceLang, targetLang);
                    box.innerText = translatedText;
                } else {
                    box.remove();
                }
            }
        }

        URL.revokeObjectURL(imageUrl);

    } catch (e) {
        console.error('Translation failed for image', e);
        overlay.style.borderColor = 'red';
    }
}
