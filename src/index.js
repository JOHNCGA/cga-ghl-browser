import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    let browser;

    try {
      browser = await puppeteer.launch(env.BROWSER);

      const page = await browser.newPage();

      await page.goto("https://app.gohighlevel.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });

      const result = {
        status: "success",
        title: await page.title(),
        url: page.url(),
        hasEmailSecret: Boolean(env.GHL_EMAIL),
        hasPasswordSecret: Boolean(env.GHL_PASSWORD)
      };

      return Response.json(result);

    } catch (error) {
      return Response.json(
        {
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      );

    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch {}
      }
    }
  }
};
