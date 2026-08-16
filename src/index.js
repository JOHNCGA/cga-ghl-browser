async findHighLevelPage(browser) {
  const pages = await browser.pages();

  // First choice: the authenticated HighLevel location page.
  for (const page of pages) {
    const url = page.url();

    if (
      url.includes("app.gohighlevel.com/v2/location/") ||
      url.includes("app.gohighlevel.com/location/")
    ) {
      return page;
    }
  }

  // Fallback: any other HighLevel tab.
  for (const page of pages) {
    if (page.url().includes("app.gohighlevel.com")) {
      return page;
    }
  }

  return null;
}
