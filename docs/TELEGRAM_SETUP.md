# Telegram bot setup

The bot lets a farmer send a photo, PDF or text (English or Spanish) and have it filed as records in
the **Needs Review** queue. Only Telegram accounts that a signed-in farm member has connected can use
it; everyone else gets a fixed "how to connect" reply and costs nothing.

Nothing here can approve a record. Owners and managers still approve in the web app.

## 1. Create the bot (2 minutes)

1. In Telegram, open **@BotFather** and send `/newbot`.
2. Choose a display name and a username ending in `bot` (for example `MyFarmRecordsBot`).
3. BotFather replies with a **token** like `123456:ABC-DEF...`. Treat it like a password.
4. Optional: send `/setcommands`, pick your bot, and paste:

   ```
   help - How to use this bot
   lang - Change language (en or es)
   stop - Disconnect this chat
   ```

## 2. Add the settings

Three values, in `.env.local` for local work and in Vercel → Settings → Environment Variables for production.

| Name | What it is | Secret? |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | the token from BotFather | **yes** (server only, never `VITE_`) |
| `TELEGRAM_WEBHOOK_SECRET` | a random string of **at least 32 characters** that Telegram sends back on every call | **yes** (server only) |
| `VITE_TELEGRAM_BOT_USERNAME` | the bot's username, e.g. `MyFarmRecordsBot` | no (public) |

`SUPABASE_SERVICE_ROLE_KEY` must also be set: the bot has no signed-in user, so it looks up linked
accounts with the server role.

Enter the token without it appearing on screen or in chat:

```bash
read -rs "k?Paste bot token (hidden): " && echo && printf '\nTELEGRAM_BOT_TOKEN=%s\n' "$k" >> .env.local && unset k
```

Generate the webhook secret (the shell makes it; you never need to see it):

```bash
printf '\nTELEGRAM_WEBHOOK_SECRET=%s\n' "$(openssl rand -hex 24)" >> .env.local
```

## 3. Apply the database changes

Run migrations `0` to `9` (see `supabase/README.md`). Migration 9 adds the linking tables.

## 4. Point Telegram at your app

Telegram must reach a public **https** URL, so this step needs a deployed app (or a tunnel for local testing).

```bash
npm run telegram:webhook -- --url https://YOUR-APP/api/agent/telegram
```

That prints what it would do. Add `--yes` to register it. Re-run it whenever you change the secret.

## 4b. Or try it on your own computer first (no public URL)

Telegram can only *push* messages to a public https address, so a bot cannot be reached on `localhost`.
It can also *pull* its messages, and that works anywhere. This mode runs the exact same bot logic
(the same handler the deployed bot uses), so what you try here is what production will do.

With the web app running (`npm run dev`), open a second terminal in the project folder:

```bash
npm run telegram:poll -- --yes
```

Leave it running and press Ctrl+C to stop. Then continue with step 5 below. Notes:

- It needs `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
- It only works while **no webhook is registered**. If one is, it refuses; `--replace-webhook` removes it
  (the live bot stops until you register the webhook again with step 4).
- Messages sent while it is not running are delivered when you start it again.
- Run **one** copy at a time.

## 5. Connect an account and try it

1. Sign in to the app → **Records** → **Connect Telegram** → **Open Telegram** → press **Start**.
2. The bot asks "Connect this chat to the farm *Your Farm* (owner: y***@example.com)?" Reply **YES** to connect, or **NO** to cancel.
   This check matters: it is how a person who is sent someone else's link notices it is not their farm. Nothing is
   connected, and nothing they send is read, until they say YES.
3. Send a photo of a receipt or type "Sprayed neem on B2 yesterday, 2 oz per gallon".
4. Records appear in **Needs Review**. If details are missing the bot asks; reply to its question. Each answer
   says exactly which fields it updated.

## Operating notes

- **Rotate the token** with BotFather (`/revoke`), update `TELEGRAM_BOT_TOKEN`, redeploy.
- **Rotate the secret**: change `TELEGRAM_WEBHOOK_SECRET`, redeploy, re-run step 4 with `--yes`.
- **Unlink**: a user can disconnect in the app (the panel shows each connected account by the name Telegram gave, and any link still waiting for confirmation), or send `/stop` to the bot. Disconnecting also forgets that chat's message links.
- **A connected chat cannot be taken over**: someone else's code is refused until the owner disconnects first.
- **Housekeeping**: the tables clear their own old rows as the bot is used; `purge_channel_data()` does it all at once if you ever want to.
- **Not supported yet**: voice notes, video, groups. The bot only talks in private chats.
- **Cost**: each photo or message is one model call. The per-user limits and the global daily cap
  (`AGENT_RATE_LIMIT_*`) apply, and are shared with the web app.
