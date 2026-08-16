import { DurableObject } from "cloudflare:workers";
import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    const obj = env.BROWSER_MANAGER.getByName("cga-ghl");
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

  async ensureBrowser() {
    if (!this.browser || !this.browser.isConnected()) {
      this.browser = await puppeteer.launch(this.env.BROWSER, {
        keep_alive: 600000
      });
    }

    return this.browser;
  }

  async keepAlive() {
    const alarm = await this.storage.getAlarm();

    if (alarm === null) {
      await this.storage.setAlarm(Date.now() + 5 * 60 * 1000);
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
