# Smart Scanner Scheduler

The scheduler uses `America/New_York` time and the existing one-minute Cloudflare cron trigger.

- Pre-Market: 04:00-09:30 ET, every 60 seconds.
- Market Open: 09:30-11:30 ET, every 20 seconds.
- Lunch: 11:30-15:00 ET, every 60 seconds.
- Power Hour: 15:00-16:00 ET, every 20 seconds.
- After-Hours: 16:00-20:00 ET, every 120 seconds.
- Closed: no scanner ticks.

The production entrypoint disables the legacy scanner only for delegated scheduled work, waits for all other scheduled tasks, and then runs the Smart Scheduler with the original environment. Sandbox and Live execution gates are not modified.
