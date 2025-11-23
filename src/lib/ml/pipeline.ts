/// <reference types="chrome" />
import { pipeline, env } from '@xenova/transformers';
import Tesseract from 'tesseract.js';

// Configure Transformers.js to use browser cache for models (only used as a last-resort fallback)
env.useBrowserCache = true;
// Rely on remote hosted models (HuggingFace) so we don't accidentally try to
// pull relative to the website (eg: https://<page>/models/...)
env.allowLocalModels = false;
// Suppress noisy ONNXRuntime warnings about pruned initializers; keep real errors visible.
if (env.backends?.onnx) {
    env.backends.onnx.logLevel = 'fatal';
}

// Don't set cacheDir - let Transformers.js handle caching via IndexedDB/Cache API

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let translator: any = null;

const LANG_MAP: Record<string, string> = {
    // m2m100 expects short ISO codes (not _Latn variants)
    'jp': 'ja',
    'ja': 'ja',
    'en': 'en',
    'kr': 'ko',
    'ko': 'ko',
    'cn': 'zh',
    'zh': 'zh',
    'fr': 'fr',
    'es': 'es',
};

export async function initTranslator() {
    // Only used if remote translation fails; avoid initializing by default to spare GPU/CPU.
    if (translator) return translator;
    console.log('Loading local fallback translation model (only if remote fails)...');
    translator = await pipeline('translation', 'Xenova/m2m100_418M');
    console.log('Local fallback model loaded.');
    return translator;
}

export async function translateText(text: string, source: string, target: string) {
    try {
        const srcLang = LANG_MAP[source] || source;
        const tgtLang = LANG_MAP[target] || target;

        console.log(`Translating from ${srcLang} to ${tgtLang}: "${text}"`);

        // Prefer free remote translator to avoid local GPU/CPU.
        try {
            const remote = await translateViaLibre(text, srcLang, tgtLang);
            if (remote) return remote;
        } catch (remoteErr) {
            console.warn('Remote translation failed, trying local fallback...', remoteErr);
        }

        // Fallback to local model only if remote fails.
        const model = await initTranslator();
        const output = await model(text, {
            src_lang: srcLang,
            tgt_lang: tgtLang,
        });
        console.log('Translation output (local fallback):', output);
        return output[0].translation_text;
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
            if (chrome.runtime.lastError) {
                console.warn('Background script not reachable:', chrome.runtime.lastError);
                resolve(null);
                return;
            }
            if (response && response.success) {
                resolve(response.data);
            } else {
                console.warn('Remote translation error:', response?.error);
                resolve(null);
            }
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

    try {
        const worker = await Tesseract.createWorker(tessLang, 1, {
            workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
            corePath: chrome.runtime.getURL('tesseract/tesseract-core.wasm.js'),
            langPath: chrome.runtime.getURL('tesseract/lang-data'),
            gzip: false, // Use local uncompressed files, don't try to fetch .gz from CDN
            logger: m => console.log(m),
        });

        // Configure Tesseract to extract detailed layout information
        await worker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.AUTO, // Auto page segmentation with OSD
        });

        const ret = await worker.recognize(imageBlob);
        console.log('OCR Complete', ret.data);
        await worker.terminate();
        return ret.data;
    } catch (error) {
        console.error('OCR Error:', error);
        console.error('Worker path:', chrome.runtime.getURL('tesseract/worker.min.js'));
        console.error('Core path:', chrome.runtime.getURL('tesseract/tesseract-core.wasm.js'));
        console.error('Lang path:', chrome.runtime.getURL('tesseract/lang-data'));
        throw error;
    }
}

export async function isModelReady(): Promise<boolean> {
    return translator !== null;
}

export async function forceDownloadModel(): Promise<void> {
    // Clear any existing model reference
    translator = null;
    // Temporarily disable local model caching to force fresh download
    const previousAllowLocal = env.allowLocalModels;
    env.allowLocalModels = false;
    try {
        await initTranslator();
    } finally {
        env.allowLocalModels = previousAllowLocal;
    }
}
