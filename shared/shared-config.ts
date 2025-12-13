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
  // User widget font settings
  userFontFamily: undefined,
  userFontWeight: 500,
  userGoogleFontsCssUrl: undefined,
  // Admin panel font settings
  adminFontFamily: undefined,
  adminFontWeight: 500,
  adminGoogleFontsCssUrl: undefined,
});
