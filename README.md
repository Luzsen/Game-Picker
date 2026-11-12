# Game Picker

**Live demo:** https://random-game-picker.netlify.app/

Random game picker with cyberpunk glassmorphism design, powered by the IGDB API.

## Features

- **Random game draw** — pick a random game from IGDB's database
- **Filters** — platform, genre, game mode, release year, and official trailer checkbox
- **IGDB Score** — critics' score from IGDB (0-10 scale) shown on the game card
- **Official trailers** — direct YouTube links from IGDB video data
- **Platform badges** — colored icons for PC, PlayStation, Xbox, Nintendo, etc.
- **Keyboard shortcuts** — press **Space** or **R** to draw a new game

## Requirements

- Node.js 20.12+ (for `process.loadEnvFile`) or set environment variables manually
- [IGDB API credentials](https://api-docs.igdb.com) (Client ID, Client Secret, Access Token) from the [Twitch Developer Portal](https://dev.twitch.tv/)

## Self-Hosting

Run the server:

```bash
node server.js
```

Open your browser at `http://localhost:3000`

## Security Notes

Credentials live only on the server (`.env.api`) — the browser never sees them. No third-party scraping is used — only the official IGDB API.

## License

MIT
