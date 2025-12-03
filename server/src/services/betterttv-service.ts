import chalk from 'chalk';

import type {
  BetterTTVConfig,
  ChatMessage
} from '@shared/shared-types.js';


type BetterTTVEmote = {
  id: string;
  code: string;
};

type BetterTTVChannelResponse = {
  channelEmotes?: BetterTTVEmote[];
  sharedEmotes?: BetterTTVEmote[];
};

const
  kBetterTTVGlobalEndpoint = 'https://api.betterttv.net/3/cached/emotes/global',
  kEmoteTokenRegex = /[A-Za-z0-9_\-]+/g;

export class BetterTTVService {
  private readonly config: BetterTTVConfig;
  private globalEmotes: Map<string, string> = new Map();
  private channelEmotes: Map<string, string> = new Map();
  private readonly logPrefix: string;

  constructor(config: BetterTTVConfig) {
    this.config = config;
    this.logPrefix = chalk.hex(config.color)('[BetterTTV]');
  }

  async update(): Promise<void> {
    await this.reloadEmotes();
  }

  enhanceMessage(message: ChatMessage): ChatMessage {
    const emotes = this.getEmotes(message.message);

    if (emotes.length === 0) {
      return message;
    }

    const mergedEmotes: Record<string, string> = message.emotesMap
      ? { ...message.emotesMap }
      : {};

    for (const emote of emotes) {
      if (mergedEmotes[emote]) {
        const resolvedUrl = this.channelEmotes.get(emote) ?? this.globalEmotes.get(emote);

        if (resolvedUrl) {
          mergedEmotes[emote] = resolvedUrl;
        }
      }
    }

    message.emotesMap = Object.keys(mergedEmotes).length > 0
      ? mergedEmotes
      : undefined;

    return message;
  }

  private async reloadEmotes(): Promise<void> {
    const { config } = this;

    if (config.includeGlobal !== false) {
      try {
        this.globalEmotes = await this.fetchGlobalEmotes();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`${this.logPrefix} Failed to load global emotes: ${errorMessage}`);
        this.globalEmotes = new Map();
      }
    } else {
      this.globalEmotes = new Map();
    }

    if (config.includeChannel !== false) {
      try {
        this.channelEmotes = await this.fetchChannelEmotes(config.channelId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`${this.logPrefix} Failed to load channel emotes: ${errorMessage}`);
        this.channelEmotes = new Map();
      }
    } else {
      this.channelEmotes = new Map();
    }
  }

  private getEmotes(messageText: string): string[] {
    const matches = messageText.matchAll(kEmoteTokenRegex);

    const emotes: string[] = [];

    for (const match of matches) {
      if (match[0]) {
        emotes.push(match[0]);
      }
    }

    return [...new Set(emotes)];
  }

  private async fetchGlobalEmotes(): Promise<Map<string, string>> {
    const response = await fetch(kBetterTTVGlobalEndpoint);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }

    const payload = (await response.json()) as BetterTTVEmote[];

    return this.convertBetterTTVEmotes(payload);
  }

  private async fetchChannelEmotes(channelId: string): Promise<Map<string, string>> {
    const response = await fetch(this.getChannelEndpoint(channelId));

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} - ${response.statusText}`);
    }

    const payload = (await response.json()) as BetterTTVChannelResponse;

    const combined = [
      ...(payload.channelEmotes ?? []),
      ...(payload.sharedEmotes ?? [])
    ];

    return this.convertBetterTTVEmotes(combined);
  }

  private convertBetterTTVEmotes(emotes: BetterTTVEmote[]): Map<string, string> {
    const entries = emotes
      .filter(emote => emote.id && emote.code)
      .map((emote): [string, string] => [emote.code, this.getCdnUrl(emote.id)]);

    return new Map(entries);
  }

  private getChannelEndpoint(channelId: string): string {
    return `https://api.betterttv.net/3/cached/users/twitch/${channelId}`;
  }

  private getCdnUrl(emoteId: string): string {
    return `https://cdn.betterttv.net/emote/${emoteId}/3x`;
  }
}

