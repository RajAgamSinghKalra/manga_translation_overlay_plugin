/// <reference types="chrome" />
import { pipeline, env } from '@xenova/transformers';
import Tesseract from 'tesseract.js';

// Configure Transformers.js
env.allowLocalModels = false;
env.useBrowserCache = true;

let translator: any = null;

const LANG_MAP: Record<string, string> = {
    'jp': 'jpn_Jpan',
    'en': 'eng_Latn',
    'kr': 'kor_Hang',
    'cn': 'zho_Hans',
    'fr': 'fra_Latn',
    'es': 'spa_Latn',
};

export async function initTranslator() {
    if (!translator) {
        console.log('Loading translation model...');
        translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M');
        console.log('Translation model loaded.');
    }
    return translator;
}

export async function translateText(text: string, source: string, target: string) {
    const model = await initTranslator();
    const srcLang = LANG_MAP[source] || source;
    const tgtLang = LANG_MAP[target] || target;

    console.log(`Translating from ${srcLang} to ${tgtLang}: ${text}`);

    const output = await model(text, {
        src_lang: srcLang,
        tgt_lang: tgtLang,
    });

    return output[0].translation_text;
}

export async function performOCR(imageBlob: Blob | string, lang: string = 'jpn') {
    console.log(`Performing OCR (${lang})...`);

    const worker = await Tesseract.createWorker(lang, 1, {
        workerPath: chrome.runtime.getURL('tesseract/worker.min.js'),
        corePath: chrome.runtime.getURL('tesseract/tesseract-core.wasm.js'),
        logger: m => console.log(m),
    });

    const ret = await worker.recognize(imageBlob);
    console.log('OCR Complete', ret.data);
    await worker.terminate();
    return ret.data;
}
