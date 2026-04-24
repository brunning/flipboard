# Flipboard Slack Bot

A Slack slash command that renders a message on the split-flap sign and
posts the resulting animated GIF to the channel.

```
/flipboard hello world
```

The bot reuses the existing browser-based renderer by driving it with a
headless Chromium tab — so the GIF Slack sees is identical to what you
get from the **Export GIF** button in the web app.

## What you'll need

- **Node.js 18 or newer** on whatever machine will run the bot (your
  laptop is fine to start).
- **A Slack workspace** where you're allowed to install custom apps.
  Most workspaces let you do this; if yours doesn't, ask your admin.

You do **not** need a public URL, ngrok, hosting, or domain. The bot
uses Slack's "Socket Mode" which connects out over a WebSocket.

## One-time setup

### 1. Install dependencies

From inside this `slack-bot/` folder:

```bash
npm install
npm run install-browser
```

The second command downloads the Chromium build that Playwright drives
(~150 MB, one-time).

### 2. Create the Slack app

1. Go to <https://api.slack.com/apps> → **Create New App** → **From an
   app manifest**.
2. Pick the workspace where the bot should live.
3. Open `manifest.json` from this folder, copy the entire contents, and
   paste it into the manifest box. Click **Next**, then **Create**.

This creates an app called **Flipboard** with the `/flipboard` slash
command and exactly the permissions it needs (`commands`, `chat:write`,
`files:write`).

### 3. Generate the two tokens

You need two tokens. Both are created from the app's settings page that
opened after step 2.

**a) App-Level Token (`xapp-…`)** — for the WebSocket connection

- Sidebar → **Basic Information**
- Scroll to **App-Level Tokens** → **Generate Token and Scopes**
- Name: `socket` (anything works)
- Add scope: `connections:write`
- Click **Generate** and copy the `xapp-…` token.

**b) Bot User OAuth Token (`xoxb-…`)** — for posting messages

- Sidebar → **Install App** → **Install to Workspace** → **Allow**.
- After install, copy the **Bot User OAuth Token** (starts with `xoxb-`)
  shown on that page.

### 4. Save your tokens

In this folder:

```bash
cp .env.example .env
```

Open `.env` and paste the two tokens you just copied:

```
SLACK_BOT_TOKEN=xoxb-…
SLACK_APP_TOKEN=xapp-…
```

### 5. Run the bot

```bash
npm start
```

You should see:

```
Static server running at http://127.0.0.1:3000
⚡ Flipboard bot connected to Slack (Socket Mode).
```

That's it. As long as that process is running, the slash command works
in any channel where the bot has been added.

## Try it

In any Slack channel:

```
/invite @Flipboard
/flipboard hello world
```

You'll briefly see "Rendering …" (only you see this), then the GIF will
appear in the channel for everyone.

## Limits enforced by the bot

- **Length**: derived from the configured sign size — `rows × cols +
  (rows − 1)`. At the default 2×16 board this is **33 characters**.
- **Characters**: `A–Z`, `0–9`, space, and `.,!?-:/&'`.

The bot uppercases input automatically and rejects anything else with a
private (ephemeral) error message that only the requester sees.

## Customizing the sign size

The sign dimensions live in `config.json` at the **repo root** (one level
above this folder). The web app and the bot both read it, so they always
agree on layout.

```json
{
  "rows": 2,
  "cols": 16
}
```

To change them: edit `config.json`, commit, and push. Railway will
redeploy automatically and the bot's input-length validation will follow
the new dimensions on the next start. The exported GIF will resize to
match (e.g. a 4×24 board produces a much larger GIF; a 2×8 board a
smaller one).

## Deploy to Railway

The repo includes a `Dockerfile` (at the parent of this folder) that
uses Microsoft's official Playwright image, so Railway has zero work to
do figuring out system dependencies.

### Steps

1. Push the whole `sign` repo to GitHub (private repo is fine).
2. Go to <https://railway.app> → **New Project** → **Deploy from
   GitHub repo** → pick the repo.
3. Railway detects the `Dockerfile` at the repo root and starts
   building. The first build takes ~3–5 minutes (downloading the
   Playwright base image); subsequent builds are much faster.
4. Open the service's **Variables** tab and add:

   ```
   SLACK_BOT_TOKEN=xoxb-…
   SLACK_APP_TOKEN=xapp-…
   ```

   Use the same two tokens you put in `.env` for local testing.
5. Click **Deploy**. Watch the **Deploy Logs**; success looks like:

   ```
   Static server running at http://127.0.0.1:3000
   ⚡ Flipboard bot connected to Slack (Socket Mode).
   ```
6. (Optional) In **Settings → Networking**, you can leave "Public
   Networking" disabled — the bot uses Slack's outbound Socket Mode
   connection, so there's nothing to expose.

### Cost

Railway's free trial gives ~$5 of usage to start. After that, a small
always-on bot is roughly $5/month on the Hobby plan. The bot is mostly
idle (Chromium only spins up when someone runs `/flipboard`), so usage
stays low.

### Updates

`git push` to the connected branch and Railway redeploys automatically.

## Other hosts

The same Dockerfile works on Fly.io, Render, or any container host. For
a Raspberry Pi or VPS, you can skip Docker entirely and just clone the
repo and run `npm install && npm run install-browser && npm start`
inside `slack-bot/`.

**Not recommended**: AWS Lambda, Vercel, Cloudflare Workers — Chromium
doesn't fit cleanly in serverless function size limits, and Slack
Socket Mode needs a long-lived process which serverless can't provide.

## Files

- `server.js` — Bolt app + tiny Express server that serves the web app
  to the headless browser.
- `render-gif.js` — Playwright wrapper that drives the web app and
  returns the encoded GIF as a `Buffer`.
- `manifest.json` — paste this into Slack to create the app.
- `.env.example` — template; copy to `.env` and fill in tokens.
- `package.json` — dependencies and scripts.
