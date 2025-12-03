import { ChatSettings } from "./shared-types";

export const kDefaultChatSettings: ChatSettings = Object.freeze({
  showAvatars: true,
  showBadges: false,
  showModeratorBadges: true,
  showEditedBadges: true,
  showSubscriberBadges: true,
  showVipBadges: true,
  showEmotes: true,
  filterBadWords: false,
  badWords: [],
});
