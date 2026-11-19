# Ashan Gaming Official Bot — Modular Discord Bot

A production-quality, highly modular Discord bot built with **Node.js**, **discord.js v14**, and **MongoDB**. Features a complete Discord Components V2 ticket system, comprehensive invite tracking, server logging, automod, moderation, welcome cards, and utilities.

> **New here?** Start with [`setup.md`](setup.md) to get the bot online.

---

## Requirements

- **Node.js** v18 or higher (`node -v` to check)
- **MongoDB** v6 or higher (local MongoDB or free MongoDB Atlas cluster)
- A Discord Application & Bot Token from the [Discord Developer Portal](https://discord.com/developers/applications)
- Privileged Gateway Intents enabled:
  - ✅ **Server Members Intent**
  - ✅ **Message Content Intent**

---

## Quick Start

```bash
npm install
cp .env.example .env   # then fill in DISCORD_TOKEN, CLIENT_ID, GUILD_ID, MONGODB_URI
npm start              # or: npm run dev (auto-restart via nodemon)
```

See [`setup.md`](setup.md) for step-by-step setup and configuration.

---

## Features & Modules

| Module | What it does | Key commands |
|---|---|---|
| 🎫 **Tickets** | Components V2 support ticket panel, department select, reason modal, staff claim/reclaim, transcripts, close/delete archive flows | `/ticket panel`, `/close`, `/delete` |
| 🎵 **Music (Lavalink)** | High-quality audio playback via Lavalink (YouTube, SoundCloud, Spotify URLs), interactive queues, progress bars, volume, loop, shuffle | `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/nowplaying`, `/queue`, `/volume`, `/loop`, `/shuffle` |
| 📨 **Invite Tracking** | Automatic invite detection on join, join/leave/rejoin counters, alt-account flagging (young accounts or cloned avatars), plain-text announcements in a chosen channel, bonus invites, leaderboards | `/invites user`, `/invites leaderboard`, `/invites give`, `/invites remove`, `/invites reset`, `/invites sync`, `/invites channel` |
| 🛡️ **Moderation** | Persistent warnings, kick, ban, unban, timeout, channel lock/unlock, slowmode, message purge | `/warn`, `/unwarn`, `/warnings`, `/kick`, `/ban`, `/unban`, `/timeout`, `/clear`, `/lock`, `/unlock`, `/slowmode` |
| 📜 **Server Logs** | Centralized audit & event logging (member joins/leaves/invites, messages, voice, roles, channels, server changes) | `/logs` |
| 👋 **Welcome** | Two per-server layouts: sectioned copy (bold header, greeting, copy, animated GIF banner, server-logo thumbnail) or a generated avatar card image over the Ashan Gaming red hexagon artwork — bold text on a tinted plate — plus `{placeholder}` support | `/welcome`, `/testwelcome` |
| 🤖 **AutoMod** | Multi-rule automated moderation (anti-link, anti-invite, spam, duplicate messages, mention spam, caps, word filter, anti-raid) | `/automod status`, `/automod rule` |
| 🔗 **Anti-Link** | URL blocking with role/channel exemptions, customizable warnings, and cooldowns | `/antilink` |
| 🎭 **AutoRole** | Automatically assign roles to joining members with delay options | `/autorole` |
| 🧱 **Embed Builder** | Interactive Discord Components V2 embed & container builder | `/embed`, `/embedconfig` |
| 📢 **Management** | Announcements, server polls, suggestions, bot say commands | `/announce`, `/poll`, `/suggest`, `/say` |
| 👤 **Personal** | AFK statuses, personal reminders with timed notifications | `/afk`, `/remind`, `/reminders` |
| 🎉 **Fun** | Magic 8ball, coin flip, dice roll, random choice picker | `/8ball`, `/choose`, `/coinflip`, `/dice` |
| 🛠️ **Utility** | Server info, user info, avatar, banner, channel info, ping, uptime, botinfo | `/userinfo`, `/serverinfo`, `/avatar`, `/banner`, `/ping`, `/uptime` |
| ⚙️ **Setup** | In-Discord configuration and help menu | `/setup`, `/help` |

---

## Configuration

### 1. Environment Variables (`.env`)
```env
DISCORD_TOKEN=your_bot_token_here
CLIENT_ID=your_client_id_here
GUILD_ID=your_server_id_here
MONGODB_URI=mongodb://localhost:27017/ashan_gaming_bot
```

### 2. Bot Configuration (`src/config/config.yml`)
Configure channels, roles, and categories:
- **`tickets:`**
  - `panel.channelId`: channel where the support panel lives.
  - `panel.autoPost`: post (or refresh in place) that panel on every startup — `true` by default, so the panel survives restarts and is never duplicated.
  - `logs.channelId`: channel where closed ticket transcripts and audit logs go.
  - `support_role_id`: global support role ID pinged when a ticket opens.
  - `categories:`: configure departments (e.g. `general`, `report`, `purchase`), each with its own Discord category ID and staff roles.
- **`invites:`**
  - `logChannelId`: channel for the plain-text join/leave/rejoin/alt messages (optional; `/invites channel` sets a per-server channel that wins over this).
  - `minAccountAgeDays`: legacy base threshold, used when `altDetection.minAccountAgeDays` is unset.
  - `trackLeaves`: whether member departures count against the inviter (a rejoin gives the point back).
  - `altDetection.minAccountAgeDays` / `avatarCloneCheck`: flag possible alt accounts (counted in the separate `fake` bucket).
  - `joinMessage` / `rejoinMessage` / `altJoinMessage` / `leaveMessage` / `vanityJoinMessage` / `unknownJoinMessage`: announcement templates (`{member}`, `{code}`, `{inviter}`, `{inviterTotal}`, `{rejoins}`, `{left}`, `{alts}`, `{altReason}`, …).
- **`logs:`**
  - Configure individual logging channels for `member`, `message`, `voice`, `channel`, `role`, `moderation`, `server`, and `invite`.
- **`welcome:`**
  - `channelId`: channel for welcome messages.
  - `layout`: `"classic"` (bold header + copy + `image` banner + server-logo thumbnail) or `"card"` (one generated image with the member avatar over `card.background`).
  - `thumbnail.useServerIcon`: use the server's own logo as the header thumbnail (an explicit `url`/`path` wins).
  - `image.url` / `image.path`: the banner media (GIFs keep animating); a local `path` is uploaded so it never expires.
  - `greeting`: the "👋 Welcome, {displayname}!" line above the message (server icon rides along when `card.icon` is on).
  - `card`: the heading / title / subtitle lines drawn on the artwork, plus the `{mention}` ping line and the rounded text plate (`scrimColor`, `scrimOpacity`, `scrimBorder`).
  - `invitedBy`: the invite-credit line under the card; `{inviter}` is the member who invited them (falls back to "someone").
  - `footer`: the closing line ("Enjoy your stay in Ashan Gaming Official.") — Discord text, never baked into the image.
  - `accentColor`: accent bar, avatar ring, plate hairline colour.

---

## Architecture

```
index.js ──► Connects MongoDB ──► ModuleManager loads core + enabled modules
         ──► discord.js Client ──► clientReady registers guild slash commands ──► Bot Online
```

- **`src/core/`**: Lifecycle, command deployment, interaction routing, logger, configuration loader.
- **`src/modules/`**: Completely modular feature directories containing commands, events, components, and services.
- **`src/database/`**: Mongoose schemas and repository abstraction layer with in-memory fallbacks when MongoDB is unavailable.
- **`src/utils/`**: Discord Components V2 helpers, text styling, and retry utilities.
