# DailyVideoOps Web App

## Features
- User signup/login
- Per-user posts
- Multi-platform targeting (Facebook, Instagram, WhatsApp, YouTube, TikTok)
- Scheduled queue with simulated posting logs
- PostgreSQL persistence via Prisma
- Dashboard platform authentication (connect/disconnect per platform)
- AI recommendation for Title + Caption on Create Post form

## Setup
1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to your PostgreSQL connection string.
3. Optional: set `OPENAI_API_KEY` to enable OpenAI-generated recommendations.
4. Generate Prisma client and run migrations.

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

## Platform Authentication Flow
1. Log in and open Dashboard.
2. In `Platform Authentication`, add token details per platform and click `Save Connection`.
3. Create posts selecting connected platforms.
4. Posts fail with status `failed` if required platform authentication is missing.

## AI Recommendation Flow
1. In `Create Post`, fill Topic (+ optional audience, goal, tone, platform).
2. Click `Recommend Title + Caption`.
3. Generated text auto-fills Title and Caption fields.
4. Without `OPENAI_API_KEY`, app uses local fallback generation.

## Important
This MVP still simulates posting. Real social posting requires OAuth + official APIs per platform.
