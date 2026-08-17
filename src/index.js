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
      max-width: 950px;
      margin: 40px auto;
      padding: 0 20px;
    }

    input, textarea {
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

  <input id="funnelName" placeholder="Funnel name">

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

  <input id="stepName" placeholder="Step/page name">

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

  <button onclick="run('/api/builder/elements')">
    Inspect Builder Elements
  </button>
</section>

<section>
  <h3>Edit Builder Text</h3>

  <label>CSS selector</label>
  <textarea id="editSelector"></textarea>

  <label>Expected current text</label>
  <textarea id="expectedText"></textarea>

  <label>New text</label>
  <textarea id="newText"></textarea>

  <button onclick="runWithBody('/api/builder/edit-text', {
    selector: document.getElementById('editSelector').value,
    expectedText: document.getElementById('expectedText').value,
    newText: document.getElementById('newText').value
  })">
    Edit Text
  </button>

</section>

<section>
  <h3>Builder Design Controls</h3>

  <button onclick="run('/api/builder/layout-inspect')">
    Inspect Layout / Styles
  </button>

  <label>CSS selector</label>
  <textarea id="styleSelector" placeholder="#headline-abc123"></textarea>

  <label>Expected current text (optional)</label>
  <textarea id="styleExpectedText"></textarea>

  <label>Styles JSON</label>
  <textarea id="styleJson" rows="10" placeholder='{"color":"#FFFFFF","backgroundColor":"#07111C","fontSize":"64px","fontWeight":"700","lineHeight":"1.05","paddingTop":"24px","paddingBottom":"24px","borderRadius":"12px"}'></textarea>

  <button onclick="applyBuilderStyles()">Apply Styles</button>

  <button onclick="runWithBody('/api/builder/element-html', {
    selector: document.getElementById('styleSelector').value
  })">
    Inspect Selected Element
  </button>

  <button onclick="run('/api/builder/save')">
    Save Builder
  </button>

  <button onclick="runWithBody('/api/builder/publish', {
    confirm: true
  })">
    Publish Builder
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

