// Background/foreground pairs for the avatar placeholder, all with readable contrast (white text
// on a 600/700 shade). Full class strings so Tailwind picks them up.
const AVATAR_COLORS = [
  'bg-red-600 text-white',
  'bg-orange-600 text-white',
  'bg-amber-700 text-white',
  'bg-emerald-600 text-white',
  'bg-teal-600 text-white',
  'bg-sky-600 text-white',
  'bg-indigo-600 text-white',
  'bg-fuchsia-600 text-white',
];

// Deterministic colour for a username: same username (any case) → same classes.
export function getAvatarColor(username) {
  const value = username.toLowerCase();
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// The placeholder's letter: the username's first character, uppercased.
export const getAvatarInitial = (username) => username.charAt(0).toUpperCase();
