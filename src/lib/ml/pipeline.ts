/// <reference types="chrome" />
import { pipeline, env } from '@xenova/transformers';
import Tesseract from 'tesseract.js';

// Configure Transformers.js to use browser cache for models
env.useBrowserCache = true;
// Rely on remote hosted models (HuggingFace) so we don't accidentally try to
// pull relative to the website (eg: https://<page>/models/...)
env.allowLocalModels = false;
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
    if (!translator) {
        try {
            console.log('Loading translation model (m2m100_418M - lighter & faster)...');
            console.log('This may download ~160MB on first use, please wait...');

            // Use a smaller, faster model that's better for browser use
            // m2m100_418M is much smaller than nllb (160MB vs 600MB)
            translator = await pipeline('translation', 'Xenova/m2m100_418M');

            console.log('Translation model loaded successfully!');
        } catch (error) {
            console.error('Failed to load translation model:', error);
            throw error;
        }
    }
    return translator;
}

export async function translateText(text: string, source: string, target: string) {
    try {
        console.log('Initializing translator...');
        const model = await initTranslator();
        console.log('Translator initialized.');

        const srcLang = LANG_MAP[source] || source;
        const tgtLang = LANG_MAP[target] || target;

        console.log(`Translating from ${srcLang} to ${tgtLang}: "${text}"`);

        const output = await model(text, {
            src_lang: srcLang,
            tgt_lang: tgtLang,
        });

        console.log('Translation output:', output);
        return output[0].translation_text;
    } catch (error) {
        console.error('Translation error:', error);
        throw error;
    }
}

export async function performOCR(imageBlob: Blob | string, lang: string = 'jpn') {
    console.log(`Performing OCR (${lang})...`);

    try {
        const worker = await Tesseract.createWorker(lang, 1, {
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
