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
            .then(response => {
                if (!response.ok) {
                    throw new Error(`LibreTranslate HTTP ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                sendResponse({ success: true, data: data.translatedText });
            })
            .catch(error => {
                console.error('Remote translation failed:', error);
                sendResponse({ success: false, error: error.message });
            });

        return true; // Will respond asynchronously
    }
});
