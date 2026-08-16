import { DurableObject } from "cloudflare:workers";
import * as puppeteer from "@cloudflare/puppeteer";

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
      max-width: 760px;
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
This version uses the currently authenticated Cloudflare Browser Run
session directly. It does not attempt to rebuild your HighLevel login.
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
    result.textContent = JSON.stringify(data, null, 2);
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

    const suppliedKey = request.headers.get("x-admin-key");

    if (suppliedKey !== env.BROWSER_ADMIN_KEY) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const object = env.BROWSER_MANAGER.getByName("cga-ghl");
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
    /*
     * If a previously managed browser is genuinely still connected,
     * close it before deliberately creating a new login browser.
     */
    if (this.browser && this.browser.isConnected()) {
      try {
        await this.browser.close();
      } catch {}
    }

    this.browser = await puppeteer.launch(this.env.BROWSER, {
      keep_alive: 600000
    });

    const pages = await this.browser.pages();

    const page =
      pages[0] ||
      await this.browser.newPage();

    await page.goto("https://app.gohighlevel.com/", {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    const sessionId = this.browser.sessionId();

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


  async connectToLoginBrowser() {
    /*
     * First use the live in-memory browser if the Durable Object
     * still owns it.
     */
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    /*
     * Otherwise reconnect using the exact Browser Run session ID
     * stored when Start Login Browser was pressed.
     */
    const sessionId =
      await this.storage.get("loginSessionId");

    if (!sessionId) {
      return null;
    }

    try {
      this.browser = await puppeteer.connect(
        this.env.BROWSER,
        sessionId
      );

      return this.browser;
    } catch (error) {
      return null;
    }
  }


  async inspectCurrentHighLevel() {
    const browser =
      await this.connectToLoginBrowser();

    if (!browser) {
      return json({
        status: "browser-unavailable",
        message:
          "The stored Browser Run session cannot currently be reached. If Live View is attached, close only the Live View tab and try again."
      }, 409);
    }

    const pages = await browser.pages();

    const pageResults = [];

    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];

      let details;

      try {
        details = await page.evaluate(() => {
          const clean = (value) =>
            String(value || "")
              .replace(/\\s+/g, " ")
              .trim();

          const bodyText =
            clean(document.body?.innerText || "");

          const bodyLower =
            bodyText.toLowerCase();

          const hasPasswordField =
            Boolean(
              document.querySelector(
                'input[type="password"]'
              )
            );

          const authenticatedSignals = [
            "dashboard",
            "conversations",
            "contacts",
            "opportunities",
            "calendars",
            "marketing",
            "automation",
            "sites"
          ];

          const authenticatedSignalCount =
            authenticatedSignals.filter(
              signal =>
                bodyLower.includes(signal)
            ).length;

          const navigation =
            Array.from(
              document.querySelectorAll(
                'a, button, [role="button"], [role="link"]'
              )
            )
            .map((element) => ({
              tag:
                element.tagName.toLowerCase(),

              text:
                clean(
                  element.innerText ||
                  element.textContent ||
                  element.getAttribute("aria-label")
                ),

              href:
                element.tagName === "A"
                  ? element.href
                  : "",

              ariaLabel:
                clean(
                  element.getAttribute("aria-label")
                )
            }))
            .filter(item =>
              item.text ||
              item.href ||
              item.ariaLabel
            );

          const relevantNavigation =
            navigation.filter(item => {
              const searchText = (
                item.text +
                " " +
                item.href +
                " " +
                item.ariaLabel
              ).toLowerCase();

              return [
                "site",
                "website",
                "funnel",
                "page",
                "domain"
              ].some(term =>
                searchText.includes(term)
              );
            });

          return {
            title: document.title,
            url: window.location.href,

            authenticated:
              authenticatedSignalCount >= 2 &&
              !hasPasswordField,

            authenticatedSignalCount,

            bodyPreview:
              bodyText.slice(0, 1000),

            relevantNavigation:
              relevantNavigation.slice(0, 100)
          };
        });

      } catch (error) {
        details = {
          title: "",
          url: page.url(),
          authenticated: false,
          error:
            error instanceof Error
              ? error.message
              : String(error)
        };
      }

      pageResults.push({
        index,
        ...details
      });
    }

    /*
     * Prefer whichever open tab actually contains the authenticated
     * HighLevel interface.
     */
    const authenticatedPage =
      pageResults.find(
        page => page.authenticated
      );

    if (!authenticatedPage) {
      return json({
        status: "not-authenticated",
        sessionId:
          await this.storage.get(
            "loginSessionId"
          ),
        pages: pageResults,
        message:
          "The Browser Run session is reachable, but no open tab currently looks like the logged-in HighLevel dashboard."
      }, 409);
    }

    return json({
      status: "inspection-success",
      authenticated: true,

      sessionId:
        await this.storage.get(
          "loginSessionId"
        ),

      highLevel:
        authenticatedPage,

      pages:
        pageResults
    });
  }


  async status() {
    const sessionId =
      await this.storage.get(
        "loginSessionId"
      );

    let reachable = false;

    if (this.browser && this.browser.isConnected()) {
      reachable = true;
    } else if (sessionId) {
      try {
        this.browser = await puppeteer.connect(
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
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case "/api/login/start":
          return await this.startLoginBrowser();

        case "/api/inspect-current":
          return await this.inspectCurrentHighLevel();

        case "/api/status":
          return await this.status();

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
