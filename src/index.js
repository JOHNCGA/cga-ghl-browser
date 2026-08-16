import { DurableObject } from "cloudflare:workers";
import puppeteer from "@cloudflare/puppeteer";

const GHL_URL = "https://app.gohighlevel.com/";
const KEEP_ALIVE_MS = 600000;
const ALARM_INTERVAL_MS = 5 * 60 * 1000;

function json(data, status = 200) {
  return Response.json(data, { status });
}

function adminPage() {
  return new Response(
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>CGA HighLevel Browser</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      max-width: 760px;
      margin: 40px auto;
      padding: 0 20px;
      line-height: 1.5;
    }
    input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px;
      margin: 8px 0 18px;
    }
    button {
      padding: 10px 14px;
      margin: 4px;
      cursor: pointer;
    }
    pre {
      white-space: pre-wrap;
      word-break: break-word;
      background: #f4f4f4;
      padding: 16px;
      border-radius: 8px;
      min-height: 100px;
    }
    .step {
      margin: 22px 0;
      padding: 16px;
      border: 1px solid #ddd;
      border-radius: 8px;
    }
  </style>
</head>

<body>

<h1>CGA HighLevel Browser</h1>

<p>
This control panel manages the authenticated Cloudflare Browser Run
session used for Cheshire Golf Academy.
</p>

<label><strong>Browser Admin Key</strong></label>
<input
  id="key"
  type="password"
  autocomplete="off"
  placeholder="Paste your BROWSER_ADMIN_KEY here"
/>

<div class="step">
  <strong>1. Start login browser</strong><br>
  <button onclick="callApi('/api/login/start')">
    Start Login
  </button>
  <p>
    Then go to Cloudflare → Browser Run → Live Sessions,
    open the newest HighLevel browser and log in.
  </p>
</div>

<div class="step">
  <strong>2. Save authenticated state</strong><br>
  <button onclick="callApi('/api/auth/save')">
    Save Auth
  </button>
  <p>
    Close the Live View tab first — but do NOT press
    Cloudflare's red Close Browser button.
  </p>
</div>

<div class="step">
  <strong>3. Test restored login</strong><br>
  <button onclick="callApi('/api/inspect')">
    Inspect HighLevel
  </button>
</div>

<div class="step">
  <strong>Utilities</strong><br>
  <button onclick="callApi('/api/auth/status')">
    Auth Status
  </button>

  <button onclick="callApi('/api/browser/close')">
    Close Active Browser
  </button>

  <button onclick="callApi('/api/auth/clear')">
    Clear Saved Auth
  </button>
</div>

<h3>Result</h3>
<pre id="output">Ready.</pre>

<script>
async function callApi(path) {
  const output = document.getElementById("output");
  const key = document.getElementById("key").value;

  if (!key) {
    output.textContent = "Enter your Browser Admin Key first.";
    return;
  }

  output.textContent = "Working...";

  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "x-admin-key": key
      }
    });

    const data = await response.json();

    output.textContent =
      JSON.stringify(data, null, 2);

  } catch (error) {
    output.textContent =
      "Error: " + error.message;
  }
}
</script>

</body>
</html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8"
      }
    }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return adminPage();
    }

    if (!url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    if (!env.BROWSER_ADMIN_KEY) {
      return json(
        { error: "BROWSER_ADMIN_KEY is not configured." },
        503
      );
    }

    const suppliedKey =
      request.headers.get("x-admin-key");

    if (
      !suppliedKey ||
      suppliedKey !== env.BROWSER_ADMIN_KEY
    ) {
      return json({ error: "Unauthorized" }, 401);
    }

    if (request.method !== "POST") {
      return json(
        { error: "Method not allowed" },
        405
      );
    }

    const obj =
      env.BROWSER_MANAGER.getByName("cga-ghl");

    return obj.fetch(request);
  }
};

export class BrowserManager extends DurableObject {
  constructor(state, env) {
    super(state, env);

    this.storage = state.storage;
    this.env = env;
    this.browser = null;
  }

  async launchBrowser() {
    return puppeteer.launch(
      this.env.BROWSER,
      {
        keep_alive: KEEP_ALIVE_MS
      }
    );
  }

