const URL = require('url');
const _ = require('underscore');
const Apify = require('apify');
const request = require('request');
const async = require('async');
const typeCheck = require('type-check').typeCheck;
const leftPad = require('left-pad');

// TODO: save screenshots to kv-store

// Definition of the input
const INPUT_TYPE = `{
    urls: Maybe [String],
    urlToTextFileWithUrls: Maybe String,
    script: Maybe String,
    asyncScript: Maybe String,
    proxyUrls: Maybe [String],
    userAgents: Maybe [String],
    concurrency: Maybe Number,
    sleepSecs: Maybe Number,
    rawHtmlOnly: Maybe Boolean,
    storePagesInterval: Maybe Number
}`;

const DEFAULT_STATE = {
    storeCount: 0,
    pageCount: 0,
};

// Returns random array element, or null if array is empty, null or undefined.
const getRandomElement = (array) => {
    if (!array || !array.length) return null;
    return array[Math.floor(Math.random() * array.length)];
};

const requestPromised = async (opts) => {
    return new Promise((resolve, reject) => {
        request(opts, (error, response, body) => {
            if (error) return reject(error);
            resolve(body);
        });
    });
};

const redactProxyUrl = (url) => {
    if (!url) return url;
    const parsed = URL.parse(url);
    return `${parsed.scheme}//${parsed.auth ? '<redacted>@' : ''}${parsed.host}`;
};


// Objects holding the state of the crawler, which is stored under 'STATE' key in the KV store
let state;

// Array of Page records that were finished but not yet stored to KV store
const finishedPages = [];

// Date when state and data was last stored
let lastStoredAt = new Date();

let isStoring = false;

let storePagesInterval = 10;

// If there's a long enough time since the last storing,
// stores finished pages and the current state to the KV store.
const maybeStoreData = async (force) => {
    // Is there anything to store?
    if (finishedPages.length === 0) return;

    // Is it long enough time since the last storing?
    if (!force && finishedPages.length < storePagesInterval) return;

    // Isn't some other worker storing data?
    if (isStoring) return;
    isStoring = true;

    try {
        // Store buffered pages to store under key PAGES-XXX
        // Careful here, finishedPages array might be added more elements while awaiting setValue()
        const pagesToStore = _.clone(finishedPages);
        const key = `PAGES-${leftPad(state.storeCount+1, 9, '0')}`;

        console.log(`Storing ${pagesToStore.length} pages to ${key} (total pages crawled: ${state.pageCount + pagesToStore.length})`);
        await Apify.setValue(key, pagesToStore);

        finishedPages.splice(0, pagesToStore.length);

        // Update and save state (but only after saving pages!)
        state.pageCount += pagesToStore.length;
        state.storeCount++;
        await Apify.setValue('STATE', state);

        lastStoredAt = new Date();
    } catch(e) {
        if (force) throw e;
        console.log(`ERROR: Cannot store data (will be ignored): ${e.stack || e}`);
    } finally {
        isStoring = false;
    }
};


Apify.main(async () => {
    // Fetch and check the input
    const input = await Apify.getValue('INPUT');
    if (!typeCheck(INPUT_TYPE, input)) {
        console.log('Expected input:');
        console.log(INPUT_TYPE);
        console.log('Received input:');
        console.dir(input);
        throw new Error("Received invalid input");
    }

    // Get list of URLs from an external text file and add valid URLs to input.urls
    input.urls = input.urls || [];
    if (input.urlToTextFileWithUrls) {
        console.log(`Fetching text file from ${input.urlToTextFileWithUrls}`);
        const textFile = await requestPromised({ url: input.urlToTextFileWithUrls });
        console.log(`Processing URLs from text file (length: ${textFile.length})`);
        let count = 0;
        textFile.split('\n').forEach((url) => {
            url = url.trim();
            const parsed = URL.parse(url);
            if (parsed.host) {
                count++;
                input.urls.push(url);
            }
        });
        console.log(`Added ${count} URLs from the text file`);
    }

    if (input.storePagesInterval > 0) storePagesInterval = input.storePagesInterval;

    // Get the state of crawling (the act might have been restarted)
    state = await Apify.getValue('STATE') || DEFAULT_STATE;

    // Worker function, it crawls one URL from the list
    const workerFunc = async (url) => {
        const proxyUrl = getRandomElement(input.proxyUrls);

        const page = {
            url,
            loadingStartedAt: new Date(),
            userAgent: getRandomElement(input.userAgents),
            redactedProxyUrl: redactProxyUrl(proxyUrl),
        };
        let browser;

        try {
            console.log(`Loading page: ${url}`);

            if (input.rawHtmlOnly) {
                // Open web page using request()
                const opts = {
                    url,
                    headers: page.userAgent ? { 'User-Agent': page.userAgent } : null,
                    proxy: proxyUrl,
                };

                page.html = await requestPromised(opts);
                page.loadingFinishedAt = new Date();
                page.loadedUrl = url;
                page.scriptResult = null;
            } else {
                // Open web page using Chrome
                const opts = _.pick(page, 'url', 'userAgent');
                opts.proxyUrl = proxyUrl;
                browser = await Apify.browse(opts);

                page.loadingFinishedAt = new Date();

                // Wait for page to load
                if (input.sleepSecs > 0) {
                    await browser.webDriver.sleep(1000 * input.sleepSecs);
                }

                page.loadedUrl = await browser.webDriver.getCurrentUrl();

                // Run sync script to get data
                if (input.script) {
                    page.scriptResult = await browser.webDriver.executeScript(input.script);
                } else {
                    page.scriptResult = null;
                }

                // Run async script to get data
                if (input.asyncScript) {
                    page.asyncScriptResult = await browser.webDriver.executeAsyncScript(input.asyncScript);
                } else {
                    page.asyncScriptResult = null;
                }
            }
        } catch (e) {
            console.log(`Loading of web page failed (${url}): ${e}`);
            page.errorInfo = e.stack || e.message || e;
        } finally {
            if (browser) browser.close();
        }

        // const pageForLog = _.pick(page, 'url', 'proxyUrl', 'userAgent', 'loadingStartedAt', 'loadingFinishedAt');
        // pageForLog.htmlLength = page.html ? page.html.length : null;
        // console.log(`Finished page: ${JSON.stringify(pageForLog, null, 2)}`);
        console.log(`Finished page: ${page.url}`);

        finishedPages.push(page);
        await maybeStoreData();
    };

    const urlFinishedCallback = (err) => {
        if (err) console.log(`WARNING: Unhandled exception from worker function: ${err.stack || err}`);
    };

    const q = async.queue(workerFunc, input.concurrency > 0 ? input.concurrency : 1);

    // Push all not-yet-crawled URLs to to the queue
    if (state.pageCount > 0) {
        console.log(`Skipping first ${state.pageCount} pages that were already crawled`);
        input.urls.splice(0, state.pageCount);
    }
    input.urls.forEach((url) => {
        q.push(url, urlFinishedCallback);
    });

    // Wait for the queue to finish all tasks
    await new Promise((resolve) => {
        q.drain = resolve;
    });

    await maybeStoreData(true);
});
