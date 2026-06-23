import type { BdslmChatMessage } from '@ldpass/contracts';

type FlexibleBdslmChatMessage = BdslmChatMessage & Record<string, unknown>;

export function readBdslmChatMessageId(message: BdslmChatMessage): number {
  const rawId = (message as FlexibleBdslmChatMessage).id;
  const parsedId = typeof rawId === 'number' ? rawId : Number.parseInt(String(rawId ?? ''), 10);

  return Number.isFinite(parsedId) ? parsedId : -1;
}

export function readBdslmChatSender(message: BdslmChatMessage): string {
  return readFirstString(message, ['name', 'text', 'playerName', 'player', 'username']).trim();
}

export function readBdslmChatContent(message: BdslmChatMessage): string {
  const content = readFirstString(message, ['content', 'message', 'body']);
  if (content) {
    return content.trim();
  }

  // Some adapters use `text` for the chat body while still keeping `name` as the sender.
  if (readFirstString(message, ['name'])) {
    return readFirstString(message, ['text']).trim();
  }

  return '';
}

function readFirstString(message: BdslmChatMessage, fields: string[]): string {
  const flexibleMessage = message as FlexibleBdslmChatMessage;

  for (const field of fields) {
    const value = flexibleMessage[field];
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }

  return '';
}
