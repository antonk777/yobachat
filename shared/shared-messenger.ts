import { WSMessage, kWSMessageType } from "./shared-types";

export const encodeWSMessage = (message: WSMessage): string => {
  return JSON.stringify(message);
}

export const decodeWSMessage = (message: string) => {
  try {
    const messageParsed = JSON.parse(message) as WSMessage;

    if (!messageParsed.type || typeof messageParsed.data !== 'object') {
      throw new Error(`Invalid message: ${message}`);
    }

    switch (messageParsed.type) {
      case kWSMessageType.adminServerStatus:
      case kWSMessageType.messageUpdate:
      case kWSMessageType.messageUpdateDeletedIds:
      case kWSMessageType.messageClearAll:
      case kWSMessageType.chatSettings:
      case kWSMessageType.widgetRefresh:
      case kWSMessageType.adminDeleteMessage:
      case kWSMessageType.adminUpdateSettings:
      case kWSMessageType.adminClearAllMessages:
      case kWSMessageType.adminRefreshWidget:
      case kWSMessageType.adminRestartServer:
      case kWSMessageType.adminPlatformsStatus:
      case kWSMessageType.adminPlatformStatusUpdate:
        return messageParsed;
      default:
        console.log(`[decodeWSMessage] Invalid message type: ${message}`);
        return null;
    }
  } catch (error) {
    console.error(`[decodeWSMessage] Failed to parse message: ${message}`, error);
    return null;
  }
}
