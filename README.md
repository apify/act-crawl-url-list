# act-crawl-url-list

Apify act to crawl a list of URLs and executes a JavaScript page function on each of them.

The act accepts input of application/json content type with the following body:

**INPUT**

```javascript
{
    // Array of URLs to open by the browser.
    urls: [String],

    // URL to a text file containing list of URLs to crawl. Each URL needs to be on a separate line.
    urlToTextFileWithUrls: String,

    // Synchronous JavaScript code executed in the context of each web page,
    // See http://seleniumhq.github.io/selenium/docs/api/javascript/module/selenium-webdriver/index_exports_WebDriver.html#executeScript
    script: String,

    // Asynchronous JavaScript code executed in the context of each web page,
    // See http://seleniumhq.github.io/selenium/docs/api/javascript/module/selenium-webdriver/index_exports_WebDriver.html#executeAsyncScript
    asyncScript: String,

    // Array of URLs to proxy servers. The proxies are picked randomly from this list.
    // By default no proxies are used.
    proxyUrls: [String],

    // Array of User-Agent HTTP headers. The user agent is picked randomly from this list.
    // By default the user agent is left for the browser to determine.
    userAgents: [String],

    // Number of parallel web browsers. By default 1.
    concurrency: Number,

    // Number of seconds to wait for the page to be loaded. By default 0.
    sleepSecs: Number,

    // If true, the act doesn't start Chrome but uses simple HTTP request to
    // only get the initial HTML of the page. The HTML is stored
    rawHtmlOnly: Boolean,

    // How many pages will be buffered before they are stored to the key-value store.
    // If you use low value, there will be a lot of files small files in the storage, but on restart
    // not much work will be repeated. With high value, the files in storage will be large.
    // By default 10.
    storePagesInterval: Number,
}
```

The state of the crawler and results are stored as application/json object into the default key-value store, under the following keys:

**STATE**

```javascript
{
    storeCount: 0,
    pageCount: 0,
}
```

**RESULTS-XXX**
```javascript
{
    pages: [{
        url: "http://www.example.com",
        loadedUrl: String,
        loadingStartedAt: Date,
        loadingFinishedAt: Date,
        scriptResult: {},
        asyncScriptResult: {},
        proxyUrl: String,
        html: String, // Only if "rawHtmlOnly" is set
    }]
}
```


Example inputs:

```javascript
{
    "urls": [
        "https://www.example.com"
    ],
    "script": "return document.documentElement.innerHTML",
    "userAgents": ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.32 Safari/537.36"]
}
```