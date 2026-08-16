import { DurableObject } from "cloudflare:workers";
import * as puppeteer from "@cloudflare/puppeteer";

const LOCATION_ID = "zyhFEkFNE1Eo2O7I8nOP";
const GHL_BASE = "https://app.gohighlevel.com";

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8"
    }
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
      max-width: 900px;
      margin: 40px auto;
      padding: 0 20px;
    }
    input {
      width: 100%;
      padding: 10px;
      box-sizing: border-box;
      margin: 8px 0 15px;
    }
    button {
      padding: 11px 15px;
      margin: 4px;
      cursor: pointer;
    }
    pre {
      background: #f4f4f4;
      padding: 15px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    section {
      margin: 25px 0;
      padding-bottom: 15px;
      border-bottom: 1px solid #ddd;
    }
  </style>
</head>

<body>

<h1>CGA HighLevel Browser</h1>

<label><strong>Browser Admin Key</strong></label>
<input id="key" type="password" placeholder="Enter BROWSER_ADMIN_KEY">

<section>
  <h3>Browser</h3>

  <button onclick="run('/api/login/start')">
    Start Login Browser
  </button>

  <button onclick="run('/api/status')">
    Check Status
  </button>
</section>

<section>
  <h3>Funnels</h3>

  <button onclick="run('/api/sites/inspect')">
    List Funnels
  </button>

  <input
    id="funnelName"
    placeholder="Funnel name"
  >

  <button onclick="runWithBody('/api/funnel/open', {
    name: document.getElementById('funnelName').value
  })">
    Open Funnel
  </button>

  <button onclick="run('/api/funnel/steps')">
    List Current Funnel Steps
  </button>
</section>

<section>
  <h3>Step</h3>

  <input
    id="stepName"
    placeholder="Step/page name"
  >

  <button onclick="runWithBody('/api/funnel/step/inspect', {
    name: document.getElementById('stepName').value
  })">
    Select / Inspect Step
  </button>
</section>

<section>
  <h3>Page Builder</h3>

  <button onclick="run('/api/builder/open')">
    Open Page Builder
  </button>

  <button onclick="run('/api/builder/inspect')">
    Inspect Page Builder
  </button>
</section>

<pre id="result">Ready</pre>

<script>
function adminKey() {
  return document.getElementById("key").value;
}

async function run(path) {
  return runWithBody(path, {});
}

