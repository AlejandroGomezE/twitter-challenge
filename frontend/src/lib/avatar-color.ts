// Background/foreground pairs for the avatar placeholder, derived from the Pulse tints (primary
// coral + chart colours, plus teal / violet / ochre in the same lightness-chroma family). The tints
// are fixed (not theme tokens), so each one carries the fixed foreground that clears WCAG AA 4.5:1
// on it: white on the darker tints, warm near-black on the lighter ones. Readable in both themes.
// Full class strings so Tailwind picks them up.
const AVATAR_COLORS = [
  'bg-[oklch(0.585_0.196_30)] text-white',
  'bg-[oklch(0.62_0.15_150)] text-[oklch(0.2_0.012_60)]',
  'bg-[oklch(0.6_0.13_240)] text-[oklch(0.2_0.012_60)]',
  'bg-[oklch(0.7_0.15_80)] text-[oklch(0.2_0.012_60)]',
  'bg-[oklch(0.55_0.16_320)] text-white',
  'bg-[oklch(0.6_0.12_200)] text-[oklch(0.2_0.012_60)]',
  'bg-[oklch(0.55_0.15_280)] text-white',
  'bg-[oklch(0.65_0.14_55)] text-[oklch(0.2_0.012_60)]',
];

// Deterministic colour for a username: same username (any case) → same classes.
export function getAvatarColor(username: string) {
  const value = username.toLowerCase();
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// The placeholder's letter: the username's first character, uppercased.
export const getAvatarInitial = (username: string) => username.charAt(0).toUpperCase();
