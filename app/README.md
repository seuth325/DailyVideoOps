# DailyVideoOps Web App

## Features
- User signup/login
- Per-user posts
- Multi-platform targeting (Facebook, Instagram, WhatsApp, YouTube, TikTok)
- Scheduled queue with real publishing attempts
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

## Real Publishing
Configure each platform in Dashboard with either:
- Direct API settings (Access Token + External Account ID)
- OR Webhook URL (for automation providers such as n8n/Make/Zapier)

Built-in direct connectors:
- Facebook Page post/video (Graph API)
- Instagram Reel publish (Graph API)
- WhatsApp Cloud API text send

Webhook-driven connectors (recommended for YouTube/TikTok in this MVP):
- YouTube
- TikTok

Notes:
- Instagram requires `mediaUrl` in post.
- WhatsApp requires `configJson` like `{ "to": "15551234567" }`.
- `status=failed` indicates one or more platforms rejected publishing.

## AI Recommendation Flow
1. In `Create Post`, fill Topic (+ optional audience, goal, tone, platform).
2. Click `Recommend Title + Caption`.
3. Generated text auto-fills Title and Caption fields.
4. Without `OPENAI_API_KEY`, app uses local fallback generation.

## Important
This app now performs real outbound publish calls when platform connections are configured.