async function runWithBody(path, body) {
  const result = document.getElementById("result");
  const key = adminKey();

  if (!key) {
    result.textContent = "Enter your Browser Admin Key first.";
    return;
  }

  result.textContent = "Working...";

  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "x-admin-key": key,
        "content-type": "application/json"
      },
      body: JSON.stringify(body || {})
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


  async body(request) {
    try {
      return await request.json();
    } catch {
      return {};
    }
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
      `${GHL_BASE}/`,
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
      pageUrl: page.url()
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


  async highLevelPages(browser) {
    const pages =
      await browser.pages();

    return pages.filter(
      page =>
        page.url().includes(
          "app.gohighlevel.com"
        )
    );
  }


  async chooseHighLevelPage(browser) {
    const pages =
      await this.highLevelPages(browser);

    if (!pages.length) {
      return null;
    }

    const builder =
      await this.findBuilderPage(browser);

    if (builder) {
      return builder.page;
    }

    const funnelDetail =
      pages.find(page => {
        const url = page.url();

        return (
          url.includes("/funnels-websites/") &&
          !url.endsWith("/funnels")
        );
      });

    if (funnelDetail) {
      return funnelDetail;
    }

    const funnels =
      pages.find(page =>
        page.url().includes(
          "/funnels-websites/funnels"
        )
      );

    if (funnels) {
      return funnels;
    }

    return pages[pages.length - 1];
  }


  async waitForHighLevel(
    page,
    timeout = 30000
  ) {
    await page.waitForSelector(
      "body",
      { timeout: 15000 }
    );

    try {
      await page.waitForFunction(
        () => {
          const text =
            (document.body?.innerText || "")
              .replace(/\\s+/g, " ")
              .trim()
              .toLowerCase();

          return (
            text.length > 20 &&
            !text.includes(
              "loading fresh data"
            )
          );
        },
        {
          timeout,
          polling: 500
        }
      );
    } catch {}

    await sleep(1200);
  }


  async snapshot(page) {
    return page.evaluate(() => {
      const clean = value =>
        String(value || "")
          .replace(/\\s+/g, " ")
          .trim();

      return {
        title: document.title,
        url: location.href,
        body:
          clean(
            document.body?.innerText || ""
          ).slice(0, 15000)
      };
    });
  }


  async findExactClickPoint(
    page,
    text,
    preferPointer = true
  ) {
    return page.evaluate(
      ({ targetText, preferPointer }) => {

        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        const wanted =
          clean(targetText)
            .toLowerCase();

        const elements =
          Array.from(
            document.querySelectorAll(
              'button, a, [role="button"], [role="link"], div, span, td'
            )
          );

        const matches =
          elements
            .map(element => {
              const text =
                clean(
                  element.innerText ||
                  element.textContent ||
                  element.getAttribute(
                    "aria-label"
                  )
                );

              const rect =
                element
                  .getBoundingClientRect();

              const style =
                window.getComputedStyle(
                  element
                );

              return {
                element,
                text,
                tag:
                  element.tagName
                    .toLowerCase(),
                role:
                  element.getAttribute(
                    "role"
                  ) || "",
                cursor:
                  style.cursor,
                width:
                  rect.width,
                height:
                  rect.height
              };
            })
            .filter(item =>
              item.text
                .toLowerCase() === wanted &&
              item.width > 0 &&
              item.height > 0
            );

        if (!matches.length) {
          return null;
        }

        const preferred =
          matches.find(item =>
            item.tag === "button"
          ) ||
          matches.find(item =>
            item.role === "button"
          ) ||
          matches.find(item =>
            item.tag === "a"
          ) ||
          (
            preferPointer
              ? matches.find(
                  item =>
                    item.cursor ===
                    "pointer"
                )
              : null
          ) ||
          matches[0];

        preferred.element.scrollIntoView({
          block: "center",
          inline: "center"
        });

        const rect =
          preferred.element
            .getBoundingClientRect();

        return {
          text:
            preferred.text,

          tag:
            preferred.tag,

          role:
            preferred.role,

          cursor:
            preferred.cursor,

          x:
            rect.left +
            rect.width / 2,

          y:
            rect.top +
            rect.height / 2,

          width:
            rect.width,

          height:
            rect.height
        };

      },
      {
        targetText: text,
        preferPointer
      }
    );
  }


  async realClick(
    page,
    point
  ) {
    await page.mouse.move(
      point.x,
      point.y
    );

    await sleep(100);

    await page.mouse.down();

    await sleep(80);

    await page.mouse.up();

    await sleep(500);
  }


  async findFunnelClickPoint(
    page,
    funnelName
  ) {
    return page.evaluate(name => {
      const clean = value =>
        String(value || "")
          .replace(/\\s+/g, " ")
          .trim();

      const wanted =
        clean(name).toLowerCase();

      const rows =
        Array.from(
          document.querySelectorAll(
            'tr, [role="row"]'
          )
        );

      const row =
        rows.find(element => {
          const text =
            clean(
              element.innerText ||
              element.textContent
            ).toLowerCase();

          return text.includes(wanted);
        });

      if (!row) {
        return null;
      }

      const targets =
        Array.from(
          row.querySelectorAll(
            "div, span, a, button"
          )
        );

      const target =
        targets.find(element => {
          const text =
            clean(
              element.innerText ||
              element.textContent
            ).toLowerCase();

          const style =
            getComputedStyle(element);

          const rect =
            element.getBoundingClientRect();

          return (
            text === wanted &&
            style.cursor === "pointer" &&
            rect.width > 20 &&
            rect.height > 10
          );
        });

      if (!target) {
        return null;
      }

      target.scrollIntoView({
        block: "center",
        inline: "center"
      });

      const rect =
        target.getBoundingClientRect();

      return {
        x:
          rect.left +
          rect.width / 2,

        y:
          rect.top +
          rect.height / 2,

        width:
          rect.width,

        height:
          rect.height,

        tag:
          target.tagName
            .toLowerCase()
      };

    }, funnelName);
  }


  async navigateToFunnels(page) {
    const funnelsUrl =
      `${GHL_BASE}/v2/location/${LOCATION_ID}/funnels-websites/funnels`;

    if (
      page.url() !==
      funnelsUrl
    ) {
      await page.goto(
        funnelsUrl,
        {
          waitUntil:
            "domcontentloaded",
          timeout:
            30000
        }
      );
    }

    await this.waitForHighLevel(page);

    return funnelsUrl;
  }


  async openStoredFunnel(
    page,
    funnelName
  ) {
    await this.navigateToFunnels(
      page
    );

    const before =
      await this.snapshot(page);

    const point =
      await this.findFunnelClickPoint(
        page,
        funnelName
      );

    if (!point) {
      throw new Error(
        `Could not find clickable funnel row for "${funnelName}".`
      );
    }

    await this.realClick(
      page,
      point
    );

    try {
      await page.waitForFunction(
        oldUrl =>
          location.href !== oldUrl,
        {
          timeout: 20000,
          polling: 300
        },
        before.url
      );
    } catch {}

    await sleep(1200);

    const after =
      await this.snapshot(page);

    const stillList =
      after.url.endsWith(
        "/funnels-websites/funnels"
      ) &&
      after.body
        .toLowerCase()
        .includes(
          "search for funnels"
        );

    if (stillList) {
      throw new Error(
        `Funnel "${funnelName}" was clicked but did not open.`
      );
    }

    await this.storage.put(
      "currentFunnelName",
      funnelName
    );

    await this.storage.put(
      "currentFunnelUrl",
      after.url
    );

    return after;
  }


  async ensureFunnelOpen(
    page,
    funnelName
  ) {
    const snap =
      await this.snapshot(page);

    const bodyLower =
      snap.body.toLowerCase();

    if (
      bodyLower.includes(
        funnelName.toLowerCase()
      ) &&
      !bodyLower.includes(
        "search for funnels"
      )
    ) {
      return snap;
    }

    return this.openStoredFunnel(
      page,
      funnelName
    );
  }


  async selectStepOverview(
    page,
    stepName
  ) {
    const current =
      await this.snapshot(page);

    const lower =
      current.body.toLowerCase();

    /*
     * If the correct step is already selected
     * and its overview controls are present,
     * do nothing.
     */
    if (
      lower.includes(
        stepName.toLowerCase()
      ) &&
      lower.includes("overview") &&
      lower.includes("products") &&
      lower.includes("publishing") &&
      lower.includes("edit")
    ) {
      await this.storage.put(
        "currentStepName",
        stepName
      );

      return current;
    }

    const point =
      await this.findExactClickPoint(
        page,
        stepName,
        true
      );

    if (!point) {
      throw new Error(
        `Could not find step "${stepName}" in the current funnel.`
      );
    }

    const before =
      await this.snapshot(page);

    await this.realClick(
      page,
      point
    );

    try {
      await page.waitForFunction(
        ({ oldUrl, step }) => {
          const body =
            (
              document.body
                ?.innerText ||
              ""
            ).toLowerCase();

          return (
            location.href !== oldUrl ||
            (
              body.includes(
                step.toLowerCase()
              ) &&
              body.includes(
                "overview"
              ) &&
              body.includes(
                "publishing"
              )
            )
          );
        },
        {
          timeout:
            15000,
          polling:
            300
        },
        {
          oldUrl:
            before.url,
          step:
            stepName
        }
      );
    } catch {}

    await sleep(1200);

    const after =
      await this.snapshot(page);

    const afterLower =
      after.body.toLowerCase();

    if (
      !afterLower.includes(
        stepName.toLowerCase()
      ) ||
      !afterLower.includes(
        "edit"
      )
    ) {
      throw new Error(
        `Step "${stepName}" was clicked but its overview could not be verified.`
      );
    }

    await this.storage.put(
      "currentStepName",
      stepName
    );

    return after;
  }


  async inspectFunnels() {
    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status:
          "browser-unavailable"
      }, 409);
    }

    let page =
      await this.chooseHighLevelPage(
        browser
      );

    if (!page) {
      return json({
        status:
          "no-highlevel-page"
      }, 409);
    }

    await this.navigateToFunnels(
      page
    );

    const data =
      await page.evaluate(() => {
        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        return {
          title:
            document.title,

          url:
            location.href,

          rows:
            Array.from(
              document.querySelectorAll(
                'tr, [role="row"]'
              )
            )
              .map(row =>
                clean(
                  row.innerText ||
                  row.textContent
                )
              )
              .filter(Boolean),

          bodyPreview:
            clean(
              document.body
                ?.innerText ||
              ""
            ).slice(
              0,
              8000
            )
        };
      });

    return json({
      status:
        "funnels-inspection-success",

      readOnly:
        true,

      funnels:
        data
    });
  }


  async openFunnel(request) {
    const args =
      await this.body(request);

    const name =
      String(
        args.name || ""
      ).trim();

    if (!name) {
      return json({
        status: "error",
        message:
          "Funnel name is required."
      }, 400);
    }

    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status:
          "browser-unavailable"
      }, 409);
    }

    let page =
      await this.chooseHighLevelPage(
        browser
      );

    if (!page) {
      return json({
        status:
          "no-highlevel-page"
      }, 409);
    }

    const result =
      await this.openStoredFunnel(
        page,
        name
      );

    return json({
      status:
        "funnel-opened",

      verified:
        true,

      funnelName:
        name,

      page: {
        title:
          result.title,

        url:
          result.url,

        bodyPreview:
          result.body.slice(
            0,
            8000
          )
      }
    });
  }


  async listFunnelSteps() {
    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status:
          "browser-unavailable"
      }, 409);
    }

    const page =
      await this.chooseHighLevelPage(
        browser
      );

    if (!page) {
      return json({
        status:
          "no-highlevel-page"
      }, 409);
    }

    await this.waitForHighLevel(page);

    const data =
      await this.snapshot(page);

    return json({
      status:
        "funnel-steps-inspection-success",

      readOnly:
        true,

      currentFunnel:
        await this.storage.get(
          "currentFunnelName"
        ) || null,

      result: {
        title:
          data.title,

        url:
          data.url,

        bodyPreview:
          data.body.slice(
            0,
            12000
          )
      }
    });
  }


  async inspectFunnelStep(request) {
    const args =
      await this.body(request);

    const name =
      String(
        args.name || ""
      ).trim();

    if (!name) {
      return json({
        status:
          "error",

        message:
          "Step/page name is required."
      }, 400);
    }

    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status:
          "browser-unavailable"
      }, 409);
    }

    const page =
      await this.chooseHighLevelPage(
        browser
      );

    if (!page) {
      return json({
        status:
          "no-highlevel-page"
      }, 409);
    }

    const funnelName =
      await this.storage.get(
        "currentFunnelName"
      );

    if (funnelName) {
      await this.ensureFunnelOpen(
        page,
        funnelName
      );
    }

    const result =
      await this.selectStepOverview(
        page,
        name
      );

    const controls =
      await page.evaluate(() => {
        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        return Array.from(
          document.querySelectorAll(
            'a, button, [role="button"], [role="link"]'
          )
        )
          .map(el => ({
            text:
              clean(
                el.innerText ||
                el.textContent ||
                el.getAttribute(
                  "aria-label"
                )
              ),

            href:
              el.tagName === "A"
                ? el.href
                : ""
          }))
          .filter(item =>
            item.text ||
            item.href
          )
          .slice(0, 250);
      });

    return json({
      status:
        "funnel-step-inspection-success",

      stepName:
        name,

      readOnly:
        true,

      result: {
        title:
          result.title,

        url:
          result.url,

        bodyPreview:
          result.body.slice(
            0,
            12000
          ),

        controls
      }
    });
  }


  async inspectFrame(frame) {
    try {
      return await frame.evaluate(() => {
        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        const body =
          clean(
            document.body
              ?.innerText ||
            ""
          );

        const lower =
          body.toLowerCase();

        const signals =
          [
            "save",
            "preview",
            "desktop",
            "mobile",
            "section",
            "row",
            "column",
            "element",
            "undo",
            "redo",
            "settings"
          ].filter(
            word =>
              lower.includes(word)
          );

        return {
          url:
            location.href,

          bodyPreview:
            body.slice(
              0,
              6000
            ),

          signals
        };
      });

    } catch (error) {
      return {
        url:
          frame.url(),

        error:
          error instanceof Error
            ? error.message
            : String(error)
      };
    }
  }


  async detectBuilder(page) {
    const snap =
      await this.snapshot(page);

    const lower =
      snap.body.toLowerCase();

    const urlLower =
      snap.url.toLowerCase();

    const urlSignals =
      (
        urlLower.includes(
          "builder"
        ) ||
        urlLower.includes(
          "editor"
        ) ||
        urlLower.includes(
          "funnel-builder"
        )
      );

    const topSignals =
      [
        "save",
        "preview",
        "desktop",
        "mobile",
        "undo",
        "redo",
        "sections",
        "elements"
      ].filter(
        word =>
          lower.includes(word)
      );

    const frames = [];

    for (
      const frame
      of page.frames()
    ) {
      frames.push(
        await this.inspectFrame(
          frame
        )
      );
    }

    const frameSignals =
      frames.reduce(
        (count, frame) =>
          count +
          (
            Array.isArray(
              frame.signals
            )
              ? frame.signals.length
              : 0
          ),
        0
      );

    const isBuilder =
      urlSignals ||
      topSignals.length >= 4 ||
      frameSignals >= 5;

    return {
      isBuilder,
      title:
        snap.title,
      url:
        snap.url,
      topSignals,
      frameSignals,
      bodyPreview:
        snap.body.slice(
          0,
          5000
        ),
      frames
    };
  }


  async findBuilderPage(browser) {
    const pages =
      await browser.pages();

    for (
      const page
      of pages
    ) {
      try {
        const detection =
          await this.detectBuilder(
            page
          );

        if (
          detection.isBuilder
        ) {
          return {
            page,
            detection
          };
        }
      } catch {}
    }

    return null;
  }


  async openPageBuilder() {
    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status:
          "browser-unavailable"
      }, 409);
    }

    const existing =
      await this.findBuilderPage(
        browser
      );

    if (existing) {
      return json({
        status:
          "page-builder-open",

        verified:
          true,

        alreadyOpen:
          true,

        builder:
          existing.detection
      });
    }

    let page =
      await this.chooseHighLevelPage(
        browser
      );

    if (!page) {
      return json({
        status:
          "no-highlevel-page"
      }, 409);
    }

    const funnelName =
      await this.storage.get(
        "currentFunnelName"
      );

    const stepName =
      await this.storage.get(
        "currentStepName"
      );

    if (!funnelName) {
      return json({
        status:
          "no-current-funnel",

        message:
          "Open a funnel first."
      }, 409);
    }

    if (!stepName) {
      return json({
        status:
          "no-current-step",

        message:
          "Select a funnel step first."
      }, 409);
    }

    /*
     * THIS IS THE FIX:
     * restore the correct funnel and step overview
     * before searching for Edit.
     */
    await this.ensureFunnelOpen(
      page,
      funnelName
    );

    await this.selectStepOverview(
      page,
      stepName
    );

    const before =
      await this.snapshot(page);

    const editPoint =
      await this.findExactClickPoint(
        page,
        "Edit",
        true
      );

    if (!editPoint) {
      return json({
        status:
          "edit-control-not-found",

        funnelName,
        stepName,

        message:
          "The correct funnel and step overview were restored, but the exact Edit control could not be located.",

        page: {
          title:
            before.title,
          url:
            before.url,
          bodyPreview:
            before.body.slice(
              0,
              5000
            )
        }
      }, 404);
    }

    const pagesBefore =
      await browser.pages();

    const urlsBefore =
      pagesBefore.map(
        p => p.url()
      );

    await this.realClick(
      page,
      editPoint
    );

    let builder =
      null;

    const start =
      Date.now();

    while (
      Date.now() - start <
      30000
    ) {
      await sleep(750);

      builder =
        await this.findBuilderPage(
          browser
        );

      if (builder) {
        break;
      }
    }

    if (!builder) {
      const pages =
        await browser.pages();

      const diagnostics = [];

      for (
        let i = 0;
        i < pages.length;
        i++
      ) {
        try {
          const snap =
            await this.snapshot(
              pages[i]
            );

          diagnostics.push({
            index: i,
            newPage:
              !urlsBefore.includes(
                snap.url
              ),
            title:
              snap.title,
            url:
              snap.url,
            bodyPreview:
              snap.body.slice(
                0,
                3000
              )
          });
        } catch {}
      }

      return json({
        status:
          "page-builder-not-verified",

        message:
          "Edit was clicked from the verified step overview, but no builder could yet be verified.",

        funnelName,
        stepName,
        editPoint,
        pages:
          diagnostics
      }, 409);
    }

    await this.storage.put(
      "builderUrl",
      builder.page.url()
    );

    return json({
      status:
        "page-builder-open",

      verified:
        true,

      funnelName,
      stepName,

      builder:
        builder.detection
    });
  }


  async inspectPageBuilder() {
    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status:
          "browser-unavailable"
      }, 409);
    }

    const found =
      await this.findBuilderPage(
        browser
      );

    if (!found) {
      return json({
        status:
          "page-builder-not-open",

        message:
          "No verified HighLevel page builder is currently open."
      }, 409);
    }

    const page =
      found.page;

    const controls =
      await page.evaluate(() => {
        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        const visible = el => {
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

        return Array.from(
          document.querySelectorAll(
            'button, a, [role="button"], [role="link"], input, textarea, select'
          )
        )
          .filter(visible)
          .map(el => ({
            tag:
              el.tagName.toLowerCase(),

            text:
              clean(
                el.innerText ||
                el.textContent ||
                el.getAttribute(
                  "aria-label"
                ) ||
                el.getAttribute(
                  "placeholder"
                )
              ),

            href:
              el.tagName === "A"
                ? el.href
                : ""
          }))
          .filter(item =>
            item.text ||
            item.href
          )
          .slice(0, 400);
      });

    const frames = [];

    for (
      const frame
      of page.frames()
    ) {
      frames.push(
        await this.inspectFrame(
          frame
        )
      );
    }

    return json({
      status:
        "page-builder-inspection-success",

      verified:
        true,

      readOnly:
        true,

      builder: {
        title:
          await page.title(),

        url:
          page.url(),

        controls,
        frames
      }
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
        reachable = false;
      }
    }

    let builderOpen =
      false;

    if (reachable) {
      try {
        builderOpen =
          Boolean(
            await this.findBuilderPage(
              this.browser
            )
          );
      } catch {}
    }

    return json({
      status: "ok",

      sessionId:
        sessionId || null,

      browserReachable:
        reachable,

      currentFunnel:
        await this.storage.get(
          "currentFunnelName"
        ) || null,

      currentStep:
        await this.storage.get(
          "currentStepName"
        ) || null,

      currentFunnelUrl:
        await this.storage.get(
          "currentFunnelUrl"
        ) || null,

      builderUrl:
        await this.storage.get(
          "builderUrl"
        ) || null,

      builderOpen
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
          return await this.startLoginBrowser();

        case "/api/status":
          return await this.status();

        case "/api/sites/inspect":
          return await this.inspectFunnels();

        case "/api/funnel/open":
          return await this.openFunnel(
            request
          );

        case "/api/funnel/steps":
          return await this.listFunnelSteps();

        case "/api/funnel/step/inspect":
          return await this.inspectFunnelStep(
            request
          );

        case "/api/builder/open":
          return await this.openPageBuilder();

        case "/api/builder/inspect":
          return await this.inspectPageBuilder();

        default:
          return json({
            error:
              "Unknown action"
          }, 404);
      }

    } catch (error) {
      return json({
        status:
          "error",

        message:
          error instanceof Error
            ? error.message
            : String(error)
      }, 500);
    }
  }
}
