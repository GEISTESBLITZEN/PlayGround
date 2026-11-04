// Static game data: biomes, stages, genes, den modules, species, quests.

export const WORLD_SIZE = 6400;
export const DAY_LENGTH = 540; // seconds for a full day/night cycle

export const BIOMES = {
  deep: {
    name: 'Deep Water', map: '#0b3148', water: true, danger: 0,
    ground: '#0a3146', alt: '#0d3d54', detail: '#15506a',
    desc: 'Cold, lightless water. Only the gilled can linger here.'
  },
  shallow: {
    name: 'Shallows', map: '#1d6f80', water: true, danger: 0,
    ground: '#1c6675', alt: '#267e8b', detail: '#3ca2a8',
    desc: 'Warm shallows full of silverfin and reeds. Drink, fish, and watch for jaws.'
  },
  sand: {
    name: 'Sunwash Shore', map: '#cdb27b', water: false, danger: 0,
    ground: '#c9ad77', alt: '#dcc28b', detail: '#a88f5e',
    desc: 'Pale sand between the tide and the grass. Safe, open, and exposed.'
  },
  meadow: {
    name: 'Verdant Meadow', map: '#5d9a4c', water: false, danger: 1,
    ground: '#4c8a43', alt: '#63a050', detail: '#84b95d',
    desc: 'Sunlit grass, berries and butterflies. The cradle of most lineages.'
  },
  forest: {
    name: 'Whisperwood', map: '#356b3c', water: false, danger: 2,
    ground: '#2d5f36', alt: '#3c7341', detail: '#1e4929',
    desc: 'Old trees crowd out the sky. Rich food, but stalkers hunt in the green dark.'
  },
  swamp: {
    name: 'Mirefen', map: '#4e6b48', water: false, danger: 3,
    ground: '#405f42', alt: '#4f704a', detail: '#2f4b35',
    desc: 'Murky water and croaking things. Poisonous caps grow fat here.'
  },
  savannah: {
    name: 'Goldsea', map: '#b39a55', water: false, danger: 2,
    ground: '#a88f4d', alt: '#c1a75f', detail: '#87713d',
    desc: 'Endless dry grass under a wide sky. Big grazers and bigger hunters.'
  },
  highland: {
    name: 'Greycrown', map: '#7b796f', water: false, danger: 3,
    ground: '#747267', alt: '#8b897c', detail: '#5a584f',
    desc: 'Wind-scoured stone. Stonehorn rams and bone ravagers claim the crags.'
  },
  crystal: {
    name: 'Prism Hollow', map: '#5c4e80', water: false, danger: 4,
    ground: '#443a63', alt: '#564a79', detail: '#6d5ca0',
    desc: 'Singing crystal growths light the dark. Beautiful, rare, and guarded.'
  },
  ash: {
    name: 'Cinder Waste', map: '#4a3a36', water: false, danger: 5,
    ground: '#3a3232', alt: '#4a3d39', detail: '#241f1f',
    desc: 'Scorched ground and glowing fissures. The Hollow King sleeps here.'
  }
};

export const STAGES = [
  { name: 'Hatchling', xp: 0, scale: 0.7, blurb: 'Small, hungry, newly awake. Everything is bigger than you.' },
  { name: 'Forager', xp: 70, scale: 0.86, blurb: 'Your hide thickens and your senses sharpen. The world opens up.' },
  { name: 'Prowler', xp: 240, scale: 1.04, blurb: 'A capable hunter now. Stalkers think twice before charging.' },
  { name: 'Apex', xp: 560, scale: 1.24, blurb: 'You are the shape the food chain fears. Old instincts unlock.' },
  { name: 'Ascendant', xp: 1100, scale: 1.46, blurb: 'More myth than animal. Your lineage will be remembered.' }
];