  async closeManualBrowser() {
    const storedSessionId =
      await this.storage.get(
        "activeSessionId"
      );

    try {
      if (
        this.browser &&
        this.browser.isConnected()
      ) {
        await this.browser.close();
      } else if (storedSessionId) {
        try {
          const browser =
            await puppeteer.connect(
              this.env.BROWSER,
              storedSessionId
            );

          await browser.close();
        } catch {
          // Session may already be gone.
        }
      }
    } finally {
      this.browser = null;

      await this.storage.delete(
        "activeSessionId"
      );

      await this.storage.deleteAlarm();
    }
  }

  async getManualBrowser() {
    if (
      this.browser &&
      this.browser.isConnected()
    ) {
      return this.browser;
    }

    const sessionId =
      await this.storage.get(
        "activeSessionId"
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

  async getGhlPage(browser) {
    const pages =
      await browser.pages();

    let page =
      pages.find((p) =>
        p.url().includes(
          "app.gohighlevel.com"
        )
      );

    if (!page) {
      page =
        pages[0] ||
        await browser.newPage();
    }

    return page;
  }

  isAuthenticatedUrl(url) {
    return (
      url.includes(
        "app.gohighlevel.com/v2/location/"
      ) ||
      url.includes(
        "app.gohighlevel.com/location/"
      )
    );
  }

  async captureAuth(page) {
    const cookies =
      await page.cookies();

    const webStorage =
      await page.evaluate(() => {
        const local = {};
        const session = {};

        for (
          let i = 0;
          i < localStorage.length;
          i++
        ) {
          const key =
            localStorage.key(i);

          local[key] =
            localStorage.getItem(key);
        }

        for (
          let i = 0;
          i < sessionStorage.length;
          i++
        ) {
          const key =
            sessionStorage.key(i);

          session[key] =
            sessionStorage.getItem(key);
        }

        return {
          localStorage: local,
          sessionStorage: session
        };
      });

    return {
      cookies,
      localStorage:
        webStorage.localStorage,
      sessionStorage:
        webStorage.sessionStorage,
      savedFromUrl: page.url(),
      savedAt:
        new Date().toISOString()
    };
  }

  cookieParams(cookies) {
    return cookies.map((c) => {
      const cookie = {
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || "/",
        httpOnly: Boolean(c.httpOnly),
        secure: Boolean(c.secure)
      };

      if (
        typeof c.expires === "number" &&
        c.expires > 0
      ) {
        cookie.expires = c.expires;
      }

      if (c.sameSite) {
        cookie.sameSite =
          c.sameSite;
      }

      return cookie;
    });
  }

  async restoreAuth(page, auth) {
    const cookies =
      this.cookieParams(
        auth.cookies || []
      );

    if (cookies.length) {
      await page.setCookie(
        ...cookies
      );
    }

    await page.goto(
      GHL_URL,
      {
        waitUntil:
          "domcontentloaded",
        timeout: 30000
      }
    );

    await page.evaluate(
      ({ local, session }) => {

        localStorage.clear();
        sessionStorage.clear();

        for (
          const [key, value]
          of Object.entries(local)
        ) {
          localStorage.setItem(
            key,
            value
          );
        }

        for (
          const [key, value]
          of Object.entries(session)
        ) {
          sessionStorage.setItem(
            key,
            value
          );
        }

      },
      {
        local:
          auth.localStorage || {},
        session:
          auth.sessionStorage || {}
      }
    );

    await page.reload({
      waitUntil:
        "domcontentloaded",
      timeout: 30000
    });

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 2500)
    );
  }

