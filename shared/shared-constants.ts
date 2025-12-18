import { ChatSettings } from "./shared-types";

export const kMaxMessages = 60;

export const kBatchDelayMS = 200;

export const kDefaultChatSettings: ChatSettings = {
  showAvatars: true,
  showBadges: false,
  showModeratorBadges: true,
  showEditedBadges: true,
  showSubscriberBadges: true,
  showVipBadges: true,
  showEmotes: true,
  filterBadWords: true,
  badWords: [],
  userFont: null,
  adminFont: null,
  usernameFont: null,
  adminLineHeight: 1.2,
  userLineHeight: 1.2,
  chatScale: 1,
};