export const CATEGORIES = [
  { id: 'body', name: 'Body', icon: '🦴', color: '#7cf0a8', desc: 'Bone, muscle and hide. The shape of your survival.' },
  { id: 'sense', name: 'Senses', icon: '👁', color: '#79c9ff', desc: 'Read the world before it reads you.' },
  { id: 'meta', name: 'Metabolism', icon: '🌿', color: '#ffd479', desc: 'Wring more life from every mouthful.' },
  { id: 'social', name: 'Social', icon: '🫂', color: '#ff9ec7', desc: 'Family, shelter and the bonds that outlast you.' },
  { id: 'exotic', name: 'Exotic', icon: '✦', color: '#b58cff', desc: 'Strange organs. Impossible advantages.' }
];

export const GENES = [
  // BODY
  { id: 'vigor', name: 'Vitality', cat: 'body', icon: '♥', max: 3, cost: 18, stage: 1, color: '#7cf0a8',
    blurb: 'Denser tissue and a stronger heart.', effect: (r) => `+${r * 18} max health` },
  { id: 'swift', name: 'Swiftness', cat: 'body', icon: '➤', max: 3, cost: 20, stage: 1, color: '#7cf0a8',
    blurb: 'Longer limbs and a lighter step.', effect: (r) => `+${Math.round(r * 9)}% movement speed` },
  { id: 'claws', name: 'Rending Claws', cat: 'body', icon: '⚔', max: 3, cost: 22, stage: 1, color: '#7cf0a8',
    blurb: 'Hooked claws that tear rather than scratch.', effect: (r) => `+${r * 3} bite damage` },
  { id: 'carapace', name: 'Carapace', cat: 'body', icon: '🛡', max: 3, cost: 24, stage: 1, color: '#7cf0a8',
    blurb: 'Layered plates grow along your back.', effect: (r) => `-${r * 9}% damage taken` },
  { id: 'regen', name: 'Regeneration', cat: 'body', icon: '✚', max: 2, cost: 40, stage: 2, color: '#7cf0a8',
    blurb: 'Wounds knit while you breathe.', effect: (r) => `+${(r * 0.35).toFixed(2)} health per second` },
  { id: 'gills', name: 'Gills', cat: 'body', icon: '≈', max: 1, cost: 34, stage: 2, color: '#7cf0a8',
    blurb: 'Feathery gills unfold behind your jaw.', effect: () => 'Breathe and move freely in deep water' },
  { id: 'wings', name: 'Glide Membranes', cat: 'body', icon: '⌁', max: 2, cost: 45, stage: 2, color: '#7cf0a8',
    blurb: 'Skin stretched over long finger bones.', effect: (r) => `+${r * 8} speed · unlock Wing Dash` },
  { id: 'spikes', name: 'Spine Spikes', cat: 'body', icon: '✶', max: 2, cost: 30, stage: 2, color: '#7cf0a8',
    blurb: 'Bony thorns bristle from your spine.', effect: (r) => `Reflect ${r * 20}% contact damage` },
  { id: 'might', name: 'Mighty Frame', cat: 'body', icon: '⬆', max: 2, cost: 52, stage: 3, color: '#7cf0a8',
    blurb: 'Grow until the ground complains.', effect: (r) => `+${r * 12}% size, health and damage · heavier` },
  // SENSES
  { id: 'eyes', name: 'Keen Eyes', cat: 'sense', icon: '◉', max: 3, cost: 16, stage: 1, color: '#79c9ff',
    blurb: 'A wider band of colour, a longer horizon.', effect: (r) => `+${r * 70} sight radius` },
  { id: 'scent', name: 'Scent Trails', cat: 'sense', icon: '〰', max: 1, cost: 20, stage: 1, color: '#79c9ff',
    blurb: 'Taste the air for food and materials.', effect: () => 'Mark nearby food and resources on screen' },
  { id: 'camouflage', name: 'Chromatic Hide', cat: 'sense', icon: '◐', max: 2, cost: 28, stage: 2, color: '#79c9ff',
    blurb: 'Your skin borrows the colour of the world.', effect: (r) => `Predators notice you ${r * 28}% later` },
  { id: 'nightvision', name: 'Night Eyes', cat: 'sense', icon: '☾', max: 1, cost: 25, stage: 2, color: '#79c9ff',
    blurb: 'The dark becomes a shade of grey.', effect: () => 'See clearly through the night' },
  { id: 'echo', name: 'Echo Sense', cat: 'sense', icon: '◎', max: 2, cost: 22, stage: 2, color: '#79c9ff',
    blurb: 'Click, listen, and map the unseen.', effect: (r) => `+${r * 90} sight · reveal more map` },
  // METABOLISM
  { id: 'digestion', name: 'Efficient Gut', cat: 'meta', icon: '◒', max: 3, cost: 16, stage: 1, color: '#ffd479',
    blurb: 'A second stomach, then a third.', effect: (r) => `+${r * 18}% food from everything you eat` },
  { id: 'watersacs', name: 'Water Sacs', cat: 'meta', icon: '◌', max: 2, cost: 18, stage: 1, color: '#ffd479',
    blurb: 'Store water in pleated folds of skin.', effect: (r) => `-${r * 17}% thirst` },
  { id: 'toxin', name: 'Toxin Filter', cat: 'meta', icon: '☣', max: 1, cost: 24, stage: 1, color: '#ffd479',
    blurb: 'A liver that argues with poison and wins.', effect: () => 'Eat any mushroom safely · resist venom' },
  { id: 'photo', name: 'Photosynthesis', cat: 'meta', icon: '☀', max: 2, cost: 30, stage: 2, color: '#ffd479',
    blurb: 'Green threads drink the sun.', effect: (r) => `+${(r * 0.06).toFixed(2)} food per second in daylight` },
  { id: 'hide', name: 'Insulated Hide', cat: 'meta', icon: '⛨', max: 2, cost: 26, stage: 1, color: '#ffd479',
    blurb: 'Fat and fur against wind and rain.', effect: (r) => `+${r * 8} health · weather drains ${r * 25}% less` },
  // SOCIAL
  { id: 'charm', name: 'Alluring Display', cat: 'social', icon: '❦', max: 3, cost: 18, stage: 1, color: '#ff9ec7',
    blurb: 'Colour, dance and a voice worth answering.', effect: (r) => `+${r * 8} courtship · better mates` },
  { id: 'pack', name: 'Pack Bond', cat: 'social', icon: '❖', max: 2, cost: 32, stage: 2, color: '#ff9ec7',
    blurb: 'Your young fight beside you.', effect: (r) => `Heirs deal +${r * 20}% damage · +${r * 5}% XP` },
  { id: 'nest', name: 'Nest Instinct', cat: 'social', icon: '⌂', max: 1, cost: 30, stage: 2, color: '#ff9ec7',
    blurb: 'A gnawing need for a place that is yours.', effect: () => 'UNLOCK DEN BUILDING (press B)' },
  { id: 'parental', name: 'Parental Care', cat: 'social', icon: '♡', max: 2, cost: 30, stage: 2, color: '#ff9ec7',
    blurb: 'You know what the young need before they do.', effect: (r) => `+${r * 12}% inheritance quality · stronger heirs` },
  { id: 'intimidation', name: 'Apex Presence', cat: 'social', icon: '☠', max: 1, cost: 42, stage: 3, color: '#ff9ec7',
    blurb: 'Something in your silhouette ends arguments.', effect: () => 'Weaker predators hesitate and flee' },
  // EXOTIC
  { id: 'venom', name: 'Venom Glands', cat: 'exotic', icon: '☠', max: 2, cost: 38, stage: 2, color: '#b58cff',
    blurb: 'A hollow fang and a patient poison.', effect: (r) => `Bites poison for ${r * 2.5}/s · Toxic Cloud` },
  { id: 'electric', name: 'Electric Organ', cat: 'exotic', icon: '⚡', max: 2, cost: 42, stage: 2, color: '#b58cff',
    blurb: 'A battery of stacked cells behind your ribs.', effect: (r) => `Unlock Static Pulse · +${r * 15}% stun damage` },
  { id: 'biolum', name: 'Bioluminescence', cat: 'exotic', icon: '✧', max: 1, cost: 30, stage: 2, color: '#b58cff',
    blurb: 'Living light, beautiful and betraying.', effect: () => 'Glow in the dark · reveal around you · charm' },
  { id: 'burrow', name: 'Burrowing', cat: 'exotic', icon: '⌄', max: 1, cost: 35, stage: 2, color: '#b58cff',
    blurb: 'Claws for earth, and the patience to wait.', effect: () => 'Unlock Burrow: hide and escape' },
  { id: 'ascendant', name: 'Ascendant Spark', cat: 'exotic', icon: '✺', max: 1, cost: 95, stage: 4, color: '#b58cff',
    blurb: 'A second heart of impossible light.', effect: () => '+10% to all stats · revive once per life' }
];

