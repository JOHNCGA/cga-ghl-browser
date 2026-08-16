13:43:03.756
Initializing build environment...
13:43:05.776
Success: Finished initializing build environment
13:43:06.191
Cloning repository...
13:43:08.826
Detected the following tools from environment: bun@1.2.15, nodejs@24.18.0
13:43:08.828
Installing project dependencies: bun install
13:43:09.047
bun install v1.2.15 (df017990)
13:43:09.057
Resolving dependencies
13:43:10.975
Resolved, downloaded and extracted [572]
13:43:11.892
Saved lockfile
13:43:11.892
13:43:11.892
+ wrangler@4.123.0
13:43:11.893
+ @cloudflare/puppeteer@1.3.0
13:43:11.893
13:43:11.893
116 packages installed [2.89s]
13:43:12.005
Executing user deploy command: npx wrangler deploy
13:43:13.921
13:43:13.921
 ⛅️ wrangler 4.123.0
13:43:13.921
────────────────────
13:43:13.979
13:43:13.979
Cloudflare collects anonymous telemetry about your usage of Wrangler. Learn more at https://github.com/cloudflare/workers-sdk/tree/main/packages/wrangler/telemetry.md
13:43:13.980
13:43:14.033
✘ [ERROR] Build failed with 1 error:
13:43:14.033
13:43:14.033
  ✘ [ERROR] Expected "=>" but found "("
13:43:14.034
  
13:43:14.034
      src/index.js:901:24:
13:43:14.034
        901 │   async getHighLevelPage(browser) {
13:43:14.034
            │                         ^
13:43:14.034
            ╵                         =>
13:43:14.034
  
13:43:14.034
  
13:43:14.034
13:43:14.034
13:43:14.073
🪵  Logs were written to "/opt/buildhome/.config/.wrangler/logs/wrangler-2026-08-16_12-43-13_393.log"
13:43:14.165
Failed: error occurred while running deploy command
