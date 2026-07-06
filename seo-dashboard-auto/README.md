# TNTS Organic Performance Board

Live SEO dashboard for thenamethatsticks.com, fed by the Semrush API.

## Files
- `index.html` - the dashboard (static, no build step)
- `data.js` - the data the dashboard reads; regenerated automatically
- `scripts/refresh.mjs` - pulls fresh data from Semrush and rewrites data.js
- `.github/workflows/refresh-seo-data.yml` - runs the script every Monday 05:30 UTC

## One-time setup
1. Create a GitHub repo and upload everything in this folder (keep the folder structure).
2. In Vercel: Add New Project > Import the repo. No framework, no build command, output directory `.`
3. In the GitHub repo: Settings > Secrets and variables > Actions > New repository secret
   Name: SEMRUSH_API_KEY, value: your Semrush API key (Semrush > Profile > API)
4. Test it: repo > Actions tab > Refresh SEO data > Run workflow.
   It commits a fresh data.js, Vercel redeploys automatically within a minute.

## Notes
- Schedule is weekly. For daily, edit the cron line in the workflow file.
- Each run uses roughly 2,300 Semrush API units (mostly the backlink reports).
- Recovery tasks are rule-generated from keyword movements each run. Ticked tasks
  are remembered per browser via localStorage, keyed by keyword, so a task that
  persists across refreshes stays ticked.
