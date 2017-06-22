const _ = require('underscore');
const Apify = require('apify');
const request = require('request');
const async = require('async');
const URL = require('url');
const typeCheck = require('type-check').typeCheck;

/*

 Crawls a list of URLs and executes a JavaScript page function on each of them.

 The act accepts input of application/json content type with the following body:

 {
 // Array of URLs to open by the browser.
 "urls": [String],

 // Mandatory JavaScript code executed in the context of each web page.
 "script": String,

 // Array of URLs to proxy servers. The proxies are picked randomly from this list.
 // By default no proxies are used.
 "proxyUrls": [String],

 // Array of User-Agent HTTP headers. The user agent is picked randomly from this list.
 // By default the user agent is left for the browser to determine.
 "userAgents": [String],

 // Number of parallel web browsers. By default 1.
 "concurrency": Number,

 // Number of seconds to wait for the page to be loaded. By default 0.
 "sleepSecs": Number,

 // If true, the act doesn't start Chrome but uses simple HTTP request to
 // only get the initial HTML of the page. The HTML is stored
 "rawHtmlOnly": Boolean,
 }

 The state of the crawler and results are stored as application/json object into the default key-value store, under the following keys:

 STATE
 {
 // Dictionary of URLs that have already been crawled,
 // key is the URL, value is the key under which the results are stored.
 urlToResultKey: {
 "http://www.example.com" : "RESULTS-001"
 }
 }

 RESULTS-XXX
 {
 pages: [{
 url: "http://www.example.com",
 loadedUrl: String,
 loadingStartedAt: Date,
 loadingFinishedAt: Date,
 scriptResult: {},
 proxyUrl: String,
 html: String, // Only if "rawHtmlOnly" is set
 }]
 }

 */

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
