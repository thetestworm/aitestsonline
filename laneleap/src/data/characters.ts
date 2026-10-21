/**
 * Character roster metadata. Kept tiny so it can ship in the main bundle; the
 * voxel model builders live in `characterModels.ts` and are lazy-loaded.
 * Every character, name and design here is original to Laneleap.
 */
import type { WorldId } from './worldIds';

export type Rarity = 'common' | 'rare' | 'epic' | 'secret';
export type Template = 'blob' | 'quad' | 'bird' | 'biped' | 'bot' | 'bug' | 'box' | 'fish' | 'plant';
export type DeathStyle =
  | 'poof'
  | 'spin'
  | 'shatter'
  | 'ghost'
  | 'melt'
  | 'feathers'
  | 'sparks'
  | 'confetti';
export type Special = 'magnet' | 'floatOnce' | 'doubleCoins' | 'rainbowTrail' | 'glow' | 'retro';

export interface HopSound {
  wave: OscillatorType;
  f0: number;
  f1: number;
  dur: number;
  /** Mix in a short noise burst (rustle/clank). */
  noise?: number;
}

export interface SecretUnlock {
  stat: 'bestScore' | 'totalCoinsEarned' | 'missionsCompleted' | 'predatorDeaths' | 'gamesPlayed';
  value: number;
  hint: string;
}

export interface CharacterDef {
  id: string;
  name: string;
  rarity: Rarity;
  blurb: string;
  template: Template;
  /** [main, secondary, accent, detail] hex colours. */
  colors: [string, string, string, string];
  parts: string[];
  hop: HopSound;
  death: DeathStyle;
  world?: WorldId;
  special?: Special;
  secret?: SecretUnlock;
}

const sq = (f0: number, f1: number, dur = 0.09): HopSound => ({ wave: 'square', f0, f1, dur });
const tri = (f0: number, f1: number, dur = 0.1): HopSound => ({ wave: 'triangle', f0, f1, dur });
const sine = (f0: number, f1: number, dur = 0.1): HopSound => ({ wave: 'sine', f0, f1, dur });
const saw = (f0: number, f1: number, dur = 0.08): HopSound => ({ wave: 'sawtooth', f0, f1, dur });

