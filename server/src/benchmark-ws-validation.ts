import { validateWSMessage } from './validation.js';
import { kWSMessageType, type WSMessage, type ChatMessage, type ChatSettings, type Platform, type PlatformWithStatus } from '@shared/shared-types.js';

const kTestMessageCount = 1000000;
const kWarmupMessageCount = 1000;

/**
 * Generate a random string of specified length
 */
function randomString(length: number, chars: string = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a random hex color
 */
function randomHexColor(): string {
  return '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0').toUpperCase();
}

/**
 * Generate a random platform
 */
function randomPlatform(): Platform {
  const platforms: Platform['id'][] = ['twitch', 'youtube', 'telegram', 'vkvideo', 'kick'];
  const names = ['Twitch', 'YouTube', 'Telegram', 'VK Video', 'Kick'];
  const abbrs = ['TW', 'YT', 'TG', 'VK', 'KI'];
  const colors = ['#FF00FF', '#FF0000', '#00FFFF', '#0077FF', '#53FC18'];

  const index = Math.floor(Math.random() * platforms.length);
  return {
    id: platforms[index],
    name: names[index],
    color: colors[index],
    abbr: abbrs[index]
  };
}

/**
 * Generate a random chat message
 */
function randomChatMessage(): ChatMessage {
  const platform = randomPlatform();
  const messageLength = Math.floor(Math.random() * 500) + 1;
  const usernameLength = Math.floor(Math.random() * 20) + 1;
  const channelLength = Math.floor(Math.random() * 30) + 1;

  const message: ChatMessage = {
    id: `msg-${randomString(16)}`,
    channel: randomString(channelLength),
    username: randomString(usernameLength),
    message: randomString(messageLength),
    timestamp: Date.now() - Math.floor(Math.random() * 86400000), // Random time in last 24 hours
    platform,
    color: Math.random() > 0.5 ? randomHexColor() : undefined,
    isSubscriber: Math.random() > 0.7 ? true : undefined,
    isModerator: Math.random() > 0.8 ? true : undefined,
    isVip: Math.random() > 0.9 ? true : undefined,
    isEdited: Math.random() > 0.9 ? true : undefined,
  };

  // Random badges
  if (Math.random() > 0.5) {
    const badgeCount = Math.floor(Math.random() * 5) + 1;
    message.badges = Array.from({ length: badgeCount }, () => randomString(10));
  }

  // Random badge images
  if (Math.random() > 0.6) {
    const badgeCount = Math.floor(Math.random() * 3) + 1;
    message.badgeImages = {};
    for (let i = 0; i < badgeCount; i++) {
      message.badgeImages[randomString(10)] = `https://example.com/badge/${randomString(8)}.png`;
    }
  }

  // Random avatar
  if (Math.random() > 0.3) {
    message.avatar = `https://example.com/avatar/${randomString(16)}.jpg`;
  }

  // Random emotes
  if (Math.random() > 0.5) {
    const emoteCount = Math.floor(Math.random() * 5) + 1;
    message.emotesMap = {};
    for (let i = 0; i < emoteCount; i++) {
      message.emotesMap[randomString(10)] = `https://example.com/emote/${randomString(8)}.png`;
    }
  }

  // Random edit date if edited
  if (message.isEdited && Math.random() > 0.5) {
    message.editDate = message.timestamp + Math.floor(Math.random() * 3600000);
  }

  return message;
}

/**
 * Generate a random chat settings object
 */
function randomChatSettings(): ChatSettings {
  return {
    showAvatars: Math.random() > 0.5,
    showBadges: Math.random() > 0.5,
    showModeratorBadges: Math.random() > 0.5,
    showEditedBadges: Math.random() > 0.5,
    showSubscriberBadges: Math.random() > 0.5,
    showVipBadges: Math.random() > 0.5,
    showEmotes: Math.random() > 0.5,
    filterBadWords: Math.random() > 0.5,
    badWords: Array.from({ length: Math.floor(Math.random() * 20) }, () => randomString(Math.floor(Math.random() * 15) + 1))
  };
}

/**
 * Generate a random platform with status
 */
function randomPlatformWithStatus(): PlatformWithStatus {
  return {
    ...randomPlatform(),
    active: Math.random() > 0.5
  };
}

/**
 * Generate a random WebSocket message of any type
 */
