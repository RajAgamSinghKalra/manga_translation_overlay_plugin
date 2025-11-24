/// <reference types="chrome" />
import { pipeline, env } from '@xenova/transformers';
import Tesseract from 'tesseract.js';

// Configure Transformers.js to use browser cache for models (only used as a last-resort fallback)
env.useBrowserCache = true;
// Rely on remote hosted models (HuggingFace) so we don't accidentally try to
// pull relative to the website (eg: https://<page>/models/...)
env.allowLocalModels = false;
// Prefer a small, fast WASM setup (SIMD + multi-thread) for CPU speed; fallback gracefully if not supported.
if (env.backends?.onnx?.wasm) {
    // Force single-threaded WASM to avoid SharedArrayBuffer/worker import issues in MV3.
    const threads = 1;
    env.backends.onnx.wasm.numThreads = threads;
    env.backends.onnx.wasm.simd = true;
    // Avoid the worker proxy to reduce overhead on small models.
    env.backends.onnx.wasm.proxy = false;
}
// Suppress noisy ONNXRuntime warnings about pruned initializers; keep real errors visible.
if (env.backends?.onnx) {
    env.backends.onnx.logLevel = 'fatal';
}

// Don't set cacheDir - let Transformers.js handle caching via IndexedDB/Cache API

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const translatorCache: Record<string, any> = {};

const LANG_MAP: Record<string, string> = {
    // Normalize incoming codes to short ISO variants for model selection
    jp: 'ja',
    ja: 'ja',
    en: 'en',
    kr: 'ko',
    ko: 'ko',
    cn: 'zh',
    zh: 'zh',
    fr: 'fr',
    es: 'es',
};

// Use tiny bilingual Marian models (quantized) for speed/CPU-only usage.
// These are far smaller than M2M100 and start up much faster in-browser.
const MODEL_MAP: Record<string, string> = {
    'ja->en': 'Xenova/opus-mt-ja-en',
    'en->ja': 'Xenova/opus-mt-en-ja',
    'ko->en': 'Xenova/opus-mt-ko-en',
    'en->ko': 'Xenova/opus-mt-en-ko',
    'zh->en': 'Xenova/opus-mt-zh-en',
    'en->zh': 'Xenova/opus-mt-en-zh',
};

// Fallback covers any other language pairs (bigger, but more general)
const FALLBACK_MODEL = 'Xenova/m2m100_418M';

function normalizeLang(code: string) {
    return LANG_MAP[code] || code;
}

function getModelId(src: string, tgt: string) {
    const key = `${src}->${tgt}`;
    return MODEL_MAP[key] || FALLBACK_MODEL;
}

export async function initTranslator(source = 'ja', target = 'en') {
    // Only used if remote translation fails; avoid initializing by default to spare GPU/CPU.
    const src = normalizeLang(source);
    const tgt = normalizeLang(target);
    const modelId = getModelId(src, tgt);

    if (translatorCache[modelId]) return translatorCache[modelId];

    console.log(`Loading local translation model (${modelId}) for ${src} -> ${tgt}...`);
    translatorCache[modelId] = await pipeline('translation', modelId, {
        quantized: true, // prefer smaller weights for CPU/WebAssembly
    });
    console.log(`Local model loaded: ${modelId}`);
    return translatorCache[modelId];
}