export const CHARACTERS: readonly CharacterDef[] = [
  { id: 'sprout', name: 'Sprout', rarity: 'common', blurb: 'A bean sprout with places to be.', template: 'blob', colors: ['#8ee05a', '#5fb83a', '#3d8a25', '#ffffff'], parts: ['leaf'], hop: tri(520, 780), death: 'poof' },
  { id: 'pebble', name: 'Pebble Pup', rarity: 'common', blurb: 'Fetches anything. Even trouble.', template: 'quad', colors: ['#b9b2a8', '#8a8178', '#f2ede6', '#3a3330'], parts: ['ears', 'tail'], hop: sq(300, 420), death: 'spin' },
  { id: 'marmalade', name: 'Marmalade', rarity: 'common', blurb: 'An orange tabby with zero chill.', template: 'quad', colors: ['#f29a3a', '#c66f1c', '#fff1dc', '#5a2e10'], parts: ['earsPointy', 'tailLong', 'stripes'], hop: tri(640, 900, 0.07), death: 'poof' },
  { id: 'quillby', name: 'Quillby', rarity: 'common', blurb: 'Pointy outside, soft inside.', template: 'quad', colors: ['#c9a47a', '#6e4a2f', '#f7e3c9', '#221510'], parts: ['spikes'], hop: { ...sq(220, 260), noise: 0.3 }, death: 'shatter' },
  { id: 'puddle', name: 'Puddle', rarity: 'common', blurb: 'Brought a rain hat. Just in case.', template: 'bird', colors: ['#ffe066', '#f5b82e', '#ff8c2e', '#2d6cdf'], parts: ['beak', 'hat'], hop: sine(700, 1000), death: 'feathers' },
  { id: 'bolt7', name: 'Bolt-7', rarity: 'common', blurb: 'Hop protocol: engaged.', template: 'bot', colors: ['#c4ccd6', '#7d8794', '#ff4b4b', '#2b3440'], parts: ['antenna'], hop: sq(180, 360, 0.06), death: 'sparks' },
  { id: 'toastie', name: 'Toastie', rarity: 'common', blurb: 'Pops up when you least expect it.', template: 'box', colors: ['#d8dde3', '#9aa4ae', '#e3a857', '#33373d'], parts: ['toast'], hop: sq(260, 520, 0.05), death: 'sparks' },
  { id: 'gumdrop', name: 'Gumdrop', rarity: 'common', blurb: 'Wobbly, sugary, unstoppable.', template: 'blob', colors: ['#ff7eb6', '#e0508f', '#ffd1e6', '#4a1030'], parts: ['shine'], hop: sine(380, 620, 0.12), death: 'melt' },
  { id: 'fernando', name: 'Fernando', rarity: 'common', blurb: 'A potted fern on a world tour.', template: 'plant', colors: ['#4fb34a', '#2e7d32', '#c0673a', '#7a3a1a'], parts: ['pot', 'fronds'], hop: { ...tri(330, 400), noise: 0.2 }, death: 'confetti' },
  { id: 'mossback', name: 'Mossback', rarity: 'common', blurb: 'Slow and steady? Not today.', template: 'quad', colors: ['#7bbf5a', '#4e7d39', '#c9b16b', '#1f2d18'], parts: ['shell'], hop: tri(200, 260, 0.12), death: 'spin' },
  { id: 'glint', name: 'Glint', rarity: 'common', blurb: 'A beetle with a polished attitude.', template: 'bug', colors: ['#2ec4b6', '#167f78', '#9ff5ec', '#0d2b29'], parts: ['antennae', 'shellShine'], hop: saw(500, 640, 0.05), death: 'shatter' },
  { id: 'honeybun', name: 'Honeybun', rarity: 'common', blurb: 'Buzzes in four-four time.', template: 'bug', colors: ['#ffc93c', '#2b2b2b', '#e6f6ff', '#1a1a1a'], parts: ['stripes', 'wings', 'antennae'], hop: saw(220, 240, 0.09), death: 'poof' },
  { id: 'puffin', name: 'Puffin Muffin', rarity: 'common', blurb: 'Seabird. Baker. Hopper.', template: 'bird', colors: ['#2c2f38', '#f4f4f4', '#ff7a2f', '#ffcf3a'], parts: ['beakBig'], hop: sine(560, 820), death: 'feathers' },
  { id: 'flurry', name: 'Flurry', rarity: 'rare', blurb: 'A pocket-sized yeti. Unbothered by snow.', template: 'biped', colors: ['#f2f7ff', '#b8d4f0', '#5e9bd6', '#26405e'], parts: ['fur', 'horns'], hop: tri(420, 300, 0.12), death: 'shatter', world: 'tundra' },
  { id: 'conifer', name: 'Conifer', rarity: 'common', blurb: 'A pinecone that took a wrong turn.', template: 'blob', colors: ['#8a5a32', '#5c3a1e', '#b78a5a', '#2a1a0c'], parts: ['scales'], hop: { ...sq(240, 300), noise: 0.4 }, death: 'shatter', world: 'tundra' },
  { id: 'prickles', name: 'Prickles', rarity: 'rare', blurb: 'Hugs not recommended.', template: 'plant', colors: ['#5ba84a', '#3f7d33', '#ff6f91', '#d9b26f'], parts: ['cactusArms', 'flower'], hop: tri(360, 480), death: 'poof', world: 'desert' },
  { id: 'sirocco', name: 'Sirocco', rarity: 'rare', blurb: 'A dune fox with satellite ears.', template: 'quad', colors: ['#f0c27b', '#c98f45', '#fff4e0', '#3b2410'], parts: ['earsBig', 'tailBushy'], hop: tri(620, 760, 0.07), death: 'spin', world: 'desert' },
  { id: 'sundial', name: 'Sundial', rarity: 'rare', blurb: 'A scarab who always knows the time.', template: 'bug', colors: ['#e2b33c', '#9c7417', '#5ad1e6', '#2b1f05'], parts: ['shellShine', 'horn'], hop: saw(300, 420, 0.06), death: 'sparks', world: 'desert' },
  { id: 'glitch', name: 'Glitch', rarity: 'rare', blurb: 'Patched 400 times. Still buggy.', template: 'bot', colors: ['#1d1f3a', '#ff2fd0', '#2ff5ff', '#0b0b18'], parts: ['visor', 'antenna'], hop: sq(880, 220, 0.05), death: 'sparks', world: 'neon' },
  { id: 'synth', name: 'Synthwave', rarity: 'rare', blurb: 'A cat who only listens to cassettes.', template: 'quad', colors: ['#6a3cff', '#3a1f9e', '#ff4fd8', '#13072e'], parts: ['earsPointy', 'tailLong', 'glasses'], hop: saw(440, 880, 0.08), death: 'confetti', world: 'neon' },
  { id: 'cabbie', name: 'Cabbie', rarity: 'common', blurb: 'Meter is running. So is Cabbie.', template: 'box', colors: ['#ffd23f', '#222222', '#ffffff', '#ff5252'], parts: ['checker', 'roofSign'], hop: sq(330, 330, 0.07), death: 'sparks', world: 'neon' },
  { id: 'sugarplum', name: 'Sugarplum', rarity: 'rare', blurb: 'Dusted in powdered sugar.', template: 'blob', colors: ['#b05cff', '#7a2fd6', '#ffffff', '#3a0d6b'], parts: ['sprinkles', 'bow'], hop: sine(900, 1200, 0.08), death: 'confetti', world: 'candy' },
  { id: 'fizz', name: 'Fizz', rarity: 'common', blurb: 'Shake well before hopping.', template: 'box', colors: ['#ff4f4f', '#c4c4c4', '#ffffff', '#7a0f0f'], parts: ['canTop'], hop: { ...sine(500, 900, 0.07), noise: 0.5 }, death: 'confetti', world: 'candy' },
  { id: 'mallow', name: 'Mallow', rarity: 'rare', blurb: 'A marshmallow moose. Lightly toasted.', template: 'quad', colors: ['#fff6ee', '#f2d6c2', '#c98a5a', '#4a2a18'], parts: ['antlers'], hop: sine(260, 380, 0.14), death: 'melt', world: 'candy' },
  { id: 'nocturne', name: 'Nocturne', rarity: 'rare', blurb: 'An owl who keeps very late hours.', template: 'bird', colors: ['#5b4a8a', '#3a2e5e', '#ffd84a', '#1b1430'], parts: ['earTufts', 'bigEyes'], hop: sine(300, 220, 0.12), death: 'feathers' },
  { id: 'echo', name: 'Echo', rarity: 'epic', blurb: 'A bat who hops instead of flying. Long story.', template: 'bird', colors: ['#3b3247', '#251e2e', '#ff6b8b', '#0e0b12'], parts: ['wingsBat', 'earsPointy'], hop: sine(1400, 1800, 0.05), death: 'ghost' },
  { id: 'reef', name: 'Reef', rarity: 'epic', blurb: 'A fish that grew legs out of spite.', template: 'fish', colors: ['#ff8a3d', '#ffffff', '#1f6feb', '#2a1406'], parts: ['fins', 'stripes'], hop: sine(450, 300, 0.1), death: 'melt' },
  { id: 'cinder', name: 'Cinder', rarity: 'epic', blurb: 'A salamander who runs a little hot.', template: 'quad', colors: ['#ff4e2a', '#b02a12', '#ffd23f', '#2b0a04'], parts: ['spots', 'tailLong'], hop: { ...saw(260, 520, 0.07), noise: 0.25 }, death: 'sparks' },
  { id: 'sirhops', name: 'Sir Hopsalot', rarity: 'rare', blurb: 'Sworn to protect the crosswalk.', template: 'biped', colors: ['#c0c8d2', '#7a8592', '#d23b3b', '#30363d'], parts: ['helmet', 'plume'], hop: { ...sq(200, 240), noise: 0.45 }, death: 'shatter' },
  { id: 'orbit', name: 'Orbit', rarity: 'epic', blurb: 'One small hop for a kid.', template: 'biped', colors: ['#f4f6f8', '#c7ced6', '#ffb02e', '#2b5cff'], parts: ['spaceHelmet', 'pack'], hop: sine(800, 400, 0.13), death: 'ghost' },
  { id: 'brine', name: 'Brinebones', rarity: 'epic', blurb: 'A skeleton deckhand. Allergic to water. Ironically.', template: 'biped', colors: ['#efe9d8', '#c9bfa5', '#3a2a5a', '#1a1410'], parts: ['bandana', 'eyepatch'], hop: { ...tri(180, 160, 0.08), noise: 0.5 }, death: 'shatter' },
  { id: 'mystic', name: 'Mystic Mo', rarity: 'rare', blurb: 'Knows exactly one spell: hop.', template: 'biped', colors: ['#3b5bdb', '#22398f', '#ffd43b', '#f1e0c5'], parts: ['hatWizard', 'beard'], hop: sine(660, 990, 0.1), death: 'sparks' },
  { id: 'yak', name: 'Prism Yak', rarity: 'epic', blurb: 'Leaves a rainbow everywhere it goes.', template: 'quad', colors: ['#f5f5f5', '#d9d9d9', '#ff5fa2', '#4a3b5a'], parts: ['fur', 'horns', 'mane'], hop: tri(240, 360, 0.12), death: 'confetti', special: 'rainbowTrail' },
  { id: 'moth', name: 'Glimmer Moth', rarity: 'secret', blurb: 'Coins drift towards its glow (collects adjacent coins).', template: 'bug', colors: ['#f6efd2', '#d9c98f', '#9be7ff', '#3a3420'], parts: ['wingsMoth', 'antennae'], hop: sine(1000, 1300, 0.06), death: 'ghost', special: 'magnet', secret: { stat: 'totalCoinsEarned', value: 500, hint: 'Earn 500 coins in total.' } },
  { id: 'lantern', name: 'Phantom Lantern', rarity: 'secret', blurb: 'Floats over water once per run.', template: 'blob', colors: ['#d7f7ff', '#a5e4f5', '#ffe066', '#2b4a52'], parts: ['ghostTail', 'flame'], hop: sine(300, 600, 0.15), death: 'ghost', special: 'floatOnce', secret: { stat: 'predatorDeaths', value: 3, hint: 'Get snatched from above 3 times.' } },
  { id: 'golden', name: 'Golden Sprout', rarity: 'secret', blurb: 'Every coin counts double.', template: 'blob', colors: ['#ffd700', '#e0a800', '#fff6b0', '#5a4300'], parts: ['leaf', 'crown'], hop: sine(880, 1320, 0.09), death: 'sparks', special: 'doubleCoins', secret: { stat: 'bestScore', value: 150, hint: 'Reach a score of 150.' } },
  { id: 'retro', name: 'Bitsy', rarity: 'secret', blurb: 'From an older, blockier era. Glows in the dark.', template: 'bot', colors: ['#7cff6b', '#2e9e23', '#ffffff', '#0b2a08'], parts: ['pixelFace'], hop: sq(440, 880, 0.04), death: 'shatter', special: 'glow', secret: { stat: 'missionsCompleted', value: 10, hint: 'Complete 10 missions.' } },
];

export const DEFAULT_CHARACTER = 'sprout';

export function getCharacter(id: string): CharacterDef {
  return CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
}

export const RARITY_WEIGHT: Record<Rarity, number> = { common: 10, rare: 4, epic: 1.5, secret: 0 };