export const MODULES = [
  { id: 'nest', name: 'Brood Nest', icon: '🥚', max: 1, cost: { fiber: 10, wood: 8 },
    desc: 'A woven bowl of grass and down. Required to breed.', effect: () => 'Unlocks breeding' },
  { id: 'walls', name: 'Log Palisade', icon: '🪵', max: 3, cost: { wood: 12, stone: 8 },
    desc: 'A ring of stakes and stone that tells predators: not here.', effect: (r) => `+${r * 55} safe radius · -${r * 8}% damage near den` },
  { id: 'larder', name: 'Larder', icon: '🍖', max: 3, cost: { wood: 10, fiber: 8 },
    desc: 'Smoked meat and dried berries, kept from the weather.', effect: (r) => `Rest restores +${r * 18} food and +${r * 10} water` },
  { id: 'hatchery', name: 'Hatchery', icon: '✦', max: 2, cost: { crystal: 5, fiber: 12 },
    desc: 'Warm stones cradle the eggs. Good genes take root.', effect: (r) => `+${r * 12}% chance of inherited gene upgrades` },
  { id: 'garden', name: 'Sun Garden', icon: '🌱', max: 3, cost: { fiber: 12, wood: 6 },
    desc: 'Tended rows of berry and root. The den feeds its own.', effect: (r) => `+${(r * 0.035).toFixed(3)} food/s near den` },
  { id: 'shrine', name: 'Bone Shrine', icon: '🕯', max: 3, cost: { crystal: 6, stone: 12 },
    desc: 'A totem of old bones. Something listens.', effect: (r) => `+${r} DNA every 25 seconds near den` },
  { id: 'lookout', name: 'Lookout', icon: '🔭', max: 2, cost: { wood: 10, stone: 6 },
    desc: 'A high perch and a clear line of sight.', effect: (r) => `+${r * 260} map reveal radius` }
];

