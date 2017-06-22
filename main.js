const _ = require('underscore');
const Apify = require('apify');
const request = require('request');
const async = require('async');
const URL = require('url');
const typeCheck = require('type-check').typeCheck;

// TODO: save screenshots to kv-store

// Definition of the input
const INPUT_TYPE = `{
    urls: Maybe [String],
    urlToTextFileWithUrls: Maybe String,
    script: Maybe String,
    proxyUrls: Maybe [String],
    userAgents: Maybe [String],
    concurrency: Maybe Number,
    sleepSecs: Maybe Number,
    rawHtmlOnly: Maybe Boolean
}`;

// Returns random array element, or null if array is empty, null or undefined.
const getRandomElement = (array) => {
    if (!array || !array.length) return null;
    return array[Math.floor(Math.random() * array.length)];
};

Apify.main( async () => {
    // Fetch and check the input
    const input = await Apify.getValue('INPUT');
    if (!typeCheck(INPUT_TYPE, input)) {
        console.log('Expected input:');
        console.log(INPUT_TYPE);
        console.log('Received input:');
        console.dir(input);
        throw new Error("Received innvalid input");
    }

    // Get list of URLs from an external text file and add valid URLs to input.urls
    input.urls = input.urls || [];
    if (input.urlToTextFileWithUrls) {
        const textFile = await request(input.urlToTextFileWithUrls);
        textFile.split('\n').forEach((url) => {
            url = url.trim();
            const parsed = URL.parse(url);
            if (parsed.host) input.urls.push(url);
        });
    }

    // Get the state of crawling (the act might have been restarted)
    const state = await Apify.getValue('STATE') || { urlToResultKey: {} };

    // Worker function, it crawls one URL from the list
    const workerFunc = async (url) => {
        const page = {
            url,
            loadingStartedAt: new Date(),
            userAgent: getRandomElement(input.userAgents),
            proxyUrl: getRandomElement(input.proxyUrls),
        };
        let browser;

        try {
            if (input.rawHtmlOnly) {
                // Open web page using request()
                const opts = {
                    url,
                    headers: page.userAgent ? { 'User-Agent': page.userAgent } : null,
                    proxy: page.proxyUrl,
                };
                const result = await new Promise((resolve, reject) => {
                    request(url, (error, response, body) => {
                        if (error) return reject(error);
                        resolve({ response, body });
                    });
                });

                page.html = result.body;
                page.loadingFinishedAt = new Date();
                page.loadedUrl = url;
                page.scriptResult = null;
            } else {
                // Open web page using Chrome
                console.log(`Loading web page: ${url}`);
                const opts = _.pick(page, 'url', 'userAgent', 'proxyUrl');
                browser = await Apify.browse(opts);

                page.loadingFinishedAt = new Date();

                // Wait for page to load
                if (input.sleepSecs > 0) {
                    await browser.webDriver.sleep(1000 * input.sleepSecs);
                }

                // Run script to get data
                page.loadedUrl = await browser.webDriver.getCurrentUrl();
                if (input.script) {
                    page.scriptResult = await browser.webDriver.executeScript(input.script);
                } else {
                    page.scriptResult = null;
                }
            }
        } catch (e) {
            console.log(`Loading of web page failed (${url}): ${e}`);
            page.errorInfo = e.stack || e.message || e;
        } finally {
            if (browser) browser.close();
        }

        // TODO: Store page,
        //
        console.dir(page);

        state.urlToResultKey[url] = page;
    };

    const urlFinishedCallback = (err) => {
        if (err) console.log(`WARNING: Unhandled exception from worker function: ${err.stack || err}`);
    };

    const q = async.queue(workerFunc, input.concurrency > 0 ? input.concurrency : 1);

    // Push all not-yet-crawled URLs to to the queue
    input.urls.forEach((url) => {
        if (!state.urlToResultKey[url]) {
            q.push(url, urlFinishedCallback);
        }
    });

    // Wait for the queue to finish all tasks
    await new Promise((resolve, reject) => {
        q.drain = resolve;
    });
});
