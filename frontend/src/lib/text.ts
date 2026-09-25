// Max length of a post or comment body, in Unicode code points (the backend counts the same way).
export const POST_MAX_LENGTH = 280;

// Screen readers hear the remaining count only from this many characters left (and over the
// limit), not on every keystroke.
const ANNOUNCE_FROM_REMAINING = 20;

// Length in Unicode code points, so an emoji (a surrogate pair) counts as 1, like the backend.
export const countCodePoints = (str?: string | null) => Array.from(str ?? '').length;

// What a composer (post or comment) needs to know about its draft: the trimmed body that would be
// sent, its code-point length, how many characters are left (negative = over the limit), and
// whether it can be sent at all (not blank, not over 280).
export function measureBody(body: string) {
  const trimmed = body.trim();
  const length = countCodePoints(trimmed);
  const remaining = POST_MAX_LENGTH - length;
  const isOver = remaining < 0;
  return { trimmed, length, remaining, isOver, isValid: trimmed.length > 0 && !isOver };
}

// The polite live-region text for the counter: silent until 20 left, then "N characters left" /
// "N characters over the limit".
export function limitAnnouncement(remaining: number) {
  if (remaining < 0) {
    const over = -remaining;
    return `${over} character${over === 1 ? '' : 's'} over the limit`;
  }
  if (remaining <= ANNOUNCE_FROM_REMAINING) {
    return `${remaining} character${remaining === 1 ? '' : 's'} left`;
  }
  return '';
}

// Whether a textarea keydown is the "send" shortcut: Cmd/Ctrl+Enter, but not while an IME is
// composing (Enter then confirms the composition and must not send).
// The keydown fields read below (a React `KeyboardEvent` fits).
export interface SubmitShortcutEvent {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean };
}

export function isSubmitShortcut(event: SubmitShortcutEvent) {
  if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return false;
  return !(event.nativeEvent?.isComposing || event.keyCode === 229);
}
