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
    placeholder="Funnel name e.g. GCB Online Coaching Landing Page- Black"
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
  <h3>Step / Page</h3>

  <input
    id="stepName"
    placeholder="Step/page name"
  >

  <button onclick="runWithBody('/api/funnel/step/inspect', {
    name: document.getElementById('stepName').value
  })">
    Inspect Step
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

    const funnelDetail =
      pages.find(page => {
        const url = page.url();

        return (
          url.includes(
            "/funnels-websites/"
          ) &&
          !url.endsWith(
            "/funnels"
          )
        );
      });

    if (funnelDetail) {
      return funnelDetail;
    }

    const funnels =
      pages.find(
        page =>
          page.url().includes(
            "/funnels-websites/funnels"
          )
      );

    if (funnels) {
      return funnels;
    }

    const location =
      pages.find(
        page =>
          page.url().includes(
            "/v2/location/"
          )
      );

    return (
      location ||
      pages[pages.length - 1]
    );
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
            (
              document.body?.innerText ||
              ""
            )
              .replace(/\\s+/g, " ")
              .trim()
              .toLowerCase();

          return (
            text.length > 30 &&
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


  async getPageSnapshot(page) {
    return page.evaluate(() => {
      const clean = value =>
        String(value || "")
          .replace(/\\s+/g, " ")
          .trim();

      return {
        title:
          document.title,

        url:
          window.location.href,

        body:
          clean(
            document.body?.innerText ||
            ""
          ).slice(0, 12000)
      };
    });
  }


  async findFunnelRow(page, funnelName) {
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

          return (
            text === wanted ||
            text.startsWith(
              wanted + " "
            ) ||
            text.startsWith(
              wanted + "\\n"
            ) ||
            text.includes(wanted)
          );
        });

      if (!row) {
        return null;
      }

      const rowText =
        clean(
          row.innerText ||
          row.textContent
        );

      const descendants =
        Array.from(
          row.querySelectorAll(
            'a, button, [role="button"], [role="link"], td, div, span'
          )
        );

      const clickable =
        descendants
          .map((element, index) => {
            const style =
              window.getComputedStyle(
                element
              );

            const rect =
              element.getBoundingClientRect();

            const text =
              clean(
                element.innerText ||
                element.textContent ||
                element.getAttribute(
                  "aria-label"
                )
              );

            const tag =
              element.tagName
                .toLowerCase();

            const role =
              element.getAttribute(
                "role"
              ) || "";

            const href =
              tag === "a"
                ? element.href
                : "";

            return {
              index,
              tag,
              role,
              text,
              href,
              cursor:
                style.cursor,
              width:
                rect.width,
              height:
                rect.height
            };
          })
          .filter(item =>
            item.width > 0 &&
            item.height > 0
          );

      return {
        rowText,
        clickable
      };

    }, funnelName);
  }


  async clickExactFunnelRow(
    page,
    funnelName
  ) {
    const debugBefore =
      await this.findFunnelRow(
        page,
        funnelName
      );

    if (!debugBefore) {
      return {
        clicked: false,
        reason:
          "matching-row-not-found"
      };
    }

    const result =
      await page.evaluate(name => {
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

            return (
              text === wanted ||
              text.startsWith(
                wanted + " "
              ) ||
              text.includes(wanted)
            );
          });

        if (!row) {
          return {
            clicked: false,
            reason:
              "matching-row-not-found"
          };
        }

        /*
         * Prefer an actual anchor/link inside
         * the matched funnel row.
         */
        const anchors =
          Array.from(
            row.querySelectorAll(
              'a[href]'
            )
          );

        const meaningfulAnchor =
          anchors.find(anchor => {
            const href =
              anchor.getAttribute(
                "href"
              ) || "";

            return (
              href &&
              href !== "#" &&
              !href.startsWith(
                "javascript:"
              )
            );
          });

        if (meaningfulAnchor) {
          meaningfulAnchor
            .scrollIntoView({
              block: "center"
            });

          meaningfulAnchor.click();

          return {
            clicked: true,
            method:
              "row-anchor",
            href:
              meaningfulAnchor.href
          };
        }

        /*
         * Otherwise look for the funnel-name
         * element itself and its nearest
         * clickable ancestor.
         */
        const descendants =
          Array.from(
            row.querySelectorAll("*")
          );

        const nameElement =
          descendants.find(element => {
            const text =
              clean(
                element.innerText ||
                element.textContent
              ).toLowerCase();

            return text === wanted;
          });

        if (nameElement) {
          const clickable =
            nameElement.closest(
              'a, button, [role="button"], [role="link"]'
            );

          if (clickable) {
            clickable
              .scrollIntoView({
                block: "center"
              });

            clickable.click();

            return {
              clicked: true,
              method:
                "name-clickable-ancestor"
            };
          }

          /*
           * Some HighLevel Vue components
           * listen for pointer/mouse events on
           * a div rather than native click().
           */
          nameElement
            .scrollIntoView({
              block: "center"
            });

          const rect =
            nameElement
              .getBoundingClientRect();

          const options = {
            bubbles: true,
            cancelable: true,
            clientX:
              rect.left +
              rect.width / 2,
            clientY:
              rect.top +
              rect.height / 2
          };

          nameElement.dispatchEvent(
            new PointerEvent(
              "pointerdown",
              options
            )
          );

          nameElement.dispatchEvent(
            new MouseEvent(
              "mousedown",
              options
            )
          );

          nameElement.dispatchEvent(
            new PointerEvent(
              "pointerup",
              options
            )
          );

          nameElement.dispatchEvent(
            new MouseEvent(
              "mouseup",
              options
            )
          );

          nameElement.dispatchEvent(
            new MouseEvent(
              "click",
              options
            )
          );

          return {
            clicked: true,
            method:
              "name-event-sequence"
          };
        }

        /*
         * Final fallback: fire a full click
         * sequence on the exact matched row.
         */
        row.scrollIntoView({
          block: "center"
        });

        const rect =
          row.getBoundingClientRect();

        const options = {
          bubbles: true,
          cancelable: true,
          clientX:
            rect.left +
            Math.min(
              rect.width / 3,
              250
            ),
          clientY:
            rect.top +
            rect.height / 2
        };

        row.dispatchEvent(
          new PointerEvent(
            "pointerdown",
            options
          )
        );

        row.dispatchEvent(
          new MouseEvent(
            "mousedown",
            options
          )
        );

        row.dispatchEvent(
          new PointerEvent(
            "pointerup",
            options
          )
        );

        row.dispatchEvent(
          new MouseEvent(
            "mouseup",
            options
          )
        );

        row.dispatchEvent(
          new MouseEvent(
            "click",
            options
          )
        );

        return {
          clicked: true,
          method:
            "row-event-sequence"
        };

      }, funnelName);

    return {
      ...result,
      debugBefore
    };
  }


  async clickText(page, targetText) {
    return page.evaluate(target => {
      const clean = value =>
        String(value || "")
          .replace(/\\s+/g, " ")
          .trim();

      const wanted =
        clean(target)
          .toLowerCase();

      const candidates =
        Array.from(
          document.querySelectorAll(
            'a, button, tr, [role="row"], [role="button"], [role="link"], [class*="card"]'
          )
        );

      const exact =
        candidates.find(el =>
          clean(
            el.innerText ||
            el.textContent
          ).toLowerCase() === wanted
        );

      const contains =
        candidates.find(el =>
          clean(
            el.innerText ||
            el.textContent
          )
            .toLowerCase()
            .includes(wanted)
        );

      const element =
        exact || contains;

      if (!element) {
        return false;
      }

      const clickable =
        element.closest(
          'a, button, [role="button"], [role="link"]'
        ) || element;

      clickable.scrollIntoView({
        block: "center"
      });

      clickable.click();

      return true;

    }, targetText);
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

    const funnelsUrl =
      `${GHL_BASE}/v2/location/${LOCATION_ID}/funnels-websites/funnels`;

    if (
      !page.url().includes(
        "/funnels-websites/funnels"
      )
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

    await this.waitForHighLevel(
      page
    );

    const data =
      await page.evaluate(() => {
        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        const rows =
          Array.from(
            document.querySelectorAll(
              'tr, [role="row"], [class*="card"]'
            )
          )
            .map(row =>
              clean(
                row.innerText ||
                row.textContent
              )
            )
            .filter(Boolean);

        const body =
          clean(
            document.body
              ?.innerText ||
            ""
          );

        return {
          title:
            document.title,

          url:
            location.href,

          bodyPreview:
            body.slice(
              0,
              8000
            ),

          rows
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

    const funnelsUrl =
      `${GHL_BASE}/v2/location/${LOCATION_ID}/funnels-websites/funnels`;

    /*
     * Always start from the known funnels
     * list so the row lookup is deterministic.
     */
    if (
      !page.url().includes(
        "/funnels-websites/funnels"
      ) ||
      page.url() !== funnelsUrl
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

    await this.waitForHighLevel(
      page
    );

    const before =
      await this.getPageSnapshot(
        page
      );

    const clickResult =
      await this.clickExactFunnelRow(
        page,
        name
      );

    if (!clickResult.clicked) {
      return json({
        status:
          "funnel-not-found",

        funnelName:
          name,

        clickResult
      }, 404);
    }

    /*
     * HighLevel is a SPA, so navigation may
     * change URL OR replace the body without
     * a traditional browser navigation.
     */
    let navigated = false;

    try {
      await page.waitForFunction(
        ({ oldUrl, funnelName }) => {
          const clean = value =>
            String(value || "")
              .replace(/\\s+/g, " ")
              .trim()
              .toLowerCase();

          const currentUrl =
            window.location.href;

          const body =
            clean(
              document.body
                ?.innerText ||
              ""
            );

          const stillOnList =
            currentUrl.endsWith(
              "/funnels-websites/funnels"
            ) &&
            body.includes(
              "search for funnels"
            ) &&
            body.includes(
              "last updated"
            );

          const hasDetailSignals =
            body.includes(
              "funnel steps"
            ) ||
            body.includes(
              "settings"
            ) ||
            body.includes(
              "preview"
            ) ||
            (
              body.includes(
                clean(funnelName)
              ) &&
              !stillOnList
            );

          return (
            currentUrl !== oldUrl ||
            hasDetailSignals
          );
        },
        {
          timeout:
            20000,
          polling:
            300
        },
        {
          oldUrl:
            before.url,

          funnelName:
            name
        }
      );

      navigated = true;

    } catch {
      navigated = false;
    }

    await sleep(1800);

    const after =
      await this.getPageSnapshot(
        page
      );

    const stillOnFunnelsList =
      after.url.endsWith(
        "/funnels-websites/funnels"
      ) &&
      after.body
        .toLowerCase()
        .includes(
          "search for funnels"
        ) &&
      after.body
        .toLowerCase()
        .includes(
          "last updated"
        );

    /*
     * Critical fix:
     * never report success just because a
     * click event fired.
     */
    if (
      !navigated ||
      stillOnFunnelsList
    ) {
      return json({
        status:
          "funnel-click-did-not-open",

        funnelName:
          name,

        message:
          "The matching funnel row was found and clicked, but HighLevel remained on the funnel list. No false success has been reported.",

        clickResult,

        before: {
          url:
            before.url,

          title:
            before.title
        },

        after: {
          url:
            after.url,

          title:
            after.title,

          bodyPreview:
            after.body.slice(
              0,
              3000
            )
        }
      }, 409);
    }

    await this.storage.put(
      "currentFunnelName",
      name
    );

    await this.storage.put(
      "currentFunnelUrl",
      after.url
    );

    return json({
      status:
        "funnel-opened",

      verified:
        true,

      funnelName:
        name,

      clickMethod:
        clickResult.method,

      page: {
        title:
          after.title,

        url:
          after.url,

        bodyPreview:
          after.body.slice(
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

    await this.waitForHighLevel(
      page
    );

    const result =
      await page.evaluate(() => {
        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        const candidates =
          Array.from(
            document.querySelectorAll(
              'a, button, tr, [role="row"], [role="button"], [role="link"], [class*="card"]'
            )
          )
            .map(el => ({
              tag:
                el.tagName
                  .toLowerCase(),

              text:
                clean(
                  el.innerText ||
                  el.textContent
                ),

              href:
                el.tagName === "A"
                  ? el.href
                  : ""
            }))
            .filter(
              item =>
                item.text ||
                item.href
            );

        const useful =
          candidates.filter(
            item => {
              const haystack =
                (
                  item.text +
                  " " +
                  item.href
                ).toLowerCase();

              return (
                haystack.includes(
                  "step"
                ) ||
                haystack.includes(
                  "page"
                ) ||
                haystack.includes(
                  "edit"
                ) ||
                haystack.includes(
                  "preview"
                ) ||
                haystack.includes(
                  "publish"
                ) ||
                haystack.includes(
                  "settings"
                )
              );
            }
          );

        return {
          title:
            document.title,

          url:
            location.href,

          bodyPreview:
            clean(
              document.body
                ?.innerText ||
              ""
            ).slice(
              0,
              10000
            ),

          candidates:
            useful.slice(
              0,
              200
            )
        };
      });

    return json({
      status:
        "funnel-steps-inspection-success",

      currentFunnel:
        await this.storage.get(
          "currentFunnelName"
        ),

      currentFunnelUrl:
        await this.storage.get(
          "currentFunnelUrl"
        ),

      readOnly:
        true,

      result
    });
  }


  async inspectFunnelStep(
    request
  ) {
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

    await this.waitForHighLevel(
      page
    );

    const before =
      await this.getPageSnapshot(
        page
      );

    const clicked =
      await this.clickText(
        page,
        name
      );

    if (!clicked) {
      return json({
        status:
          "step-not-found",

        stepName:
          name
      }, 404);
    }

    try {
      await page.waitForFunction(
        oldUrl =>
          window.location.href !==
          oldUrl,
        {
          timeout:
            15000,
          polling:
            300
        },
        before.url
      );
    } catch {}

    await sleep(1800);

    const result =
      await page.evaluate(() => {
        const clean = value =>
          String(value || "")
            .replace(/\\s+/g, " ")
            .trim();

        const text =
          clean(
            document.body
              ?.innerText ||
            ""
          );

        const controls =
          Array.from(
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
            .filter(
              item =>
                item.text ||
                item.href
            );

        return {
          title:
            document.title,

          url:
            location.href,

          bodyPreview:
            text.slice(
              0,
              12000
            ),

          controls:
            controls.slice(
              0,
              250
            )
        };
      });

    return json({
      status:
        "funnel-step-inspection-success",

      stepName:
        name,

      readOnly:
        true,

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
        reachable,

      currentFunnel:
        await this.storage.get(
          "currentFunnelName"
        ) || null,

      currentFunnelUrl:
        await this.storage.get(
          "currentFunnelUrl"
        ) || null
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
