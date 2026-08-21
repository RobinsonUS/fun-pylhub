// ============ monde ============
const MONDE = 3200;
const CELL  = 50;

// ============ vision ============
// Resolution de jeu fixe : le canvas fait toujours cette taille en unites
// monde, quel que soit l'ecran. Le champ de vision est donc identique
// partout, ce qui est indispensable pour entrainer l'IA.
const LARG_JEU = 1580;
const HAUT_JEU = 1100;
let VUE_L = LARG_JEU;
let VUE_H = HAUT_JEU;

// ============ joueur ============
const R_JOUEUR = CELL * 0.60;
const VITESSE   = 320;
const PV_MAX    = 100;
// encombrement visuel du personnage, arme comprise
const R_SPRITE = R_JOUEUR * 3.2;

// ============ arme ============
const CANON_L     = R_JOUEUR * 3.05;
const DEGATS      = 16;
const CADENCE     = 0.12;
const V_BALLE     = 1500;
const DISPERSION  = 0.10;
const PORTEE      = 800;
const FONDU_BALLE = 120;
const R_BALLE     = R_JOUEUR * 0.17;
const L_BALLE     = R_JOUEUR * 0.26;

// ============ decor ============
const N_ARBRES   = 26;
const N_BUISSONS = 32;
const R_ARBRE    = CELL * 1.75;
const R_BUISSON  = CELL * 1.5;
const PV_ARBRE   = 100;

// ============ zone ============
const ZONE_R0      = 1900;
const ZONE_R1      = 320;
const ZONE_ATTENTE = 12;
const ZONE_DUREE   = 70;
const ZONE_DEGATS  = 6;

// ============ simulation ============
const DT        = 1 / 60;
const DUREE_MAX = 120;

// ============ inventaire ============
const NB_SLOTS = 6;

// ============ couleurs ============
const C = {
  sol:         '#6d8f4e',
  ligne:       '#5f8145',
  dehors:      '#4a6635',
  ligneDehors: '#425c2e',
  ombre:       'rgba(0,0,0,0.13)',
  buisson: {
    trait: '#3f4a35',
    ext:   '#74ab52',
    int:   '#8cc069',
    tache: '#74ab52',
  },
  traitArbre: '#33383a',
  souche:     'rgba(40,52,32,0.13)',
  aura:       'rgba(230,60,50,0.45)',
  invPlein:   '#d7d9cf',
  invBord:    'rgba(255,255,255,0.55)',
  invNumFond: 'rgba(20,30,15,0.22)',
  invNumBord: 'rgba(255,255,255,0.55)',
  poing:      '#f5a94e',
  poingOmb:   '#d98c33',
  eclat:      '#9aa094',
  eclatOmb:   '#6f7569',
  arbres: [
    { ext: '#3f9e6e', int: '#7fd18f', tache: '#5cb87d' },
    { ext: '#96602f', int: '#cf9530', tache: '#8a5a2e' },
    { ext: '#8e2647', int: '#a83a5c', tache: '#75203c' },
    { ext: '#1f6b4a', int: '#2d8a5f', tache: '#18543a' },
  ],
  perso:    '#f0cd8f',
  persoEnn: '#e9a273',
  main:     '#e0b273',
  bras:     '#c8985c',
  traitP:   '#2b2b2b',
  armeOr:    '#f0922f',
  armeBleu:  '#2f4f80',
  armeMauve: '#9a9ade',
  canon:     '#3a3a3a',
  balle:    '#6a6a6a',
  traitB:   '#242424',
  pvVert:      '#8cc152',
  pvVertVide:  'rgba(140,193,82,0.32)',
  pvRouge:     '#d9534f',
  pvRougeVide: 'rgba(217,83,79,0.32)',
  pvTrait:     'rgba(45,45,45,0.5)',
  zone:     'rgba(120,175,255,0.85)',
  horsZone: 'rgba(70,130,255,0.30)',
};