async function applyBuilderStyles() {
  const result = document.getElementById("result");
  let styles = {};
  try {
    styles = JSON.parse(document.getElementById("styleJson").value || "{}");
  } catch (error) {
    result.textContent = "Styles JSON is invalid: " + error.message;
    return;
  }
  return runWithBody('/api/builder/style', {
    selector: document.getElementById('styleSelector').value,
    expectedText: document.getElementById('styleExpectedText').value,
    styles
  });
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

    if (
      request.headers.get("x-admin-key") !==
      env.BROWSER_ADMIN_KEY
    ) {
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


  clean(value) {
    return String(value || "")
      .replace(/\\s+/g, " ")
      .trim();
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

    this.browser = await puppeteer.launch(
      this.env.BROWSER,
      {
        keep_alive: 600000
      }
    );

    const pages = await this.browser.pages();
    const page =
      pages[0] || await this.browser.newPage();

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
      this.browser = await puppeteer.connect(
        this.env.BROWSER,
        sessionId
      );

      return this.browser;

    } catch {
      return null;
    }
  }


  async highLevelPages(browser) {
    const pages = await browser.pages();

    return pages.filter(
      page =>
        page.url().includes(
          "app.gohighlevel.com"
        )
    );
  }


  async waitForHighLevel(page) {
    try {
      await page.waitForSelector(
        "body",
        { timeout: 15000 }
      );
    } catch {}

    await sleep(1000);
  }


  async snapshot(page) {
    return page.evaluate(() => ({
      title: document.title,
      url: location.href,
      body:
        String(
          document.body?.innerText || ""
        )
          .replace(/\\s+/g, " ")
          .trim()
          .slice(0, 15000)
    }));
  }


  async findBuilderPage(browser) {
    const pages = await browser.pages();

    for (const page of pages) {
      const url =
        page.url().toLowerCase();

      if (
        url.includes("/page-builder/")
      ) {
        return page;
      }

      for (const frame of page.frames()) {
        if (
          frame.url().includes(
            "page-builder.leadconnectorhq.com"
          )
        ) {
          return page;
        }
      }
    }

    return null;
  }


  async getBuilderFrame(page) {
    const frames = page.frames();

    const exact =
      frames.find(frame =>
        frame.url().includes(
          "page-builder.leadconnectorhq.com"
        )
      );

    if (exact) {
      return exact;
    }

    for (const frame of frames) {
      if (frame === page.mainFrame()) {
        continue;
      }

      try {
        const textLength =
          await frame.evaluate(() =>
            (
              document.body?.innerText || ""
            ).trim().length
          );

        if (textLength > 500) {
          return frame;
        }

      } catch {}
    }

    return null;
  }


  async getBuilderContext() {
    const browser =
      await this.connectToBrowser();

    if (!browser) {
      throw new Error(
        "HighLevel browser session is unavailable."
      );
    }

    const page =
      await this.findBuilderPage(browser);

    if (!page) {
      throw new Error(
        "No verified HighLevel page builder is open."
      );
    }

    const frame =
      await this.getBuilderFrame(page);

    if (!frame) {
      throw new Error(
        "HighLevel builder content frame was not found."
      );
    }

    return {
      browser,
      page,
      frame
    };
  }


  async findExactClickPoint(
    page,
    text
  ) {
    return page.evaluate(target => {
      const clean = value =>
        String(value || "")
          .replace(/\\s+/g, " ")
          .trim();

      const wanted =
        clean(target).toLowerCase();

      const candidates =
        Array.from(
          document.querySelectorAll(
            'button,a,[role="button"],[role="link"],div,span,td'
          )
        )
          .filter(el => {
            const rect =
              el.getBoundingClientRect();

            return (
              rect.width > 0 &&
              rect.height > 0 &&
              clean(
                el.innerText ||
                el.textContent ||
                el.getAttribute(
                  "aria-label"
                )
              ).toLowerCase() === wanted
            );
          });

      if (!candidates.length) {
        return null;
      }

      const selected =
        candidates.find(
          el =>
            el.tagName === "BUTTON"
        ) ||
        candidates.find(
          el =>
            el.getAttribute("role") ===
            "button"
        ) ||
        candidates.find(
          el =>
            el.tagName === "A"
        ) ||
        candidates.find(
          el =>
            getComputedStyle(el).cursor ===
            "pointer"
        ) ||
        candidates[0];

      selected.scrollIntoView({
        block: "center",
        inline: "center"
      });

      const rect =
        selected.getBoundingClientRect();

      return {
        x:
          rect.left +
          rect.width / 2,
        y:
          rect.top +
          rect.height / 2
      };

    }, text);
  }


  async realClick(page, point) {
    await page.mouse.move(
      point.x,
      point.y
    );

    await sleep(80);
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();
    await sleep(400);
  }


  async navigateToFunnels(page) {
    const url =
      `${GHL_BASE}/v2/location/${LOCATION_ID}/funnels-websites/funnels`;

    if (page.url() !== url) {
      await page.goto(
        url,
        {
          waitUntil: "domcontentloaded",
          timeout: 30000
        }
      );
    }

    await this.waitForHighLevel(page);
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
            'tr,[role="row"]'
          )
        );

      const row =
        rows.find(el =>
          clean(
            el.innerText ||
            el.textContent
          )
            .toLowerCase()
            .includes(wanted)
        );

      if (!row) {
        return null;
      }

      const target =
        Array.from(
          row.querySelectorAll(
            "div,span,a,button"
          )
        )
          .find(el => {
            const rect =
              el.getBoundingClientRect();

            return (
              clean(
                el.innerText ||
                el.textContent
              ).toLowerCase() === wanted &&
              getComputedStyle(el).cursor ===
                "pointer" &&
              rect.width > 20 &&
              rect.height > 10
            );
          });

      if (!target) {
        return null;
      }

      target.scrollIntoView({
        block: "center"
      });

      const rect =
        target.getBoundingClientRect();

      return {
        x:
          rect.left +
          rect.width / 2,
        y:
          rect.top +
          rect.height / 2
      };

    }, funnelName);
  }


  async openStoredFunnel(
    page,
    funnelName
  ) {
    await this.navigateToFunnels(page);

    const before = page.url();

    const point =
      await this.findFunnelClickPoint(
        page,
        funnelName
      );

    if (!point) {
      throw new Error(
        `Could not find funnel "${funnelName}".`
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
        before
      );
    } catch {}

    await sleep(1000);

    const snap =
      await this.snapshot(page);

    if (
      snap.url.endsWith(
        "/funnels-websites/funnels"
      )
    ) {
      throw new Error(
        "Funnel click did not navigate."
      );
    }

    await this.storage.put(
      "currentFunnelName",
      funnelName
    );

    await this.storage.put(
      "currentFunnelUrl",
      snap.url
    );

    return snap;
  }


  async selectStepOverview(
    page,
    stepName
  ) {
    const current =
      await this.snapshot(page);

    const lower =
      current.body.toLowerCase();

    if (
      lower.includes(
        stepName.toLowerCase()
      ) &&
      lower.includes("overview") &&
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
        stepName
      );

    if (!point) {
      throw new Error(
        `Could not find step "${stepName}".`
      );
    }

    await this.realClick(
      page,
      point
    );

    await sleep(1200);

    const after =
      await this.snapshot(page);

    if (
      !after.body
        .toLowerCase()
        .includes(
          stepName.toLowerCase()
        )
    ) {
      throw new Error(
        "Step overview could not be verified."
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
        status: "browser-unavailable"
      }, 409);
    }

    const pages =
      await this.highLevelPages(browser);

    const page =
      pages[0] ||
      await browser.newPage();

    await this.navigateToFunnels(page);

    const result =
      await this.snapshot(page);

    return json({
      status:
        "funnels-inspection-success",
      readOnly: true,
      funnels: result
    });
  }


  async openFunnel(request) {
    const args =
      await this.body(request);

    const name =
      String(args.name || "").trim();

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
        status: "browser-unavailable"
      }, 409);
    }

    const pages =
      await this.highLevelPages(browser);

    const page =
      pages[0] ||
      await browser.newPage();

    const result =
      await this.openStoredFunnel(
        page,
        name
      );

    return json({
      status: "funnel-opened",
      verified: true,
      funnelName: name,
      page: result
    });
  }


  async listFunnelSteps() {
    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status: "browser-unavailable"
      }, 409);
    }

    const pages =
      await this.highLevelPages(browser);

    if (!pages.length) {
      return json({
        status: "no-highlevel-page"
      }, 409);
    }

    const result =
      await this.snapshot(pages[0]);

    return json({
      status:
        "funnel-steps-inspection-success",
      readOnly: true,
      currentFunnel:
        await this.storage.get(
          "currentFunnelName"
        ) || null,
      result
    });
  }


  async inspectFunnelStep(request) {
    const args =
      await this.body(request);

    const name =
      String(args.name || "").trim();

    if (!name) {
      return json({
        status: "error",
        message:
          "Step/page name is required."
      }, 400);
    }

    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status: "browser-unavailable"
      }, 409);
    }

    const pages =
      await this.highLevelPages(browser);

    if (!pages.length) {
      return json({
        status: "no-highlevel-page"
      }, 409);
    }

    const page = pages[0];

    const result =
      await this.selectStepOverview(
        page,
        name
      );

    return json({
      status:
        "funnel-step-inspection-success",
      stepName: name,
      readOnly: true,
      result
    });
  }


  async openPageBuilder() {
    const browser =
      await this.connectToBrowser();

    if (!browser) {
      return json({
        status: "browser-unavailable"
      }, 409);
    }

    const existing =
      await this.findBuilderPage(
        browser
      );

    if (existing) {
      const frame =
        await this.getBuilderFrame(
          existing
        );

      return json({
        status: "page-builder-open",
        verified: Boolean(frame),
        alreadyOpen: true,
        url: existing.url()
      });
    }

    const pages =
      await this.highLevelPages(browser);

    if (!pages.length) {
      return json({
        status: "no-highlevel-page"
      }, 409);
    }

    const page = pages[0];

    const funnel =
      await this.storage.get(
        "currentFunnelName"
      );

    const step =
      await this.storage.get(
        "currentStepName"
      );

    if (!funnel || !step) {
      return json({
        status:
          "funnel-or-step-not-selected"
      }, 409);
    }

    const snap =
      await this.snapshot(page);

    if (
      !snap.body.includes(step) ||
      !snap.body.includes("Edit")
    ) {
      await this.openStoredFunnel(
        page,
        funnel
      );

      await this.selectStepOverview(
        page,
        step
      );
    }

    const point =
      await this.findExactClickPoint(
        page,
        "Edit"
      );

    if (!point) {
      return json({
        status:
          "edit-control-not-found"
      }, 404);
    }

    await this.realClick(
      page,
      point
    );

    let builderPage = null;

    for (let i = 0; i < 40; i++) {
      await sleep(750);

      builderPage =
        await this.findBuilderPage(
          browser
        );

      if (builderPage) {
        break;
      }
    }

    if (!builderPage) {
      return json({
        status:
          "page-builder-not-verified"
      }, 409);
    }

    const frame =
      await this.getBuilderFrame(
        builderPage
      );

    if (!frame) {
      return json({
        status:
          "builder-frame-not-found"
      }, 409);
    }

    await this.storage.put(
      "builderUrl",
      builderPage.url()
    );

    return json({
      status: "page-builder-open",
      verified: true,
      funnelName: funnel,
      stepName: step,
      builderUrl:
        builderPage.url(),
      frameUrl:
        frame.url()
    });
  }


  async inspectPageBuilder() {
    try {
      const { page, frame } =
        await this.getBuilderContext();

      const body =
        await frame.evaluate(() =>
          (
            document.body?.innerText || ""
          ).slice(0, 15000)
        );

      return json({
        status:
          "page-builder-inspection-success",
        verified: true,
        readOnly: true,
        builder: {
          url: page.url(),
          frameUrl: frame.url(),
          bodyPreview: body
        }
      });

    } catch (error) {
      return json({
        status:
          "page-builder-not-open",
        message:
          error.message
      }, 409);
    }
  }


  async inspectBuilderElements() {
    try {
      const { page, frame } =
        await this.getBuilderContext();

      const result =
        await frame.evaluate(() => {
          const clean = value =>
            String(value || "")
              .replace(/\\s+/g, " ")
              .trim();

          const visible = el => {
            const rect =
              el.getBoundingClientRect();

            const style =
              getComputedStyle(el);

            return (
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
            );
          };

          const candidates =
            Array.from(
              document.querySelectorAll(
                [
                  "h1",
                  "h2",
                  "h3",
                  "h4",
                  "h5",
                  "h6",
                  "p",
                  "button",
                  "a",
                  ".editor",
                  ".element"
                ].join(",")
              )
            )
              .filter(visible)
              .map((el, index) => ({
                index,
                tag:
                  el.tagName.toLowerCase(),
                id:
                  el.id || "",
                text:
                  clean(
                    el.innerText ||
                    el.textContent
                  ).slice(0, 500),
                classes:
                  Array.from(
                    el.classList || []
                  ).slice(0, 10)
              }))
              .filter(item =>
                item.text || item.id
              );

          return {
            count: candidates.length,
            candidates:
              candidates.slice(0, 600)
          };
        });

      return json({
        status:
          "builder-elements-inspection-success",
        verified: true,
        readOnly: true,
        builderUrl: page.url(),
        frameUrl: frame.url(),
        ...result
      });

    } catch (error) {
      return json({
        status:
          "builder-elements-inspection-failed",
        message:
          error.message
      }, 409);
    }
  }


  /*
   * REAL WRITE ACTION
   *
   * The selector should be the exact selector
   * returned by our DOM inspection.
   *
   * expectedText protects against editing the
   * wrong element if HighLevel's DOM changes.
   */
  async editBuilderText(request) {
    const args =
      await this.body(request);

    const selector =
      String(
        args.selector || ""
      ).trim();

    const expectedText =
      String(
        args.expectedText || ""
      ).trim();

    const newText =
      String(
        args.newText || ""
      );

    if (!selector) {
      return json({
        status: "error",
        message:
          "selector is required."
      }, 400);
    }

    if (!newText.trim()) {
      return json({
        status: "error",
        message:
          "newText is required."
      }, 400);
    }

    const {
      page,
      frame
    } =
      await this.getBuilderContext();

    const target =
      await frame.$(
        selector
      );

    if (!target) {
      return json({
        status:
          "builder-edit-target-not-found",
        selector
      }, 404);
    }

    const beforeText =
      await frame.$eval(
        selector,
        el =>
          String(
            el.innerText ||
            el.textContent ||
            ""
          )
            .replace(/\\s+/g, " ")
            .trim()
      );

    if (
      expectedText &&
      beforeText !==
        this.clean(expectedText)
    ) {
      return json({
        status:
          "builder-edit-safety-check-failed",
        message:
          "The current text does not match expectedText, so no edit was made.",
        selector,
        expectedText:
          this.clean(
            expectedText
          ),
        actualText:
          beforeText
      }, 409);
    }

    /*
     * Bring the element on screen.
     */
    await frame.$eval(
      selector,
      el =>
        el.scrollIntoView({
          block: "center",
          inline: "center"
        })
    );

    await sleep(300);

    /*
     * HighLevel's TipTap / ProseMirror text
     * becomes editable after clicking the text
     * element. Use genuine browser interaction.
     */
    await target.click({
      clickCount: 2,
      delay: 80
    });

    await sleep(500);

    /*
     * Find the active TipTap editor associated
     * with this element.
     */
    const editableInfo =
      await frame.evaluate(
        selector => {
          const selected =
            document.querySelector(
              selector
            );

          if (!selected) {
            return {
              found: false
            };
          }

          const wrapper =
            selected.closest(
              ".element"
            ) ||
            selected.parentElement;

          const editors =
            [
              selected.matches(
                ".tiptap.ProseMirror"
              )
                ? selected
                : null,

              selected.closest(
                ".tiptap.ProseMirror"
              ),

              wrapper
                ? wrapper.querySelector(
                    ".tiptap.ProseMirror"
                  )
                : null
            ]
              .filter(Boolean);

          const editor =
            editors.find(
              el =>
                el.getAttribute(
                  "contenteditable"
                ) === "true" ||
                el.isContentEditable
            ) ||
            editors[0];

          if (!editor) {
            return {
              found: false
            };
          }

          editor.scrollIntoView({
            block: "center"
          });

          editor.focus();

          return {
            found: true,
            contenteditable:
              editor.getAttribute(
                "contenteditable"
              ),
            text:
              (
                editor.innerText ||
                editor.textContent ||
                ""
              )
                .replace(/\\s+/g, " ")
                .trim()
          };
        },
        selector
      );

    if (!editableInfo.found) {
      return json({
        status:
          "builder-inline-editor-not-found",
        message:
          "The target was found, but HighLevel did not expose its TipTap editor after clicking. No text was changed.",
        selector,
        beforeText
      }, 409);
    }

    /*
     * Focus is now inside the iframe editor.
     * Browser keyboard input goes to that focused
     * ProseMirror element.
     */
    await page.keyboard.down(
      "Control"
    );

    await page.keyboard.press(
      "A"
    );

    await page.keyboard.up(
      "Control"
    );

    await sleep(100);

    await page.keyboard.type(
      newText,
      {
        delay: 8
      }
    );

    await sleep(700);

    /*
     * Blur the editor so Vue/TipTap commits its
     * local model update.
     */
    await frame.evaluate(() => {
      const active =
        document.activeElement;

      if (
        active &&
        typeof active.blur ===
          "function"
      ) {
        active.blur();
      }
    });

    await sleep(600);

    const afterText =
      await frame.$eval(
        selector,
        el =>
          String(
            el.innerText ||
            el.textContent ||
            ""
          )
            .replace(/\\s+/g, " ")
            .trim()
      );

    const expectedAfter =
      this.clean(newText);

    if (
      afterText !==
      expectedAfter
    ) {
      return json({
        status:
          "builder-text-edit-not-verified",
        message:
          "HighLevel received the edit interaction, but the resulting visible text did not exactly match the requested text.",
        selector,
        beforeText,
        requestedText:
          expectedAfter,
        actualText:
          afterText
      }, 409);
    }

    await this.storage.put(
      "builderHasUnsavedChanges",
      true
    );

    return json({
      status:
        "builder-text-edited",
      verified: true,
      saved: false,
      published: false,
      selector,
      beforeText,
      afterText
    });
  }


  async inspectBuilderLayout() {
    try {
      const { page, frame } = await this.getBuilderContext();
      const result = await frame.evaluate(() => {
        const clean = value => String(value || "").replace(/\s+/g, " ").trim();
        const visible = el => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return r.width > 0 && r.height > 0 && s.display !== "none" && s.visibility !== "hidden";
        };
        const selectorFor = el => {
          if (el.id) return `#${CSS.escape(el.id)}`;
          const dataId = el.getAttribute("data-id") || el.getAttribute("data-element-id") || el.getAttribute("data-section-id");
          if (dataId) {
            const attr = el.hasAttribute("data-id") ? "data-id" : el.hasAttribute("data-element-id") ? "data-element-id" : "data-section-id";
            return `[${attr}="${CSS.escape(dataId)}"]`;
          }
          const classes = Array.from(el.classList || []).filter(Boolean).slice(0, 3);
          return el.tagName.toLowerCase() + classes.map(c => `.${CSS.escape(c)}`).join("");
        };
        const nodes = Array.from(document.querySelectorAll(
          "section,.section,[class*='section'],.row,[class*='row'],.col,[class*='col'],.element,[class*='element'],h1,h2,h3,h4,p,button,a,img"
        )).filter(visible).slice(0, 800).map((el, index) => {
          const r = el.getBoundingClientRect();
          const s = getComputedStyle(el);
          return {
            index, selector: selectorFor(el), tag: el.tagName.toLowerCase(), id: el.id || "",
            text: clean(el.innerText || el.textContent).slice(0, 220),
            classes: Array.from(el.classList || []).slice(0, 12),
            rect: {x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height)},
            style: {
              color:s.color, backgroundColor:s.backgroundColor, fontFamily:s.fontFamily, fontSize:s.fontSize,
              fontWeight:s.fontWeight, lineHeight:s.lineHeight, letterSpacing:s.letterSpacing, textAlign:s.textAlign,
              padding:s.padding, margin:s.margin, borderRadius:s.borderRadius, width:s.width, maxWidth:s.maxWidth, display:s.display
            }
          };
        });
        return {viewport:{width:window.innerWidth,height:window.innerHeight}, count:nodes.length, nodes};
      });
      return json({status:"builder-layout-inspection-success",verified:true,readOnly:true,builderUrl:page.url(),frameUrl:frame.url(),...result});
    } catch (error) {
      return json({status:"builder-layout-inspection-failed",message:error.message},409);
    }
  }

  async inspectBuilderElement(request) {
    const args = await this.body(request);
    const selector = String(args.selector || "").trim();
    if (!selector) return json({status:"error",message:"selector is required."},400);
    try {
      const { page, frame } = await this.getBuilderContext();
      const result = await frame.evaluate(selector => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          tag:el.tagName.toLowerCase(), id:el.id || "",
          text:String(el.innerText || el.textContent || "").replace(/\s+/g," ").trim().slice(0,1000),
          classes:Array.from(el.classList || []), outerHTML:el.outerHTML.slice(0,12000),
          rect:{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)},
          computedStyle:{
            color:s.color,backgroundColor:s.backgroundColor,fontFamily:s.fontFamily,fontSize:s.fontSize,fontWeight:s.fontWeight,
            lineHeight:s.lineHeight,letterSpacing:s.letterSpacing,textAlign:s.textAlign,padding:s.padding,margin:s.margin,
            border:s.border,borderRadius:s.borderRadius,width:s.width,maxWidth:s.maxWidth,minHeight:s.minHeight,display:s.display,
            justifyContent:s.justifyContent,alignItems:s.alignItems
          }
        };
      }, selector);
      if (!result) return json({status:"builder-element-not-found",selector},404);
      return json({status:"builder-element-inspection-success",verified:true,readOnly:true,builderUrl:page.url(),frameUrl:frame.url(),selector,result});
    } catch (error) {
      return json({status:"builder-element-inspection-failed",message:error.message},409);
    }
  }

  async styleBuilderElement(request) {
    const args = await this.body(request);
    const selector = String(args.selector || "").trim();
    const expectedText = String(args.expectedText || "").trim();
    const styles = args.styles && typeof args.styles === "object" && !Array.isArray(args.styles) ? args.styles : {};
    if (!selector) return json({status:"error",message:"selector is required."},400);
    if (!Object.keys(styles).length) return json({status:"error",message:"styles must contain at least one CSS property."},400);

    const allowed = new Set([
      "color","backgroundColor","fontFamily","fontSize","fontWeight","lineHeight","letterSpacing","textAlign","textTransform","opacity",
      "padding","paddingTop","paddingRight","paddingBottom","paddingLeft","margin","marginTop","marginRight","marginBottom","marginLeft",
      "border","borderWidth","borderStyle","borderColor","borderRadius","width","maxWidth","minWidth","height","minHeight","maxHeight",
      "display","flexDirection","justifyContent","alignItems","gap","overflow","objectFit","objectPosition","boxShadow"
    ]);
    const invalid = Object.keys(styles).filter(k => !allowed.has(k));
    if (invalid.length) return json({status:"builder-style-property-not-allowed",invalid,allowed:Array.from(allowed)},400);

    const { frame } = await this.getBuilderContext();
    const before = await frame.evaluate(({selector,expectedText}) => {
      const el = document.querySelector(selector);
      if (!el) return {found:false};
      const clean = v => String(v || "").replace(/\s+/g," ").trim();
      const text = clean(el.innerText || el.textContent || "");
      return {found:true,text,expectedMatches:!expectedText || text === clean(expectedText)};
    }, {selector,expectedText});

    if (!before.found) return json({status:"builder-style-target-not-found",selector},404);
    if (!before.expectedMatches) return json({
      status:"builder-style-safety-check-failed",message:"Current text does not match expectedText; no style change was made.",
      selector,expectedText:this.clean(expectedText),actualText:before.text
    },409);

    const result = await frame.evaluate(({selector,styles}) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const before = {};
      for (const key of Object.keys(styles)) before[key] = getComputedStyle(el)[key] || el.style[key] || "";
      for (const [key,value] of Object.entries(styles)) el.style[key] = String(value);
      el.dispatchEvent(new Event("input",{bubbles:true}));
      el.dispatchEvent(new Event("change",{bubbles:true}));
      const after = {};
      for (const key of Object.keys(styles)) after[key] = getComputedStyle(el)[key] || el.style[key] || "";
      return {before,requested:styles,after,inlineStyle:el.getAttribute("style") || ""};
    }, {selector,styles});

    if (!result) return json({status:"builder-style-target-not-found",selector},404);
    const verification = Object.entries(styles).map(([property,requested]) => ({
      property,requested:String(requested),actual:String(result.after[property] || "")
    }));
    if (verification.some(v => !v.actual)) return json({status:"builder-style-not-verified",selector,verification,result},409);

    await this.storage.put("builderHasUnsavedChanges",true);
    return json({
      status:"builder-style-applied",verified:true,saved:false,published:false,selector,verification,result,
      warning:"Verified in the current builder DOM. Use Save Builder to test whether HighLevel persists the style before publishing."
    });
  }


  async builderLastSavedText(
    frame
  ) {
    try {
      return await frame.evaluate(
        () => {
          const text =
            (
              document.body?.innerText ||
              ""
            );

          const match =
            text.match(
              /Last saved[^\\n]*/i
            );

          return match
            ? match[0].trim()
            : "";
        }
      );

    } catch {
      return "";
    }
  }


  async saveBuilder() {
    const {
      frame
    } =
      await this.getBuilderContext();

    const selector =
      "#pg-funnel-builder__btn--save";

    const button =
      await frame.$(
        selector
      );

    if (!button) {
      return json({
        status:
          "builder-save-button-not-found",
        selector
      }, 404);
    }

    const before =
      await this.builderLastSavedText(
        frame
      );

    await button.click();

    /*
     * HighLevel can take a moment to persist.
     */
    await sleep(2500);

    const after =
      await this.builderLastSavedText(
        frame
      );

    const saveButtonExists =
      Boolean(
        await frame.$(
          selector
        )
      );

    if (!saveButtonExists) {
      return json({
        status:
          "builder-save-not-verified",
        message:
          "Save was clicked but the builder state could not be verified."
      }, 409);
    }

    await this.storage.put(
      "builderHasUnsavedChanges",
      false
    );

    await this.storage.put(
      "builderLastSavedAt",
      new Date().toISOString()
    );

    return json({
      status:
        "builder-saved",
      verified: true,
      published: false,
      previousSaveLabel:
        before || null,
      currentSaveLabel:
        after || null
    });
  }


  async publishBuilder(request) {
    const args =
      await this.body(request);

    if (
      args.confirm !== true
    ) {
      return json({
        status:
          "publish-confirmation-required",
        message:
          "Publishing changes the live funnel. Call again with confirm=true."
      }, 409);
    }

    const {
      frame
    } =
      await this.getBuilderContext();

    const selector =
      "#pg-funnel-builder__btn--publish";

    const publishButton =
      await frame.$(
        selector
      );

    if (!publishButton) {
      return json({
        status:
          "builder-publish-button-not-found",
        selector
      }, 404);
    }

    await publishButton.click();

    await sleep(1200);

    /*
     * If HighLevel displays a confirmation dialog,
     * locate a visible confirmation button.
     */
    const confirmation =
      await frame.evaluate(() => {
        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim()
            .toLowerCase();

        const buttons =
          Array.from(
            document.querySelectorAll(
              'button,[role="button"]'
            )
          );

        const visible = el => {
          const rect =
            el.getBoundingClientRect();

          const style =
            getComputedStyle(el);

          return (
            rect.width > 0 &&
            rect.height > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden"
          );
        };

        const candidates =
          buttons
            .filter(visible)
            .map((el, index) => ({
              index,
              text:
                clean(
                  el.innerText ||
                  el.textContent ||
                  el.getAttribute(
                    "aria-label"
                  )
                )
            }));

        const match =
          candidates.find(
            item =>
              item.text ===
                "publish" ||
              item.text ===
                "confirm" ||
              item.text ===
                "publish changes"
          );

        return match || null;
      });

    if (confirmation) {
      const buttons =
        await frame.$$(
          'button,[role="button"]'
        );

      if (
        buttons[
          confirmation.index
        ]
      ) {
        await buttons[
          confirmation.index
        ].click();

        await sleep(2500);
      }
    }

    /*
     * Verify the page is still in the builder and
     * the live indicator remains present.
     */
    const result =
      await frame.evaluate(() => {
        const body =
          (
            document.body?.innerText ||
            ""
          );

        return {
          hasLiveIndicator:
            /•\\s*Live/i.test(
              body
            ) ||
            /\\bLive\\b/i.test(
              body
            ),

          hasPublishButton:
            Boolean(
              document.querySelector(
                "#pg-funnel-builder__btn--publish"
              )
            ),

          bodyPreview:
            body.slice(
              0,
              1500
            )
        };
      });

    if (
      !result.hasPublishButton
    ) {
      return json({
        status:
          "builder-publish-not-verified",
        message:
          "Publish was clicked but the builder could not be verified afterward.",
        result
      }, 409);
    }

    await this.storage.put(
      "builderHasUnsavedChanges",
      false
    );

    await this.storage.put(
      "builderLastPublishedAt",
      new Date().toISOString()
    );

    return json({
      status:
        "builder-published",
      verified: true,
      liveIndicator:
        result.hasLiveIndicator
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

    let builderOpen = false;

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
      builderUrl:
        await this.storage.get(
          "builderUrl"
        ) || null,
      builderOpen,
      builderHasUnsavedChanges:
        await this.storage.get(
          "builderHasUnsavedChanges"
        ) || false,
      builderLastSavedAt:
        await this.storage.get(
          "builderLastSavedAt"
        ) || null,
      builderLastPublishedAt:
        await this.storage.get(
          "builderLastPublishedAt"
        ) || null
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

        case "/api/builder/elements":
          return await this.inspectBuilderElements();

        case "/api/builder/edit-text":
          return await this.editBuilderText(
            request
          );

        case "/api/builder/layout-inspect":
          return await this.inspectBuilderLayout();

        case "/api/builder/element-html":
          return await this.inspectBuilderElement(
            request
          );

        case "/api/builder/style":
          return await this.styleBuilderElement(
            request
          );

        case "/api/builder/save":
          return await this.saveBuilder();

        case "/api/builder/publish":
          return await this.publishBuilder(
            request
          );

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
