# OBS Chat Widget

A chat widget for OBS that aggregates messages from Twitch, YouTube, and Telegram into a single unified interface.

## Features

- **Multi-platform support**: Twitch, YouTube, and Telegram
- **Extensible architecture**: Easy to add new platforms
- **Real-time updates**: WebSocket-based communication
- **Type-safe**: Full TypeScript support
- **Modern UI**: Minimal styling with CSS variables and nesting

## Project Structure

```
.
├── server/           # Node.js + TypeScript server
│   ├── src/
│   │   ├── services/ # Platform-specific services
│   │   └── index.ts  # WebSocket server
│   └── package.json
├── client/           # Vue.js + TypeScript client
│   ├── src/
│   │   ├── components/
│   │   └── composables/
│   └── package.json
├── shared/           # Shared code between client and server
│   └── types/        # Shared type definitions
└── package.json
```

## Installation

1. Install all dependencies:
```bash
npm run install:all
```

2. Or install separately:
```bash
# Server
cd server
npm install

# Client
cd ../client
npm install
```

## Configuration

### Server

Edit `server/src/index.ts` to add your chat sources:

```typescript
// Twitch
coordinator.addSource('twitch-1', 'twitch', {
  channel: 'your_channel',
  username: 'your_bot_username', // Optional
  token: 'oauth:your_token',      // Optional
});

// YouTube
coordinator.addSource('youtube-1', 'youtube', {
  channelId: 'your_channel_id',
  apiKey: 'your_api_key',
});

// Telegram
coordinator.addSource('telegram-1', 'telegram', {
  chatId: 'your_chat_id',
  botToken: 'your_bot_token',
});
```

### Client

Set the WebSocket URL in `client/src/App.vue` or via environment variable:

```bash
VITE_WS_URL=ws://localhost:8080 npm run dev
```

## Running

### Development

```bash
# Terminal 1: Server
npm run dev:server

# Terminal 2: Client
npm run dev:client
```

### Console-Only Mode

You can run the server in console-only mode to output chat messages directly to the terminal instead of using WebSocket:

```bash
# Set environment variable
CONSOLE_ONLY=true npm run dev:server

# Or modify shared/config.ts
consoleOnly: true
```

In console-only mode:
- No WebSocket server is started
- All chat messages are printed to the console with colored formatting
- Platform badges are color-coded (Twitch: magenta, YouTube: red, Telegram: cyan)
- User colors from Twitch are preserved
- Badges and timestamps are displayed

### Production

```bash
# Build both
npm run build:server
npm run build:client

# Run server
cd server
npm start
```

## Usage in OBS

1. Start both server and client
2. In OBS, add a Browser Source
3. Set the URL to `http://localhost:3000` (or your client URL)
4. Set width and height as needed
5. The chat widget will display messages from all configured sources

## WebSocket API

The server WebSocket server accepts the following message types:

- `add_source`: Add a new chat source
- `remove_source`: Remove a chat source
- `start_source`: Start watching a source
- `stop_source`: Stop watching a source
- `start_all`: Start all sources
- `stop_all`: Stop all sources
- `get_sources`: Get list of all sources

Example:
```json
{
  "type": "add_source",
  "data": {
    "id": "twitch-1",
    "platform": "twitch",
    "config": {
      "channel": "channel_name"
    }
  }
}
```

## Platform Requirements

### Twitch
- Channel name (required)
- OAuth token (optional, for authenticated access)

### YouTube
- Channel ID (required)
- API Key (required, get from [Google Cloud Console](https://console.cloud.google.com/))

### Telegram
- Chat ID (required)
- Bot Token (required, create a bot via [@BotFather](https://t.me/botfather))

## Notes

### Deprecation Warnings

During installation, you may see deprecation warnings for `har-validator`, `uuid`, and `request`. These are transitive dependencies from `node-telegram-bot-api` and are harmless. The package maintainers are aware of these and they don't affect functionality.

### Security Vulnerabilities

`npm audit` may report vulnerabilities from `node-telegram-bot-api`'s transitive dependencies. Critical vulnerabilities in `form-data` and `tough-cookie` are addressed via npm overrides in `package.json` to force secure versions.

Remaining moderate vulnerabilities are in the deprecated `request` package, which `node-telegram-bot-api` depends on internally. These cannot be fixed without downgrading the package (a breaking change). The risk is limited as:
- The vulnerabilities are moderate severity (not critical)
- The `request` package is only used internally by the Telegram bot library
- We're using the latest version of `node-telegram-bot-api` (0.66.0)

The package maintainers are aware of these issues and will address them in future updates.

## License

MIT