export const DEN_COST = { wood: 12, fiber: 8, stone: 6 };

export const MATERIALS = {
  wood: { name: 'Wood', icon: '🪵', color: '#c08a52' },
  stone: { name: 'Stone', icon: '🪨', color: '#a8a49a' },
  fiber: { name: 'Fiber', icon: '🌾', color: '#d8c477' },
  crystal: { name: 'Crystal', icon: '💎', color: '#b58cff' }
};

export const SPECIES = {
  grazer: {
    name: 'Mossback Grazer', role: 'prey', hp: 38, dmg: 0, speed: 88, size: 1.05, xp: 14, dna: 5, food: 28,
    detect: 300, biomes: ['meadow', 'forest', 'savannah', 'sand'], timid: true, desc: 'A placid browser with mossy antlers. Delicious, if you can catch it.',
    pheno: { len: 50, wid: 25, head: 18, legLen: 17, legs: 4, tail: 16, tailType: 'tuft', ears: 1, horns: 2, color1: '#c9a06a', color2: '#7b5a3c', color3: '#f4e7ca', eye: '#2a1b14', pattern: 'spots', patternColor: '#8a6847' }
  },
  hopper: {
    name: 'Thistle Hopper', role: 'prey', hp: 18, dmg: 0, speed: 168, size: 0.62, xp: 8, dna: 3, food: 13,
    detect: 260, biomes: ['meadow', 'savannah', 'forest', 'sand'], timid: true, desc: 'All legs and nerves. Hard to catch, easy to swallow.',
    pheno: { len: 27, wid: 17, head: 12, legLen: 19, legs: 4, tail: 6, tailType: 'puff', ears: 2, color1: '#bba77c', color2: '#776244', color3: '#eadfc8', eye: '#241a12', pattern: 'none' }
  },
  croaker: {
    name: 'Bog Croaker', role: 'prey', hp: 30, dmg: 0, speed: 74, size: 0.85, xp: 13, dna: 5, food: 20,
    detect: 220, biomes: ['swamp', 'shallow'], timid: true, desc: 'A wide-mouthed amphibian. Its song means clean water.',
    pheno: { len: 38, wid: 30, head: 22, legLen: 22, legs: 4, tail: 0, tailType: 'none', eyes: 2, color1: '#7fa85a', color2: '#476832', color3: '#d6e7a7', eye: '#f2d65b', pattern: 'spots', patternColor: '#48672f' }
  },
  ram: {
    name: 'Stonehorn Ram', role: 'prey', hp: 96, dmg: 3, speed: 94, size: 1.15, xp: 28, dna: 9, food: 42,
    detect: 300, biomes: ['highland', 'savannah'], timid: true, desc: 'A mountain of wool and horn. It will run — usually.',
    pheno: { len: 52, wid: 30, head: 20, legLen: 16, legs: 4, tail: 10, tailType: 'puff', ears: 1, horns: 2, color1: '#bab5aa', color2: '#726c61', color3: '#efe9dd', eye: '#2c241c', pattern: 'none' }
  },
  stalker: {
    name: 'Shade Stalker', role: 'predator', hp: 72, dmg: 9, speed: 136, size: 0.95, xp: 28, dna: 10, food: 24,
    detect: 430, aggro: 360, biomes: ['forest', 'swamp', 'meadow', 'savannah'], desc: 'A low, six-limbed hunter that thrives in the green dark.',
    pheno: { len: 46, wid: 22, head: 17, legLen: 15, legs: 6, tail: 26, tailType: 'whip', spikes: 4, ears: 2, color1: '#56517a', color2: '#2f2d48', color3: '#a8a0d8', eye: '#ff6a7a', pattern: 'stripes', patternColor: '#3a3558', glow: '#ff5f79' }
  },
  ravager: {
    name: 'Bone Ravager', role: 'predator', hp: 132, dmg: 14, speed: 118, size: 1.12, xp: 42, dna: 15, food: 32,
    detect: 460, aggro: 390, biomes: ['highland', 'ash', 'savannah', 'crystal'], desc: 'Armoured in the skulls of things it has already eaten.',
    pheno: { len: 54, wid: 28, head: 19, legLen: 16, legs: 4, tail: 22, tailType: 'spike', spikes: 6, horns: 2, color1: '#9a8f7d', color2: '#5b5348', color3: '#ded3bd', eye: '#ff9a4d', pattern: 'stripes', patternColor: '#6b6254', armor: 1, glow: '#ff8b3c' }
  },
  crawler: {
    name: 'Prism Crawler', role: 'predator', hp: 88, dmg: 11, speed: 128, size: 0.9, xp: 34, dna: 14, food: 22,
    detect: 440, aggro: 360, biomes: ['crystal', 'highland'], desc: 'Its facets drink moonlight and spit it back as hunger.',
    pheno: { len: 42, wid: 21, head: 15, legLen: 14, legs: 6, tail: 20, tailType: 'spike', spikes: 5, color1: '#7a62b8', color2: '#453369', color3: '#d8c4ff', eye: '#8affef', pattern: 'none', glow: '#8a6fff' }
  },
  fish: {
    name: 'Silverfin', role: 'prey', hp: 16, dmg: 0, speed: 118, size: 0.55, xp: 9, dna: 3, food: 16,
    detect: 200, biomes: ['shallow', 'deep'], timid: true, aquatic: true, desc: 'Quick silver in the shallows. Gills turn water into a pantry.',
    pheno: { len: 30, wid: 13, head: 11, legLen: 0, legs: 0, tail: 18, tailType: 'fin', fin: 1, color1: '#9fc7d2', color2: '#4f7f90', color3: '#e6f6fb', eye: '#16232c', pattern: 'stripes', patternColor: '#7ba8b6' }
  },
  golden: {
    name: 'Gilded Drifter', role: 'prey', hp: 44, dmg: 0, speed: 178, size: 0.66, xp: 65, dna: 55, food: 24,
    detect: 460, biomes: ['meadow', 'forest', 'savannah', 'crystal'], timid: true, desc: 'A rare creature of living gold. Killing one feels like a mistake, and a fortune.',
    pheno: { len: 30, wid: 17, head: 13, legLen: 16, legs: 4, tail: 8, tailType: 'puff', ears: 2, color1: '#ffd86b', color2: '#b47a22', color3: '#fff3c4', eye: '#4d2d06', pattern: 'spots', patternColor: '#e2a93e', glow: '#ffcf5a' }
  },
  alpha: {
    name: 'The Hollow King', role: 'predator', hp: 380, dmg: 21, speed: 122, size: 1.55, xp: 230, dna: 140, food: 70,
    detect: 560, aggro: 470, boss: true, biomes: ['ash', 'crystal', 'highland'], desc: 'An ancient predator with a crown of bone. The wastes belong to it.',
    pheno: { len: 68, wid: 36, head: 26, legLen: 20, legs: 6, tail: 30, tailType: 'spike', spikes: 8, horns: 3, color1: '#6e6465', color2: '#2c2729', color3: '#d6c6b4', eye: '#ff4d3d', pattern: 'stripes', patternColor: '#4b4140', armor: 1, glow: '#ff3b2f' }
  }
};

