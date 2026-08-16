import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request, env) {
    try {
      const browser = await puppeteer.launch(env.BROWSER, {
        keep_alive: 600000
      });

      const page = await browser.newPage();

      await page.goto("https://app.gohighlevel.com", {
        waitUntil: "domcontentloaded",
        timeout: 30000
      });

      return Response.json({
        status: "session-created",
        url: page.url(),
        title: await page.title(),
        message: "Browser session is running. Open Cloudflare Browser Run Live View to complete login."
      });

    } catch (error) {
      return Response.json(
        {
          status: "error",
          message: error instanceof Error ? error.message : String(error)
        },
        { status: 500 }
      );
    }
  }
};