function randomWSMessage(): WSMessage {
  const types = Object.values(kWSMessageType);
  const type = types[Math.floor(Math.random() * types.length)];

  switch (type) {
    case kWSMessageType.serverStatus:
      return {
        type: kWSMessageType.serverStatus,
        data: {
          connected: Math.random() > 0.5,
          message: Math.random() > 0.5 ? randomString(50) : undefined
        }
      };

    case kWSMessageType.messageUpdate:
      return {
        type: kWSMessageType.messageUpdate,
        data: {
          message: randomChatMessage()
        }
      };

    case kWSMessageType.messageUpdateDeletedIds:
      const idCount = Math.floor(Math.random() * 100) + 1;
      return {
        type: kWSMessageType.messageUpdateDeletedIds,
        data: {
          ids: Array.from({ length: idCount }, () => `msg-${randomString(16)}`)
        }
      };

    case kWSMessageType.messageClearAll:
      return {
        type: kWSMessageType.messageClearAll,
        data: {}
      };

    case kWSMessageType.chatSettings:
      return {
        type: kWSMessageType.chatSettings,
        data: randomChatSettings()
      };

    case kWSMessageType.adminDeleteMessage:
      const deleteIdCount = Math.floor(Math.random() * 10) + 1;
      // Note: Schema expects 'id' but type definition uses 'ids' - using 'ids' to match actual usage
      return {
        type: kWSMessageType.adminDeleteMessage,
        data: {
          ids: Array.from({ length: deleteIdCount }, () => `msg-${randomString(16)}`)
        }
      };

    case kWSMessageType.adminUpdateSettings:
      const partialSettings: Partial<ChatSettings> = {};
      if (Math.random() > 0.5) partialSettings.showAvatars = Math.random() > 0.5;
      if (Math.random() > 0.5) partialSettings.showBadges = Math.random() > 0.5;
      if (Math.random() > 0.5) partialSettings.filterBadWords = Math.random() > 0.5;
      if (Math.random() > 0.5) {
        partialSettings.badWords = Array.from({ length: Math.floor(Math.random() * 10) }, () => randomString(10));
      }
      return {
        type: kWSMessageType.adminUpdateSettings,
        data: partialSettings
      };

    case kWSMessageType.adminClearAllMessages:
      return {
        type: kWSMessageType.adminClearAllMessages,
        data: {}
      };

    case kWSMessageType.adminRefreshBetterTTV:
      return {
        type: kWSMessageType.adminRefreshBetterTTV,
        data: {}
      };

    case kWSMessageType.adminPlatformsStatus:
      const platformCount = Math.floor(Math.random() * 5) + 1;
      return {
        type: kWSMessageType.adminPlatformsStatus,
        data: {
          platforms: Array.from({ length: platformCount }, () => randomPlatformWithStatus())
        }
      };

    case kWSMessageType.adminPlatformStatusUpdate:
      return {
        type: kWSMessageType.adminPlatformStatusUpdate,
        data: {
          platform: randomPlatformWithStatus()
        }
      };

    default:
      // Fallback (should never happen)
      return {
        type: kWSMessageType.serverStatus,
        data: { connected: true }
      };
  }
}

/**
 * Benchmark validation performance
 */
export function benchmarkValidation(): void {
  console.log(`Generating ${kTestMessageCount} random WebSocket messages...`);
  const messages: WSMessage[] = [];

  for (let i = 0; i < kTestMessageCount; i++) {
    messages.push(randomWSMessage());
  }

  console.log('Starting validation benchmark...\n');

  // Warm-up run (to avoid JIT compilation affecting results)
  console.log('Warming up...');
  for (let i = 0; i < kWarmupMessageCount; i++) {
    validateWSMessage(messages[i]);
  }

  // Actual benchmark
  console.log('Running benchmark...');
  const start = performance.now();
  let validCount = 0;
  let invalidCount = 0;

  for (const message of messages) {
    const result = validateWSMessage(message);
    if (result) {
      validCount++;
    } else {
      invalidCount++;
    }
  }

  const end = performance.now();
  const totalTime = end - start;
  const avg = totalTime / messages.length;
  const throughput = 1000 / avg;

  console.log('\n=== Validation Benchmark Results ===');
  console.log(`Total messages: ${messages.length.toLocaleString()}`);
  console.log(`Valid messages: ${validCount.toLocaleString()}`);
  console.log(`Invalid messages: ${invalidCount.toLocaleString()}`);
  console.log(`Total time: ${totalTime.toFixed(2)}ms`);
  console.log(`Average per message: ${avg.toFixed(4)}ms`);
  console.log(`Throughput: ${throughput.toFixed(0)} messages/second`);
  console.log(`\nEstimated CPU usage:`);
  console.log(`  At 10 msg/sec: ${(avg * 10).toFixed(2)}ms/sec (${((avg * 10) / 10).toFixed(2)}% CPU)`);
  console.log(`  At 50 msg/sec: ${(avg * 50).toFixed(2)}ms/sec (${((avg * 50) / 10).toFixed(2)}% CPU)`);
  console.log(`  At 100 msg/sec: ${(avg * 100).toFixed(2)}ms/sec (${((avg * 100) / 10).toFixed(2)}% CPU)`);
  console.log(`  At 500 msg/sec: ${(avg * 500).toFixed(2)}ms/sec (${((avg * 500) / 10).toFixed(2)}% CPU)`);
  console.log('===================================\n');

  // Breakdown by message type
  console.log('Message type distribution:');
  const typeCounts: Record<string, number> = {};
  for (const message of messages) {
    typeCounts[message.type] = (typeCounts[message.type] || 0) + 1;
  }
  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    const percentage = ((count / messages.length) * 100).toFixed(1);
    console.log(`  ${type}: ${count} (${percentage}%)`);
  }
}

// Run the benchmark
try {
  benchmarkValidation();
} catch (error) {
  console.error('Error running benchmark:', error);
  process.exit(1);
}

