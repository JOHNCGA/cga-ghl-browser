import puppeteer from "@cloudflare/puppeteer";

const PREFERRED_SESSION_ID = "8be56cfd-c890-4cab-b933-16c4a28e3fb1";

export default {
  async fetch(request, env) {
    let browser;

    try {
      const sessions = await puppeteer.sessions(env.BROWSER);

      // Prefer the session you logged into manually.
      // If it has expired, try another available Browser Run session.
      let session = sessions.find(
        (s) =>
          s.sessionId === PREFERRED_SESSION_ID &&
          !s.connectionId
      );

      if (!session) {
        session = sessions.find((s) => !s.connectionId);
      }

      if (!session) {
        return Response.json(
          {
            status: "no-session",
            message:
              "No available Browser Run session was found. Create/login to a new Live Session first."
          },
          { status: 404 }
        );
      }

      browser = await puppeteer.connect(
        env.BROWSER,
        session.sessionId
      );

      const pages = await browser.pages();

      const pageInfo = [];

      for (const page of pages) {
        pageInfo.push({
          title: await page.title().catch(() => ""),
          url: page.url()
        });
      }

      const ghlPage =
        pages.find((page) =>
          page.url().includes("app.gohighlevel.com")
        ) || pages[0];

      if (!ghlPage) {
        browser.disconnect();

        return Response.json({
          status: "connected",
          sessionId: session.sessionId,
          authenticated: false,
          pages: pageInfo,
          message: "Connected, but no HighLevel tab was found."
        });
      }

      const currentUrl = ghlPage.url();
      const title = await ghlPage.title();

      // This is only a diagnostic check.
      // We are NOT editing anything yet.
      const likelyLoginPage =
        currentUrl.toLowerCase().includes("login") ||
        currentUrl.toLowerCase().includes("signin");

      browser.disconnect();

      return Response.json({
        status: "connected",
        sessionId: session.sessionId,
        authenticated: !likelyLoginPage,
        highLevel: {
          title,
          url: currentUrl
        },
        pages: pageInfo
      });

    } catch (error) {
      if (browser) {
        try {
          browser.disconnect();
        } catch {}
      }

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
};
