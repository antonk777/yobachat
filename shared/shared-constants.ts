import { ChatSettings } from "./shared-types";

export const kMaxHistoryMessages = 100;

export const kBatchDelayMS = 200;

export const kDefaultChatSettings: ChatSettings = {
  showAvatars: true,
  showBadges: false,
  showModeratorBadges: true,
  showEditedBadges: true,
  showSubscriberBadges: true,
  showVipBadges: true,
  showEmotes: true,
  showReplyTo: true,
  filterBadWords: true,
  filterLinks: true,
  makeLinksClickable: false,
  showApprovedTgVideosInChat: false,
  tgVideoWidgetMinLoops: 5,
  tgVideoWidgetMinDurationSec: 15,
  badWords: [],
  userFont: null,
  adminFont: null,
  usernameFont: null,
  adminLineHeight: 1.2,
  userLineHeight: 1.2,
  chatScale: 1,
  adminScale: 1
};
