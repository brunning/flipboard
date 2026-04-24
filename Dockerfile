# Use the official Playwright image — it ships with Chromium and every
# system library Chromium needs, so Railway doesn't have to figure that
# out on its own. Keep this version in sync with slack-bot/package.json.
FROM mcr.microsoft.com/playwright:v1.50.0-jammy

WORKDIR /app

# Install bot dependencies first so this layer is cached when only
# application code changes.
COPY slack-bot/package*.json ./slack-bot/
RUN cd slack-bot && npm install --omit=dev

# Copy the rest of the repo: the static web app at the root and the bot
# source under slack-bot/. server.js serves the parent directory as the
# static root so Playwright can load index.html from http://127.0.0.1.
COPY . .

WORKDIR /app/slack-bot

# No EXPOSE — the bot uses Slack's Socket Mode, so it doesn't accept any
# inbound HTTP traffic. The internal Express server only binds to
# 127.0.0.1 inside the container.

CMD ["npm", "start"]
