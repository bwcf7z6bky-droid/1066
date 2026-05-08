// Browser-side faction data — mirrors server/factions.js
window.FACTIONS = {
  english: {
    name: 'The English',
    leader: 'Harold Godwinson',
    era: 'A.D. 1066',
    sigil: '⚔',
    primary: '#cf3b3b',
    accent: '#f0d590',
    silhouette: '#1c1815',
    flavor: 'Stalwart sons of the soil. The shield wall holds where lesser men break.'
  },
  norman: {
    name: 'The Normans',
    leader: 'Duke William',
    era: 'A.D. 1066',
    sigil: '♞',
    primary: '#7a1a1a',
    accent: '#e8c46a',
    silhouette: '#0f0c0a',
    flavor: 'Mounted lords from across the narrow sea. The cavalry charge is theirs.'
  },
  roman: {
    name: 'The Romans',
    leader: 'Magnus Caesar',
    era: 'A.U.C.',
    sigil: 'SPQR',
    primary: '#a8201a',
    accent: '#d4af37',
    silhouette: '#1a1410',
    flavor: 'Discipline forged in iron. The legion advances as one.'
  },
  persian: {
    name: 'The Persians',
    leader: 'Shahanshah Darius',
    era: 'Achaemenid',
    sigil: '☀',
    primary: '#3d6a8c',
    accent: '#e6b85c',
    silhouette: '#101820',
    flavor: 'Immortal guard and a thousand bows. The empire of empires.'
  },
  celt: {
    name: 'The Celts',
    leader: 'Vercingetorix',
    era: 'Iron Tribes',
    sigil: '⚯',
    primary: '#3d6b3d',
    accent: '#d4a85c',
    silhouette: '#0f1a0f',
    flavor: 'Warriors painted in woad. The wild charge knows no fear.'
  },
  mongol: {
    name: 'The Mongols',
    leader: 'Temüjin',
    era: 'Eternal Sky',
    sigil: '✦',
    primary: '#8b6914',
    accent: '#e8d04a',
    silhouette: '#1a1308',
    flavor: 'Riders of the steppe. Their arrows blot out the sun.'
  }
};

window.COLS = 12;
window.ROWS = 8;
window.TERRAIN = [
  '............',
  '...f.....h..',
  '............',
  '..hh......f.',
  '..r.......r.',
  '...........h',
  '...f....f...',
  '............'
];