export const NAMES = [
  'Nyx', 'Pip', 'Rook', 'Moss', 'Ember', 'Fenn', 'Sable', 'Juno', 'Kite', 'Lumen',
  'Bramble', 'Cinder', 'Dune', 'Echo', 'Flint', 'Gale', 'Hazel', 'Iris', 'Jade', 'Kelp',
  'Lark', 'Mica', 'Nettle', 'Onyx', 'Pike', 'Quill', 'Reed', 'Sage', 'Thorn', 'Umber',
  'Vale', 'Wisp', 'Yarrow', 'Zephyr', 'Alder', 'Birch', 'Coral', 'Drift', 'Fern', 'Glimmer'
];

export const QUESTS = [
  { id: 'eat', title: 'First Bites', text: 'Eat three berries, mushrooms or carcasses.', goal: 3, reward: 25, xp: 12,
    progress: (g) => g.stats.eats },
  { id: 'drink', title: 'Stay Hydrated', text: 'Drink from a pond, river or the sea.', goal: 1, reward: 18, xp: 8,
    progress: (g) => g.stats.drinks },
  { id: 'mutate', title: 'Change Your Shape', text: 'Purchase your first mutation with DNA.', goal: 1, reward: 22, xp: 10,
    progress: (g) => g.stats.mutations },
  { id: 'stage2', title: 'Growing Pains', text: 'Eat and explore until you evolve into a Forager.', goal: 1, reward: 45, xp: 0,
    progress: (g) => (g.player.stage >= 2 ? 1 : 0) },
  { id: 'nestgene', title: 'A Place Of Your Own', text: 'Reach Forager, then unlock Nest Instinct (Social).', goal: 1, reward: 55, xp: 15,
    progress: (g) => ((g.player.genes.nest || 0) > 0 ? 1 : 0) },
  { id: 'den', title: 'Home Sweet Home', text: 'Gather wood, fiber and stone, then press B to found your den.', goal: 1, reward: 65, xp: 20,
    progress: (g) => (g.den ? 1 : 0) },
  { id: 'nest', title: 'Something Worth Returning To', text: 'Build a Brood Nest inside your den (press B).', goal: 1, reward: 65, xp: 25,
    progress: (g) => (g.den && g.den.modules.nest ? 1 : 0) },
  { id: 'court', title: 'A Fine Mate', text: 'Court the kindred who arrives at your nest until affinity is full.', goal: 1, reward: 50, xp: 20,
    progress: (g) => (g.mate && g.mate.affinity >= 100 ? 1 : 0) },
  { id: 'breed', title: 'Legacy', text: 'Breed an heir at your Brood Nest. Continue the line.', goal: 1, reward: 110, xp: 45,
    progress: (g) => g.stats.breeds },
  { id: 'stage4', title: 'Apex', text: 'Grow powerful enough to become an Apex predator.', goal: 1, reward: 160, xp: 0,
    progress: (g) => (g.player.stage >= 4 ? 1 : 0) },
  { id: 'stage5', title: 'Ascendant', text: 'Reach the final evolution. Become a living myth.', goal: 1, reward: 300, xp: 0,
    progress: (g) => (g.player.stage >= 5 ? 1 : 0) }
];

