// Hand-written seed comments. Pure data: no I/O, no Prisma. Each one points
// at a post in seed-users.ts by author username and post index (0 = that
// author's newest post) and is written by someone other than the post's
// author (checked in validateSeedData).

export interface SeedCommentSpec {
  author: string;
  on: { username: string; index: number };
  body: string;
}

export const SEED_COMMENTS: readonly SeedCommentSpec[] = [
  {
    author: 'dan_okafor',
    on: { username: 'demo', index: 1 },
    body: 'Agreed. And make it forgiving about typos.',
  },
  {
    author: 'ana_torres',
    on: { username: 'demo', index: 5 },
    body: 'Welcome! Redesigning an onboarding flow this week, so wish me luck.',
  },
  {
    author: 'lena_reads',
    on: { username: 'demo', index: 3 },
    body: '74 is rookie numbers. Mine lives in a spreadsheet.',
  },
  {
    author: 'marcus_bakes',
    on: { username: 'demo', index: 4 },
    body: 'Pancakes from scratch are always worth it. Try buttermilk next time!',
  },
  {
    author: 'priya_codes',
    on: { username: 'demo', index: 2 },
    body: 'Day two is the hardest. You have got this!',
  },
  {
    author: 'demo',
    on: { username: 'ana_torres', index: 0 },
    body: 'Empty states are so underrated. Great reminder.',
  },
  {
    author: 'demo',
    on: { username: 'dan_okafor', index: 0 },
    body: '4ms! You have earned the right to be insufferable.',
  },
  {
    author: 'demo',
    on: { username: 'juan_cycles', index: 5 },
    body: 'Congrats! Hope more cities follow.',
  },
  {
    author: 'priya_codes',
    on: { username: 'dan_okafor', index: 5 },
    body: 'It is my default for every prototype now.',
  },
  {
    author: 'mia_frontend',
    on: { username: 'ana_torres', index: 6 },
    body: 'A contrast checker, every single time.',
  },
  {
    author: 'nathan_coffee',
    on: { username: 'marcus_bakes', index: 0 },
    body: 'Trade you a bag of fresh roast for a loaf?',
  },
  {
    author: 'marcus_bakes',
    on: { username: 'sofia_runs', index: 6 },
    body: 'Next time stop in. Carbs are fuel.',
  },
  {
    author: 'lucas_surf',
    on: { username: 'sofia_runs', index: 3 },
    body: 'You will love it. Mountains are humbling.',
  },
  {
    author: 'zoe_astro',
    on: { username: 'kenji_photo', index: 0 },
    body: 'Would love to see that shot!',
  },
  {
    author: 'omar_travels',
    on: { username: 'lena_reads', index: 0 },
    body: 'Try a travel memoir as a palate cleanser.',
  },
  {
    author: 'fatima_writes',
    on: { username: 'lena_reads', index: 1 },
    body: 'Wrote most of my first book in a library. Forever grateful.',
  },
  {
    author: 'susan_knits',
    on: { username: 'chloe_plants', index: 2 },
    body: 'My cat does the same with my yarn basket.',
  },
  {
    author: 'grace_music',
    on: { username: 'ivan_chess', index: 2 },
    body: 'Kids are fearless. That is the secret.',
  },
  {
    author: 'ivan_chess',
    on: { username: 'elena_data', index: 0 },
    body: 'Same goes for rating graphs. People love to crop them.',
  },
  {
    author: 'hannah_vet',
    on: { username: 'nadia_art', index: 4 },
    body: 'I know a few patients who would happily model for this.',
  },
  {
    author: 'raj_startups',
    on: { username: 'samuel_cooks', index: 0 },
    body: 'What is your secret for cooking at that scale?',
  },
  {
    author: 'samuel_cooks',
    on: { username: 'tom_gardens', index: 2 },
    body: 'Send them my way, I will make fritters.',
  },
  {
    author: 'tom_gardens',
    on: { username: 'oscar_birds', index: 2 },
    body: 'Keep us posted on the nest!',
  },
  {
    author: 'oscar_birds',
    on: { username: 'zoe_astro', index: 1 },
    body: 'The birds will thank you too. Light pollution confuses migration.',
  },
  {
    author: 'aisha_teaches',
    on: { username: 'zoe_astro', index: 2 },
    body: 'Telling my students about this, thanks!',
  },
  {
    author: 'ben_retro',
    on: { username: 'leo_films', index: 1 },
    body: 'Same for games. Give me a tight eight-hour campaign.',
  },
  {
    author: 'leo_films',
    on: { username: 'grace_music', index: 5 },
    body: 'Which scores? Always looking for new ones.',
  },
  {
    author: 'elena_data',
    on: { username: 'priya_codes', index: 1 },
    body: 'Printing this and taping it to my monitor.',
  },
  {
    author: 'mia_frontend',
    on: { username: 'dan_okafor', index: 2 },
    body: "And your infinite scroll stops skipping items. Chef's kiss.",
  },
  {
    author: 'nadia_art',
    on: { username: 'susan_knits', index: 0 },
    body: 'It looks amazing! Can I draw it?',
  },
  {
    author: 'kenji_photo',
    on: { username: 'omar_travels', index: 0 },
    body: 'Train windows are the best viewfinders.',
  },
];
