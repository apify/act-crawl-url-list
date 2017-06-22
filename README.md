# act-crawl-url-list

Apify act to crawl a list of URLs and executes a JavaScript page function on each of them.

The act accepts input of application/json content type with the following body:

```javascript
{
    // Array of URLs to open by the browser.
    "urls": [String],

    // URL to a text file containing list of URLs to crawl. Each URL needs to be on a separate line.
    "urlToTextFileWithUrls": String,

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
```

The state of the crawler and results are stored as application/json object into the default key-value store, under the following keys:

**STATE**

```javascript
{
    // Dictionary of URLs that have already been crawled,
    // key is the URL, value is the key under which the results are stored.
    urlToResultKey: {
        "http://www.example.com" : "RESULTS-001"
    }
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
        proxyUrl: String,
        html: String, // Only if "rawHtmlOnly" is set
    }]
}
```