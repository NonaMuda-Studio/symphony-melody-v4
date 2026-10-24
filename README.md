# Symphony Melody V4

Discord music bot starter using Node.js, CommonJS, discord.js v14, and JSON storage.

## Features included in this starter
- Slash commands for music playback controls.
- Personal and server playlists with persistent JSON storage.
- Playlist create, rename, list, add, remove, and play commands.
- `/lyrics` opens a lyrics search page instead of copying full copyrighted lyrics into Discord.
- `/botprofile name`, `/botprofile avatar`, and `/botprofile reset` use Discord's guild-specific current-member profile API; changes apply only to the server where the command is used.
- Clear errors when the audio source cannot be extracted.

## Requirements
- Node.js 22.12+ (your Node 26 should satisfy this)
- FFmpeg installed and accessible as `ffmpeg`
- yt-dlp installed and accessible as `yt-dlp`
- Deno is recommended for yt-dlp's JavaScript challenges
- A Discord application and bot token

## Setup in Termux
1. Extract this folder and enter it:
   ```bash
   cd symphony-melody-v4
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create `.env`:
   ```bash
   cp .env.example .env
   nano .env
   ```
   Fill `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`. Never share `.env`.
4. Register slash commands:
   ```bash
   npm run deploy
   ```
   If `DISCORD_GUILD_ID` is set, commands are registered to that test server. If blank, they are registered globally.
5. Start the bot:
   ```bash
   npm start
   ```
6. Check syntax when needed:
   ```bash
   npm run check
   ```

## Important audio note
YouTube may return HTTP 429, LOGIN_REQUIRED, missing PO Token/Visitor Data, or anti-bot verification. This is a YouTube access limitation and not proof that the bot code is broken. The bot does not bypass login checks or rate limits. Test with a source you are authorized to stream. The bot may fail to play a YouTube item until YouTube permits extraction.

## Commands
- `/help`
- `/play query`
- `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/nowplaying`, `/volume`, `/leave`
- `/playlist create`, `/playlist rename`, `/playlist list`, `/playlist add`, `/playlist remove`, and `/playlist play` accept a `scope`: `personal` (default) or `server`. Personal playlists belong to the creator in that server; server playlists are shared by members in that server.
- `/lyrics song [artist]`
- `/botprofile name`, `/botprofile avatar`, `/botprofile reset`

## Permissions and limitations
- The bot needs View Channels, Send Messages, Connect, and Speak permissions.
- Only the server owner or a member with Manage Server can change the bot's server profile through `/botprofile`. These operations use the server-specific member profile API and do not change the global bot identity.
- Server-specific avatar editing is controlled by Discord support and may not be available for every bot/account/server. If Discord rejects it, the command reports the error and does not change the global avatar.
- Server playlists can be edited by any member who can use the playlist command. Playlist JSON is intended for a single bot process. For multiple bot instances or a public production bot, use a proper database and backups.
- Lyrics command opens a search page; it does not scrape or post full copyrighted lyrics.
