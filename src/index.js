import { DurableObject } from "cloudflare:workers";
import * as puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    const obj = env.BROWSER_MANAGER.getByName("cga-ghl");
    return obj.fetch(request);
  }
};

export class BrowserManager extends DurableObject {
  browser;
  storage;

  constructor(state, env) {
    super(state, env);
    this.storage = state.storage;
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
    const currentAlarm = await this.storage.getAlarm();

    if (currentAlarm == null) {
      await this.storage.setAlarm(Date.now() + 5 * 60 * 1000);
    }
  }

  async fetch(request) {
    try {
      const browser = await this.ensureBrowser();

      let pages = await browser.pages();

      let page =
        pages.find((p) =>
          p.url().includes("app.gohighlevel.com")
        ) || pages[0];

      if (!page) {
        page = await browser.newPage();
      }

      if (
        !page.url() ||
        page.url() === "about:blank"
      ) {
        await page.goto("https://app.gohighlevel.com", {
          waitUntil: "domcontentloaded",
          timeout: 30000
        });
      }

      await this.keepAlive();

      pages = await browser.pages();

      const pageInfo = [];

      for (const p of pages) {
        pageInfo.push({
          title: await p.title().catch(() => ""),
          url: p.url()
        });
      }

      return Response.json({
        status: "browser-running",
        message:
          "Persistent CGA HighLevel browser session is running.",
        pages: pageInfo
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
      if (this.browser && this.browser.isConnected()) {
        // Sending a browser command prevents Browser Run becoming idle.
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
