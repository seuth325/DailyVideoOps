# DailyVideoOps Web App

## Features
- User signup/login
- Per-user posts
- Multi-platform targeting (Facebook, Instagram, WhatsApp, YouTube, TikTok)
- Scheduled queue with simulated posting logs
- PostgreSQL persistence via Prisma

## Setup
1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to your PostgreSQL connection string.
3. Generate Prisma client and run migrations.

```powershell
cd app
npm.cmd install
npm.cmd run prisma:generate
npm.cmd run prisma:migrate -- --name init
```

## Run
```powershell
npm.cmd start
```

Open `http://localhost:3000`.

## Important
This MVP still simulates posting. Real social posting requires OAuth + official APIs per platform.