  async inspectPage(page) {
    await page.waitForSelector(
      "body",
      { timeout: 15000 }
    );

    await new Promise(
      (resolve) =>
        setTimeout(resolve, 1500)
    );

    return page.evaluate(() => {
      const clean = (value) =>
        String(value || "")
          .replace(/\\s+/g, " ")
          .trim();

      const visible = (el) => {
        const style =
          getComputedStyle(el);

        const rect =
          el.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const navigation =
        Array.from(
          document.querySelectorAll(
            'a, button, [role="button"], [role="link"]'
          )
        )
          .filter(visible)
          .map((el) => ({
            tag:
              el.tagName.toLowerCase(),

            text:
              clean(
                el.innerText ||
                el.textContent
              ),

            href:
              el.tagName === "A"
                ? el.href
                : "",

            ariaLabel:
              clean(
                el.getAttribute(
                  "aria-label"
                )
              )
          }))
          .filter((item) =>
            item.text ||
            item.href ||
            item.ariaLabel
          );

      const relevantNavigation =
        navigation.filter(
          (item) => {
            const text = (
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
            ].some((word) =>
              text.includes(word)
            );
          }
        );

      return {
        title:
          document.title,

        url:
          window.location.href,

        relevantNavigation:
          relevantNavigation.slice(
            0,
            100
          ),

        visibleNavigation:
          navigation.slice(
            0,
            150
          )
      };
    });
  }

  async startLogin() {
    await this.closeManualBrowser();

    this.browser =
      await this.launchBrowser();

    const page =
      await this.browser.newPage();

    await page.goto(
      GHL_URL,
      {
        waitUntil:
          "domcontentloaded",
        timeout: 30000
      }
    );

    const sessionId =
      this.browser.sessionId();

    await this.storage.put(
      "activeSessionId",
      sessionId
    );

    await this.storage.setAlarm(
      Date.now() +
      ALARM_INTERVAL_MS
    );

    return json({
      status: "login-browser-ready",
      sessionId,
      pageTitle:
        await page.title(),
      pageUrl:
        page.url(),
      next:
        "Open this session in Cloudflare Browser Run Live Sessions and log into HighLevel. Then close Live View — not the browser — and press Save Auth."
    });
  }

  async saveAuth() {
    const browser =
      await this.getManualBrowser();

    if (!browser) {
      return json(
        {
          status:
            "browser-unavailable",

          message:
            "The login browser cannot currently be connected. Make sure Live View is closed, then try Save Auth again."
        },
        409
      );
    }

    const page =
      await this.getGhlPage(
        browser
      );

    const currentUrl =
      page.url();

    if (
      !this.isAuthenticatedUrl(
        currentUrl
      )
    ) {
      return json(
        {
          status:
            "not-authenticated",

          pageUrl:
            currentUrl,

          message:
            "HighLevel is not logged in yet."
        },
        409
      );
    }

    const authState =
      await this.captureAuth(
        page
      );

    await this.storage.put(
      "ghlAuthState",
      authState
    );

    const result = {
      status: "auth-saved",
      savedAt:
        authState.savedAt,
      cookieCount:
        authState.cookies.length,
      localStorageKeys:
        Object.keys(
          authState.localStorage
        ).length,
      sessionStorageKeys:
        Object.keys(
          authState.sessionStorage
        ).length,
      savedFromUrl:
        authState.savedFromUrl,
      next:
        "Authentication has been stored. The manual login browser will now close. Press Inspect HighLevel to test a completely fresh browser."
    };

    await this.closeManualBrowser();

    return json(result);
  }

  async inspect() {
    const authState =
      await this.storage.get(
        "ghlAuthState"
      );

    if (!authState) {
      return json(
        {
          status:
            "no-saved-auth",

          message:
            "No saved HighLevel authentication exists. Run Start Login, log in, then Save Auth."
        },
        409
      );
    }

    let browser;

    try {
      browser =
        await this.launchBrowser();

      const page =
        await browser.newPage();

      await this.restoreAuth(
        page,
        authState
      );

      const inspection =
        await this.inspectPage(
          page
        );

      const authenticated =
        this.isAuthenticatedUrl(
          inspection.url
        );

      return json({
        status:
          authenticated
            ? "inspection-success"
            : "authentication-expired",

        authenticated,

        authSavedAt:
          authState.savedAt,

        highLevel:
          inspection
      });

    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }

  async authStatus() {
    const authState =
      await this.storage.get(
        "ghlAuthState"
      );

    const activeSessionId =
      await this.storage.get(
        "activeSessionId"
      );

    return json({
      status: "ok",
      savedAuth:
        Boolean(authState),
      authSavedAt:
        authState?.savedAt || null,
      activeLoginBrowser:
        Boolean(activeSessionId),
      activeSessionId:
        activeSessionId || null
    });
  }

  async clearAuth() {
    await this.storage.delete(
      "ghlAuthState"
    );

    return json({
      status: "auth-cleared"
    });
  }

  async fetch(request) {
    const url =
      new URL(request.url);

    try {
      switch (url.pathname) {

        case "/api/login/start":
          return await this.startLogin();

        case "/api/auth/save":
          return await this.saveAuth();

        case "/api/inspect":
          return await this.inspect();

        case "/api/auth/status":
          return await this.authStatus();

        case "/api/auth/clear":
          return await this.clearAuth();

        case "/api/browser/close":
          await this.closeManualBrowser();

          return json({
            status:
              "browser-closed"
          });

        default:
          return json(
            { error: "Not found" },
            404
          );
      }

    } catch (error) {
      return json(
        {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : String(error)
        },
        500
      );
    }
  }

  async alarm() {
    const sessionId =
      await this.storage.get(
        "activeSessionId"
      );

    if (!sessionId) {
      return;
    }

    try {
      let browser =
        this.browser;

      if (
        !browser ||
        !browser.isConnected()
      ) {
        browser =
          await puppeteer.connect(
            this.env.BROWSER,
            sessionId
          );

        this.browser =
          browser;
      }

      // Browser command keeps the manual
      // login session from becoming idle.
      await browser.version();

      await this.storage.setAlarm(
        Date.now() +
        ALARM_INTERVAL_MS
      );

    } catch {
      this.browser = null;

      await this.storage.delete(
        "activeSessionId"
      );

      await this.storage.deleteAlarm();
    }
  }
}
  async getHighLevelPage(browser) {
    let pages = await browser.pages();

    let page = pages.find((p) =>
      p.url().includes("app.gohighlevel.com")
    );

    if (!page) {
      page = pages[0] || await browser.newPage();
    }

    if (!page.url() || page.url() === "about:blank") {
      await page.goto("https://app.gohighlevel.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });
    }

    return page;
  }

  async inspectHighLevel(page) {
    await page.waitForSelector("body", { timeout: 15000 });

    // Give the HighLevel SPA a moment to finish rendering.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    return await page.evaluate(() => {
      const clean = (value) =>
        String(value || "")
          .replace(/\s+/g, " ")
          .trim();

      const isVisible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();

        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };

      const items = Array.from(
        document.querySelectorAll(
          'a, button, [role="button"], [role="link"]'
        )
      )
        .filter(isVisible)
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          text: clean(
            el.innerText ||
            el.textContent ||
            el.getAttribute("aria-label")
          ),
          href:
            el instanceof HTMLAnchorElement
              ? el.href
              : "",
          ariaLabel: clean(
            el.getAttribute("aria-label")
          )
        }))
        .filter((item) =>
          item.text ||
          item.href ||
          item.ariaLabel
        );

      const relevant = items.filter((item) => {
        const haystack = (
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
        ].some((word) => haystack.includes(word));
      });

      return {
        pageTitle: document.title,
        pageUrl: window.location.href,

        relevantNavigation: relevant.slice(0, 100),

        visibleNavigation: items.slice(0, 150)
      };
    });
  }

  async fetch(request) {
    try {
      const browser = await this.ensureBrowser();
      const page = await this.getHighLevelPage(browser);

      await this.keepAlive();

      const inspection = await this.inspectHighLevel(page);

      return Response.json({
        status: "inspection-success",
        authenticated:
          inspection.pageUrl.includes(
            "/v2/location/"
          ),
        highLevel: inspection
      });

    } catch (error) {
      return Response.json(
        {
          status: "error",
          message:
            error instanceof Error
              ? error.message
              : String(error)
        },
        { status: 500 }
      );
    }
  }

  async alarm() {
    try {
      if (
        this.browser &&
        this.browser.isConnected()
      ) {
        await this.browser.version();

        await this.storage.setAlarm(
          Date.now() + 5 * 60 * 1000
        );
      }
    } catch (error) {
      console.log(
        "Browser keep-alive failed:",
        error instanceof Error
          ? error.message
          : String(error)
      );
    }
  }
}
