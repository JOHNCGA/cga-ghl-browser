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
      max-width: 820px;
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
Connects directly to the current authenticated Cloudflare Browser Run session.
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
Inspect Current HighLevel Page
</button>

<button onclick="run('/api/sites/inspect')">
Inspect Funnels Page
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
    result.textContent = String(error);
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
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return controlPage();
    }

    if (!url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    if (!env.BROWSER_ADMIN_KEY) {
      return json({
        error: "BROWSER_ADMIN_KEY is not configured."
      }, 503);
    }

    const suppliedKey =
      request.headers.get("x-admin-key");

    if (suppliedKey !== env.BROWSER_ADMIN_KEY) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const object =
      env.BROWSER_MANAGER.getByName("cga-ghl");

    return object.fetch(request);
  }
};


export class BrowserManager extends DurableObject {

  constructor(state, env) {
    super(state, env);

    this.storage = state.storage;
    this.env = env;
    this.browser = null;
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
        waitUntil: "domcontentloaded",
        timeout: 30000
      }
    );

    const sessionId =
      this.browser.sessionId();

    await this.storage.put(
      "loginSessionId",
      sessionId
    );

    return json({
      status: "login-browser-ready",
      sessionId,
      pageUrl: page.url(),
      message:
        "Open this exact session in Cloudflare Browser Run Live Sessions and log into HighLevel."
    });
  }


  async connectToBrowser() {
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


  async getHighLevelPages(browser) {
    const pages =
      await browser.pages();

    const results = [];

    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      const url = page.url();

      if (
        url.includes(
          "app.gohighlevel.com"
        )
      ) {
        results.push({
          index,
          page,
          url
        });
      }
    }

    return results;
  }


  async chooseCurrentHighLevelPage(browser) {
    const highLevelPages =
      await this.getHighLevelPages(browser);

    if (!highLevelPages.length) {
      return null;
    }

    /*
     * Prefer the Funnels/Sites page if it is already open.
     */
    const funnelsPage =
      highLevelPages.find(({ url }) =>
        url.includes(
          "/funnels-websites/"
        )
      );

    if (funnelsPage) {
      return funnelsPage.page;
    }

    /*
     * Prefer a location page next.
     */
    const locationPage =
      highLevelPages.find(({ url }) =>
        url.includes(
          "/v2/location/"
        )
      );

    if (locationPage) {
      return locationPage.page;
    }

    /*
     * Otherwise just use the last HighLevel page.
     */
    return highLevelPages[
      highLevelPages.length - 1
    ].page;
  }


  async inspectCurrentPage() {
    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status: "browser-unavailable",
        message:
          "The stored Browser Run session cannot currently be reached."
      }, 409);
    }

    const page =
      await this.chooseCurrentHighLevelPage(
        browser
      );

    if (!page) {
      return json({
        status: "no-highlevel-page",
        message:
          "No HighLevel tab is currently open in the Browser Run session."
      }, 409);
    }

    await page.waitForSelector(
      "body",
      { timeout: 15000 }
    );

    await new Promise(
      resolve =>
        setTimeout(resolve, 1500)
    );

    const inspection =
      await page.evaluate(() => {

        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        const bodyText =
          clean(
            document.body?.innerText || ""
          );

        const links =
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
            bodyText.slice(0, 5000),

          links:
            links.slice(0, 250)
        };
      });

    return json({
      status: "current-page-inspection-success",
      sessionId:
        await this.storage.get(
          "loginSessionId"
        ),
      highLevel: inspection
    });
  }


  async inspectFunnels() {
    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status: "browser-unavailable",
        message:
          "The stored Browser Run session cannot currently be reached."
      }, 409);
    }

    let page =
      await this.chooseCurrentHighLevelPage(
        browser
      );

    if (!page) {
      return json({
        status: "no-highlevel-page",
        message:
          "No HighLevel tab is currently open."
      }, 409);
    }

    const funnelsUrl =
      "https://app.gohighlevel.com/v2/location/" +
      LOCATION_ID +
      "/funnels-websites/funnels";

    /*
     * If not already on the funnels page,
     * navigate there directly.
     */
    if (
      !page.url().includes(
        "/funnels-websites/funnels"
      )
    ) {
      await page.goto(
        funnelsUrl,
        {
          waitUntil: "domcontentloaded",
          timeout: 30000
        }
      );
    }

    /*
     * Wait for the SPA to finish replacing
     * its loading state.
     */
    try {
      await page.waitForFunction(
        () => {
          const text =
            (document.body?.innerText || "")
              .replace(/\\s+/g, " ")
              .trim()
              .toLowerCase();

          return (
            !text.includes(
              "loading fresh data"
            ) &&
            text.length > 50
          );
        },
        {
          timeout: 30000,
          polling: 500
        }
      );
    } catch {
      // Continue with whatever is rendered.
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

        const links =
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

        const buttons =
          Array.from(
            document.querySelectorAll(
              'button, [role="button"]'
            )
          )
          .map(button => ({
            text:
              clean(
                button.innerText ||
                button.textContent ||
                button.getAttribute(
                  "aria-label"
                )
              )
          }))
          .filter(button =>
            button.text
          );

        const rows =
          Array.from(
            document.querySelectorAll(
              'tr, [role="row"], [class*="card"]'
            )
          )
          .map(row => ({
            text:
              clean(
                row.innerText ||
                row.textContent
              )
          }))
          .filter(row =>
            row.text
          );

        const likelyFunnels =
          [
            ...links.map(item => ({
              type: "link",
              ...item
            })),

            ...rows.map(item => ({
              type: "row",
              ...item
            }))
          ]
          .filter(item => {
            const text =
              (
                item.text +
                " " +
                (item.href || "")
              ).toLowerCase();

            return (
              text.includes("funnel") ||
              text.includes("website") ||
              text.includes("golf") ||
              text.includes("coaching") ||
              text.includes("cheshire") ||
              text.includes("jo.")
            );
          });

        return {
          title:
            document.title,

          url:
            window.location.href,

          bodyPreview:
            bodyText.slice(0, 10000),

          likelyFunnels:
            likelyFunnels.slice(
              0,
              200
            ),

          links:
            links.slice(
              0,
              300
            ),

          buttons:
            buttons.slice(
              0,
              200
            ),

          rows:
            rows.slice(
              0,
              200
            )
        };
      });

    return json({
      status: "funnels-inspection-success",
      readOnly: true,
      sessionId:
        await this.storage.get(
          "loginSessionId"
        ),
      funnels: result
    });
  }


  async status() {
    const sessionId =
      await this.storage.get(
        "loginSessionId"
      );

    let reachable = false;

    if (
      this.browser &&
      this.browser.isConnected()
    ) {
      reachable = true;
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
        reachable = false;
      }
    }

    return json({
      status: "ok",
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

        case "/api/status":
          return await this.status();

        case "/api/inspect-current":
          return await this.inspectCurrentPage();

        case "/api/sites/inspect":
          return await this.inspectFunnels();

        default:
          return json({
            error: "Unknown action"
          }, 404);
      }

    } catch (error) {
      return json({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : String(error)
      }, 500);
    }
  }
}
