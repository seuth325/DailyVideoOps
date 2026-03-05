# Daily Cross-Platform Video Ops

This kit implements your daily workflow for:
- Facebook Reels
- Instagram Reels
- WhatsApp (Status + Broadcast)
- YouTube Shorts
- TikTok

Time model: 60-90 minutes per day  
Primary KPI: audience growth (reach, watch time/retention, followers)

## Folder Structure

- `config/schedule.json`: fixed ET posting windows and defaults
- `data/topic-bank.csv`: rolling 7-day topic bank
- `data/analytics-log.csv`: daily platform performance log
- `templates/content-brief-template.md`: master brief format
- `templates/caption-templates.md`: base + platform CTA variants
- `templates/daily-publish-checklist.md`: quality and publish verification
- `templates/weekly-review-template.md`: 30-minute weekly optimization review
- `scripts/new-daily-package.ps1`: generate the day package from topic bank + templates
- `scripts/log-analytics.ps1`: append analytics rows safely
- `output/`: generated daily assets and checklists

## Daily Execution (Hybrid Approval)

1. Generate your day package:
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\new-daily-package.ps1
   ```
2. Open generated files in `output/YYYY-MM-DD/`.
3. Fill script lines and caption drafts.
4. Record + edit master 9:16 video (30-60s).
5. Approve via checklist (`APPROVED_BY_CREATOR: yes`) before publishing.
6. Schedule/publish:
   - TikTok 12:30 PM ET
   - Instagram 1:00 PM ET
   - Facebook 1:30 PM ET
   - YouTube Shorts 2:00 PM ET
   - WhatsApp Status + Broadcast 6:00 PM ET
7. Log post metrics at end of day with `log-analytics.ps1`.

## Commands

Generate package for today:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new-daily-package.ps1
```

Generate package for a specific date:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\new-daily-package.ps1 -Date 2026-03-05
```

Append analytics:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\log-analytics.ps1 `
  -Date 2026-03-05 -Platform tiktok -Views 1240 -RetentionProxy 42 `
  -Likes 95 -Comments 13 -Shares 21 -Follows 17
```

## Weekly Loop (30 minutes)

Use `templates/weekly-review-template.md` every week:
- Find top hooks and retention drop points
- Keep 2 winning patterns
- Replace 1 weak pattern
- Refresh next week topic bank in `data/topic-bank.csv`

## Weekly Insights Command

Generate weekly performance summary and recommendations:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\weekly-summary.ps1
```

Generate summary for a specific week start date:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\weekly-summary.ps1 -WeekStartDate 2026-03-09
```

Output report path:
- `output/reports/weekly-summary-YYYY-MM-DD.md`