export async function translateText(text: string, source: string, target: string) {
    try {
        const srcLang = normalizeLang(source);
        const tgtLang = normalizeLang(target);

        console.log(`Translating from ${srcLang} to ${tgtLang}: "${text}"`);

        // Input Sanitization: Don't even try to translate garbage
        if (text.includes('SQ of the') || text.includes('The SQ')) {
            console.warn('Skipping translation of known hallucination pattern:', text);
            return null;
        }

        // Prefer free remote translator to avoid local GPU/CPU.
        try {
            const remote = await translateViaLibre(text, srcLang, tgtLang);
            if (remote) return remote;
        } catch (remoteErr) {
            console.warn('Remote translation failed, trying local fallback...', remoteErr);
        }

        // Fallback to local model only if remote fails.
        const model = await initTranslator(srcLang, tgtLang);
        const output = await model(text);
        console.log('Translation output (local fallback):', output);

        let translated = output[0].translation_text;

        // Check for repetition loops (e.g. "The SQ of the SQ of the SQ")
        if (translated.length > 50) {
            // 1. Check for simple repeated halves
            const words = translated.split(' ');
            const half = Math.floor(words.length / 2);
            if (words.length > 10) {
                const firstHalf = words.slice(0, half).join(' ');
                const secondHalf = words.slice(half, half * 2).join(' ');
                if (firstHalf === secondHalf) return null;
            }

            // 2. Check for repeating n-grams (more robust)
            // Look for any 4-word sequence that appears 3 or more times
            if (words.length > 12) {
                for (let i = 0; i < words.length - 4; i++) {
                    const chunk = words.slice(i, i + 4).join(' ');
                    const matches = translated.split(chunk).length - 1;
                    if (matches >= 3) {
                        console.warn('Detected translation loop (n-gram), discarding:', translated);
                        return null;
                    }
                }
            }
        }

        return translated;
    } catch (error) {
        console.error('Translation error:', error);
        throw error;
    }
}

async function translateViaLibre(text: string, source: string, target: string): Promise<string | null> {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({
            action: 'TRANSLATE_REMOTE',
            payload: { text, source, target }
        }, (response) => {
            if (chrome.runtime.lastError) return resolve(null);
            if (response && response.success) return resolve(response.data);
            resolve(null);
        });
    });
}

const TESS_LANG_MAP: Record<string, string> = {
    jp: 'jpn',
    ja: 'jpn',
    en: 'eng',
    cn: 'chi_sim',
    zh: 'chi_sim',
    kr: 'kor',
    ko: 'kor',
};

export async function performOCR(imageBlob: Blob | string, lang: string = 'jpn') {
    const tessLang = TESS_LANG_MAP[lang] || lang || 'eng';
    console.log(`Performing OCR (${tessLang})...`);

    // If we're running on an extension page (chrome-extension://), use packaged assets.
    // On normal webpages, use CDN to avoid cross-origin worker restrictions.
    const isExtensionPage = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';

    const packagedConfig = {
        workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('tesseract/tesseract-core.wasm.js'),
        langPath: chrome.runtime.getURL('tesseract/lang-data'),
        gzip: false,
        workerBlobURL: false,
    };

    const cdnConfig = {
        workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/worker.min.js',
        corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@4.0.3/tesseract-core.wasm.js',
        langPath: 'https://tessdata.projectnaptha.com/4.0.0',
        gzip: true,
        workerBlobURL: true,
    };

    const primaryConfig = isExtensionPage ? packagedConfig : cdnConfig;
    const secondaryConfig = isExtensionPage ? cdnConfig : packagedConfig;

    try {
        const worker = await createTessWorker(tessLang, primaryConfig);
        const ret = await worker.recognize(imageBlob);
        console.log('OCR Complete', ret.data);
        await worker.terminate();
        return ret.data;
    } catch (primaryError) {
        console.warn('Primary OCR worker failed, retrying with alternate assets...', primaryError);
        const worker = await createTessWorker(tessLang, secondaryConfig);
        const ret = await worker.recognize(imageBlob);
        console.log('OCR Complete (fallback)', ret.data);
        await worker.terminate();
        return ret.data;
    }
}

async function createTessWorker(tessLang: string, paths: { workerPath: string; corePath: string; langPath: string; gzip: boolean; workerBlobURL: boolean; }) {
    const worker = await Tesseract.createWorker(tessLang, 1, {
        ...paths,
        logger: m => console.log(m),
    });

    await worker.setParameters({
        // Sparse multi-block detection without auto-rotation; keeps bbox coordinates aligned to the source image.
        tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
    });

    return worker;
}

export async function isModelReady(): Promise<boolean> {
    return Object.keys(translatorCache).length > 0;
}

export async function forceDownloadModel(): Promise<void> {
    // Clear any existing model references
    for (const key of Object.keys(translatorCache)) {
        delete translatorCache[key];
    }
    // Temporarily disable local model caching to force fresh download
    const previousAllowLocal = env.allowLocalModels;
    env.allowLocalModels = false;
    try {
        await initTranslator();
    } finally {
        env.allowLocalModels = previousAllowLocal;
    }
}
