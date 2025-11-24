console.log('Manga Translator Background Script Loaded');

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === 'TRANSLATE_REMOTE') {
        const { text, source, target } = request.payload;

        const body = {
            q: text,
            source,
            target,
            format: 'text',
            api_key: '',
        };

        fetch('https://libretranslate.de/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        })
            .then(async response => {
                if (!response.ok) {
                    throw new Error(`LibreTranslate HTTP ${response.status}`);
                }
                const contentType = response.headers.get('content-type') || '';
                const textResp = await response.text();
                if (!contentType.includes('application/json')) {
                    throw new Error('LibreTranslate returned non-JSON response');
                }
                const data = JSON.parse(textResp);
                sendResponse({ success: true, data: data.translatedText });
            })
            .catch(error => {
                console.warn('Remote translation failed:', error?.message || error);
                sendResponse({ success: false, error: error?.message });
            });

        return true; // Will respond asynchronously
    }
});
