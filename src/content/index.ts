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
        console.log('OCR Result:', ocrResult);

        // 2. Check if we got any text
        if (!ocrResult || !ocrResult.text || ocrResult.text.trim().length === 0) {
            console.log('No text detected in image');
            URL.revokeObjectURL(imageUrl);
            return;
        }

        // 3. Translate the full text
        console.log('Translating text...');
        const cleanText = ocrResult.text.replace(/\s+/g, ' ').trim();
        console.log('Clean text to translate:', cleanText);

        let translatedText: string;
        try {
            translatedText = await translateText(cleanText, sourceLang, targetLang);
            console.log('Translation complete:', translatedText);
        } catch (error) {
            console.error('Translation failed:', error);
            URL.revokeObjectURL(imageUrl);
            return;
        }

        // 4. Display as a simple overlay
        const box = document.createElement('div');
        box.style.position = 'absolute';
        box.style.left = '10px';
        box.style.top = '10px';
        box.style.right = '10px';
        box.style.backgroundColor = 'rgba(255, 255, 255, 0.9)';
        box.style.color = 'black';
        box.style.fontSize = '14px';
        box.style.fontFamily = 'Arial, sans-serif';
        box.style.fontWeight = 'bold';
        box.style.padding = '10px';
        box.style.zIndex = '10000';
        box.style.borderRadius = '5px';
        box.style.boxShadow = '0 2px 8px rgba(0,0,0,0.3)';
        box.style.maxHeight = 'calc(100% - 20px)';
        box.style.overflow = 'auto';
        box.innerText = translatedText;

        overlay.appendChild(box);
        URL.revokeObjectURL(imageUrl);

    } catch (e) {
        console.error('Translation failed for image', e);
        overlay.style.borderColor = 'red';
    }
}