export const ACHIEVEMENTS = [
  { id: 'firstKill', name: 'First Blood', desc: 'Kill another creature.' },
  { id: 'gatherer', name: 'Provider', desc: 'Gather 25 materials from the world.' },
  { id: 'explorer', name: 'Wayfinder', desc: 'Discover five biomes.' },
  { id: 'den', name: 'Den Founder', desc: 'Found your first den.' },
  { id: 'parent', name: 'Lineage', desc: 'Hatch an heir.' },
  { id: 'nightOwl', name: 'Night Owl', desc: 'Survive your first full night.' },
  { id: 'alpha', name: 'Kingbreaker', desc: 'Slay The Hollow King.' },
  { id: 'golden', name: 'Gilded Fate', desc: 'Catch a Gilded Drifter.' },
  { id: 'crystals', name: 'Prism Song', desc: 'Gather crystal from Prism Hollow.' },
  { id: 'apex', name: 'Apex', desc: 'Reach the fourth evolution.' },
  { id: 'ascendant', name: 'Ascendant', desc: 'Reach the final evolution.' }
];

// Combat / survival numbers derived from the genome.
export function deriveStats(genes, stage, lineage = 0) {
  const r = (id) => genes[id] || 0;
  const lin = 1 + Math.min(0.4, lineage);
  const size = STAGES[stage - 1].scale * (1 + r('might') * 0.12);
  const maxHp = Math.round((92 + (stage - 1) * 38 + r('vigor') * 18 + r('might') * 14 + r('hide') * 8) * lin);
  const speed = Math.round((136 + (stage - 1) * 7 + r('swift') * 12 + r('wings') * 8 - r('might') * 7 - r('carapace') * 2) * (1 + Math.min(0.2, lineage * 0.5)));
  const damage = (9 + (stage - 1) * 3.5 + r('claws') * 3 + r('might') * 3 + r('ascendant') * 4) * lin;
  const armor = Math.min(0.55, r('carapace') * 0.09 + (stage - 1) * 0.012 + r('ascendant') * 0.03);
  const vision = 560 + r('eyes') * 70 + r('echo') * 90 + r('biolum') * 40 + (stage - 1) * 22;
  const regen = r('regen') * 0.35 + r('ascendant') * 0.2;
  const foodValue = 1 + r('digestion') * 0.18;
  const thirstRate = 1 - r('watersacs') * 0.17;
  const photo = r('photo') * 0.06;
  const spikes = r('spikes') * 0.2;
  const detectMod = 1 - r('camouflage') * 0.28;
  const attackRange = 46 + size * 12;
  const ability = r('electric') ? 'pulse' : r('venom') ? 'cloud' : r('burrow') ? 'burrow' : r('wings') ? 'dash' : 'roar';
  return {
    maxHp, speed, damage, armor, vision, regen, foodValue, thirstRate, photo, spikes, detectMod,
    attackRange, size, ability,
    venom: r('venom') * 2.5,
    electric: r('electric'),
    lineage: lin
  };
}
