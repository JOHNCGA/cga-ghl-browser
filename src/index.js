import { DurableObject } from "cloudflare:workers";
import * as puppeteer from "@cloudflare/puppeteer";

const GHL_URL = "https://app.gohighlevel.com/";
const KEEP_ALIVE = 600000;

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
      max-width: 720px;
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
This controls the authenticated HighLevel browser.
</p>

<label>
<strong>Browser Admin Key</strong>
</label>

<input
  id="key"
  type="password"
  placeholder="Enter BROWSER_ADMIN_KEY"
/>

<h3>Step 1</h3>

<button onclick="run('/api/login/start')">
Start Login Browser
</button>

<p>
Then open Cloudflare Browser Run → Live Sessions
and log into HighLevel.
</p>

<h3>Step 2</h3>

<button onclick="run('/api/auth/save')">
Save Authentication
</button>

<h3>Step 3</h3>

<button onclick="run('/api/inspect')">
Test Authentication
</button>

<h3>Status</h3>

<button onclick="run('/api/status')">
Check Status
</button>

<pre id="result">Ready</pre>

<script>
async function run(path) {

  const key =
    document.getElementById("key").value;

  const result =
    document.getElementById("result");

  if (!key) {
    result.textContent =
      "Enter your Browser Admin Key first.";
    return;
  }

  result.textContent = "Working...";

  try {

    const response =
      await fetch(path, {
        method: "POST",
        headers: {
          "x-admin-key": key
        }
      });

    const data =
      await response.json();

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
            "BROWSER_ADMIN_KEY is not configured"
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


  async launchBrowser() {

    return await puppeteer.launch(
      this.env.BROWSER,
      {
        keep_alive: KEEP_ALIVE
      }
    );

  }


  async startLogin() {

    if (
      this.browser &&
      this.browser.isConnected()
    ) {

      try {
        await this.browser.close();
      } catch {}

    }

    this.browser =
      await this.launchBrowser();

    const page =
      await this.browser.newPage();

    await page.goto(
      GHL_URL,
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
        "Open this session in Cloudflare Browser Run Live Sessions and log into HighLevel."
    });

  }


  async reconnectLoginBrowser() {

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


  async findHighLevelPage(browser) {

    const pages =
      await browser.pages();

    for (
      const page of pages
    ) {

      if (
        page.url().includes(
          "app.gohighlevel.com"
        )
      ) {
        return page;
      }

    }

    return null;

  }


  async saveAuth() {

    const browser =
      await this.reconnectLoginBrowser();

    if (!browser) {

      return json(
        {
          status:
            "browser-unavailable",

          message:
            "Close the Cloudflare Live View tab, but do not click Close Browser, then try again."
        },
        409
      );

    }

    const page =
      await this.findHighLevelPage(
        browser
      );

    if (!page) {

      return json(
        {
          status:
            "no-highlevel-page"
        },
        409
      );

    }

    const currentUrl =
      page.url();

    if (
      !currentUrl.includes(
        "/v2/location/"
      )
    ) {

      return json(
        {
          status:
            "not-authenticated",

          pageUrl:
            currentUrl,

          message:
            "Log into HighLevel first."
        },
        409
      );

    }

    const cookies =
      await page.cookies();

    const storageData =
      await page.evaluate(() => {

        const local = {};

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

        return local;

      });

    await this.storage.put(
      "ghlCookies",
      cookies
    );

    await this.storage.put(
      "ghlLocalStorage",
      storageData
    );

    await this.storage.put(
      "authSavedAt",
      new Date().toISOString()
    );

    try {
      await browser.close();
    } catch {}

    this.browser = null;

    await this.storage.delete(
      "loginSessionId"
    );

    return json({
      status:
        "auth-saved",

      cookieCount:
        cookies.length,

      localStorageKeys:
        Object.keys(
          storageData
        ).length,

      message:
        "Authentication saved. The login browser has been closed."
    });

  }


  async inspect() {

    const cookies =
      await this.storage.get(
        "ghlCookies"
      );

    const localStorageData =
      await this.storage.get(
        "ghlLocalStorage"
      );

    if (!cookies) {

      return json(
        {
          status:
            "no-saved-auth",

          message:
            "Start Login Browser, log into HighLevel, then Save Authentication."
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

      if (
        Array.isArray(cookies) &&
        cookies.length
      ) {

        await page.setCookie(
          ...cookies
        );

      }

      await page.goto(
        GHL_URL,
        {
          waitUntil:
            "domcontentloaded",

          timeout:
            30000
        }
      );

      if (
        localStorageData &&
        typeof localStorageData ===
          "object"
      ) {

        await page.evaluate(
          (saved) => {

            for (
              const [key, value]
              of Object.entries(saved)
            ) {

              localStorage.setItem(
                key,
                value
              );

            }

          },
          localStorageData
        );

        await page.reload({
          waitUntil:
            "domcontentloaded",

          timeout:
            30000
        });

      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            3000
          )
      );

      const result = {

        title:
          await page.title(),

        url:
          page.url()

      };

      const authenticated =
        result.url.includes(
          "/v2/location/"
        );

      return json({

        status:
          authenticated
            ? "authentication-success"
            : "authentication-expired",

        authenticated,

        highLevel:
          result

      });

    } finally {

      if (browser) {

        try {
          await browser.close();
        } catch {}

      }

    }

  }


  async status() {

    const authSavedAt =
      await this.storage.get(
        "authSavedAt"
      );

    const loginSessionId =
      await this.storage.get(
        "loginSessionId"
      );

    return json({

      status: "ok",

      savedAuthentication:
        Boolean(authSavedAt),

      authSavedAt:
        authSavedAt || null,

      loginBrowserActive:
        Boolean(loginSessionId)

    });

  }


  async fetch(request) {

    const url =
      new URL(request.url);

    try {

      switch (
        url.pathname
      ) {

        case "/api/login/start":

          return await this.startLogin();


        case "/api/auth/save":

          return await this.saveAuth();


        case "/api/inspect":

          return await this.inspect();


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
