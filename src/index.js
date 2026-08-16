import { DurableObject } from "cloudflare:workers";
import * as puppeteer from "@cloudflare/puppeteer";

const LOCATION_ID = "zyhFEkFNE1Eo2O7I8nOP";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function controlPage() {
  return new Response(`
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>CGA HighLevel Browser</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 0 20px;
    }

    input {
      width: 100%;
      padding: 10px;
      box-sizing: border-box;
      margin: 10px 0 20px;
    }

    button {
      padding: 12px 16px;
      margin: 5px;
      cursor: pointer;
    }

    pre {
      background: #f4f4f4;
      padding: 15px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>

<body>

<h1>CGA HighLevel Browser</h1>

<p>
Uses the authenticated Cloudflare Browser Run session directly.
</p>

<label><strong>Browser Admin Key</strong></label>

<input
  id="key"
  type="password"
  placeholder="Enter BROWSER_ADMIN_KEY"
/>

<h3>Browser</h3>

<button onclick="run('/api/login/start')">
Start Login Browser
</button>

<button onclick="run('/api/status')">
Check Status
</button>

<h3>HighLevel</h3>

<button onclick="run('/api/inspect-current')">
Inspect Logged-In HighLevel
</button>

<button onclick="run('/api/sites/inspect')">
Open Sites & List Funnels
</button>

<pre id="result">Ready</pre>

<script>
async function run(path) {
  const key = document.getElementById("key").value;
  const result = document.getElementById("result");

  if (!key) {
    result.textContent = "Enter your Browser Admin Key first.";
    return;
  }

  result.textContent = "Working...";

  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "x-admin-key": key
      }
    });

    const data = await response.json();

    result.textContent =
      JSON.stringify(data, null, 2);

  } catch (error) {
    result.textContent =
      String(error);
  }
}
</script>

</body>
</html>
`, {
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

export default {

  async fetch(request, env) {

    const url =
      new URL(request.url);

    if (url.pathname === "/") {
      return controlPage();
    }

    if (
      !url.pathname.startsWith("/api/")
    ) {
      return json(
        { error: "Not found" },
        404
      );
    }

    if (!env.BROWSER_ADMIN_KEY) {
      return json(
        {
          error:
            "BROWSER_ADMIN_KEY is not configured."
        },
        503
      );
    }

    const suppliedKey =
      request.headers.get(
        "x-admin-key"
      );

    if (
      suppliedKey !==
      env.BROWSER_ADMIN_KEY
    ) {
      return json(
        { error: "Unauthorized" },
        401
      );
    }

    if (request.method !== "POST") {
      return json(
        { error: "Method not allowed" },
        405
      );
    }

    const object =
      env.BROWSER_MANAGER.getByName(
        "cga-ghl"
      );

    return object.fetch(request);
  }
};


export class BrowserManager extends DurableObject {

  constructor(state, env) {

    super(state, env);

    this.storage =
      state.storage;

    this.env =
      env;

    this.browser =
      null;
  }


  async startLoginBrowser() {

    if (
      this.browser &&
      this.browser.isConnected()
    ) {
      try {
        await this.browser.close();
      } catch {}
    }

    this.browser =
      await puppeteer.launch(
        this.env.BROWSER,
        {
          keep_alive: 600000
        }
      );

    const pages =
      await this.browser.pages();

    const page =
      pages[0] ||
      await this.browser.newPage();

    await page.goto(
      "https://app.gohighlevel.com/",
      {
        waitUntil:
          "domcontentloaded",
        timeout:
          30000
      }
    );

    const sessionId =
      this.browser.sessionId();

    await this.storage.put(
      "loginSessionId",
      sessionId
    );

    return json({
      status:
        "login-browser-ready",

      sessionId,

      pageUrl:
        page.url(),

      message:
        "Open this exact session in Cloudflare Browser Run Live Sessions and log into HighLevel."
    });
  }


  async connectToLoginBrowser() {

    if (
      this.browser &&
      this.browser.isConnected()
    ) {
      return this.browser;
    }

    const sessionId =
      await this.storage.get(
        "loginSessionId"
      );

    if (!sessionId) {
      return null;
    }

    try {

      this.browser =
        await puppeteer.connect(
          this.env.BROWSER,
          sessionId
        );

      return this.browser;

    } catch {

      return null;

    }
  }


  async inspectPage(page) {

    await page.waitForSelector(
      "body",
      { timeout: 15000 }
    );

    await new Promise(
      resolve =>
        setTimeout(resolve, 2000)
    );

    return await page.evaluate(() => {

      const clean = value =>
        String(value || "")
          .replace(/\\s+/g, " ")
          .trim();

      const bodyText =
        clean(
          document.body?.innerText || ""
        );

      const bodyLower =
        bodyText.toLowerCase();

      const hasPasswordField =
        Boolean(
          document.querySelector(
            'input[type="password"]'
          )
        );

      const signals = [
        "dashboard",
        "conversations",
        "contacts",
        "opportunities",
        "calendars",
        "marketing",
        "automation",
        "sites"
      ];

      const signalCount =
        signals.filter(
          signal =>
            bodyLower.includes(signal)
        ).length;

      const navigation =
        Array.from(
          document.querySelectorAll(
            'a, button, [role="button"], [role="link"]'
          )
        )
        .map(element => ({
          tag:
            element.tagName.toLowerCase(),

          text:
            clean(
              element.innerText ||
              element.textContent ||
              element.getAttribute(
                "aria-label"
              )
            ),

          href:
            element.tagName === "A"
              ? element.href
              : "",

          ariaLabel:
            clean(
              element.getAttribute(
                "aria-label"
              )
            )
        }))
        .filter(item =>
          item.text ||
          item.href ||
          item.ariaLabel
        );

      return {
        title:
          document.title,

        url:
          window.location.href,

        authenticated:
          signalCount >= 2 &&
          !hasPasswordField,

        signalCount,

        bodyPreview:
          bodyText.slice(0, 2500),

        navigation:
          navigation.slice(0, 250)
      };
    });
  }


  async findAuthenticatedPage(browser) {

    const pages =
      await browser.pages();

    for (const page of pages) {

      try {

        const inspection =
          await this.inspectPage(page);

        if (
          inspection.authenticated
        ) {
          return {
            page,
            inspection
          };
        }

      } catch {}
    }

    return null;
  }


  async inspectCurrentHighLevel() {

    const browser =
      await this.connectToLoginBrowser();

    if (!browser) {

      return json(
        {
          status:
            "browser-unavailable",

          message:
            "The authenticated Browser Run session cannot currently be reached."
        },
        409
      );
    }

    const found =
      await this.findAuthenticatedPage(
        browser
      );

    if (!found) {

      return json(
        {
          status:
            "not-authenticated",

          message:
            "No authenticated HighLevel page was found in the current browser session."
        },
        409
      );
    }

    return json({
      status:
        "inspection-success",

      authenticated:
        true,

      sessionId:
        await this.storage.get(
          "loginSessionId"
        ),

      highLevel:
        found.inspection
    });
  }


  async inspectSites() {

    const browser =
      await this.connectToLoginBrowser();

    if (!browser) {

      return json(
        {
          status:
            "browser-unavailable",

          message:
            "The authenticated Browser Run session cannot currently be reached."
        },
        409
      );
    }

    const found =
      await this.findAuthenticatedPage(
        browser
      );

    if (!found) {

      return json(
        {
          status:
            "not-authenticated",

          message:
            "No authenticated HighLevel page was found."
        },
        409
      );
    }

    const page =
      found.page;

    const sitesUrl =
      "https://app.gohighlevel.com/v2/location/" +
      LOCATION_ID +
      "/funnels-websites/funnels";

    await page.goto(
      sitesUrl,
      {
        waitUntil:
          "domcontentloaded",
        timeout:
          30000
      }
    );

    try {
      await page.waitForFunction(
        () => {
          const text =
            (document.body?.innerText || "")
              .replace(/\\s+/g, " ")
              .trim()
              .toLowerCase();

          const stillLoading =
            text.includes(
              "loading fresh data"
            );

          const usefulElements =
            document.querySelectorAll(
              'a[href], button, tr, [role="row"], [class*="card"]'
            ).length;

          return (
            !stillLoading &&
            usefulElements > 5
          );
        },
        {
          timeout: 30000,
          polling: 500
        }
      );
    } catch {
      // Continue and inspect whatever HighLevel rendered.
    }

    await new Promise(
      resolve =>
        setTimeout(resolve, 1500)
    );

    const result =
      await page.evaluate(() => {

        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        const bodyText =
          clean(
            document.body?.innerText || ""
          );

        const items =
          Array.from(
            document.querySelectorAll(
              'a, button, [role="button"], [role="link"], tr, [role="row"], [class*="card"]'
            )
          )
          .map(element => ({

            tag:
              element.tagName.toLowerCase(),

            text:
              clean(
                element.innerText ||
                element.textContent
              ),

            href:
              element.tagName === "A"
                ? element.href
                : ""

          }))
          .filter(item =>
            item.text ||
            item.href
          );

        const likelyFunnels =
          items.filter(item => {

            const text =
              (
                item.text +
                " " +
                item.href
              ).toLowerCase();

            return (
              text.includes("funnel") ||
              text.includes("website") ||
              text.includes("cheshire") ||
              text.includes("golf") ||
              text.includes("coaching") ||
              text.includes("jo.")
            );

          });

        const allLinks =
          Array.from(
            document.querySelectorAll(
              "a[href]"
            )
          )
          .map(link => ({
            text:
              clean(
                link.innerText ||
                link.textContent
              ),

            href:
              link.href
          }))
          .filter(link =>
            link.text ||
            link.href
          );

        return {

          title:
            document.title,

          url:
            window.location.href,

          bodyPreview:
            bodyText.slice(0, 8000),

          likelyFunnels:
            likelyFunnels.slice(
              0,
              200
            ),

          allLinks:
            allLinks.slice(
              0,
              300
            )

        };
      });

    return json({

      status:
        "sites-inspection-success",

      readOnly:
        true,

      sessionId:
        await this.storage.get(
          "loginSessionId"
        ),

      sites:
        result
    });
  }


  async status() {

    const sessionId =
      await this.storage.get(
        "loginSessionId"
      );

    let reachable =
      false;

    if (
      this.browser &&
      this.browser.isConnected()
    ) {

      reachable =
        true;

    } else if (sessionId) {

      try {

        this.browser =
          await puppeteer.connect(
            this.env.BROWSER,
            sessionId
          );

        reachable =
          Boolean(
            this.browser &&
            this.browser.isConnected()
          );

      } catch {

        reachable =
          false;

      }
    }

    return json({

      status:
        "ok",

      sessionId:
        sessionId || null,

      browserReachable:
        reachable

    });
  }


  async fetch(request) {

    const url =
      new URL(request.url);

    try {

      switch (url.pathname) {

        case "/api/login/start":

          return await this.startLoginBrowser();


        case "/api/inspect-current":

          return await this.inspectCurrentHighLevel();


        case "/api/sites/inspect":

          return await this.inspectSites();


        case "/api/status":

          return await this.status();


        default:

          return json(
            {
              error:
                "Unknown action"
            },
            404
          );
      }

    } catch (error) {

      return json(
        {
          status:
            "error",

          message:
            error instanceof Error
              ? error.message
              : String(error)
        },
        500
      );
    }
  }
}
