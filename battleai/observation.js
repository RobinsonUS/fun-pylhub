// ============================================================
//  Ce que l'agent percoit.
//  Aucune dependance au canvas : la meme fonction sert a
//  l'entrainement sans affichage.
//
//  Principe directeur : l'agent recoit exactement ce qu'un
//  joueur humain lit sur son ecran, ni plus ni moins.
// ============================================================

// --- carte de l'ecran ---
const GRILLE_X = 18, GRILLE_Y = 12;
const N_CANAUX = 3;                 // arbre, buisson, hors monde

// --- rayons courts, uniquement pour se faufiler entre les troncs ---
const N_RAYONS     = 16;
const PORTEE_RAYON = 300;

const PORTEE_VUE    = Math.hypot(VUE_L, VUE_H) / 2;
const N_BALLES_VUES = 5;
const OUBLI         = 6;            // secondes au dela desquelles on oublie

// ============================================================
//  memoire : entretenue hors du reseau, remise a zero a chaque partie
// ============================================================
function creeMemoire() {
  return { connu: false, x: 0, y: 0, vx: 0, vy: 0, depuis: OUBLI };
}

function majMemoire(mem, ennemi, visible) {
  if (visible) {
    mem.connu = true;
    mem.x = ennemi.x; mem.y = ennemi.y;
    mem.vx = ennemi.vx; mem.vy = ennemi.vy;
    mem.depuis = 0;
  } else {
    // strictement la derniere position vue, aucune extrapolation
    mem.depuis = Math.min(OUBLI, mem.depuis + DT);
  }
}

// ============================================================
//  outils geometriques
// ============================================================
function toucheCercle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx, fy = oy - cy;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  const t1 = (-b - s) / 2, t2 = (-b + s) / 2;
  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return -1;
}

// distance au tronc le plus proche dans cette direction
function lanceRayon(x, y, ang, obs) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let d = PORTEE_RAYON;
  for (const o of obs) {
    if (o.type !== 'arbre') continue;
    const t = toucheCercle(x, y, dx, dy, o.x, o.y, o.r);
    if (t >= 0 && t < d) d = t;
  }
  const bord = (v, k) => (Math.abs(k) > 1e-6 ? v / k : Infinity);
  for (const t of [bord(-x, dx), bord(MONDE - x, dx),
                   bord(-y, dy), bord(MONDE - y, dy)]) {
    if (t > 0 && t < d) d = t;
  }
  return d;
}

// Carte de l'ecran. On parcourt les obstacles, pas les cases :
// indispensable quand il faudra des millions de parties.
function grilleEcran(a, obs) {
  const n = GRILLE_X * GRILLE_Y;
  const g = new Float32Array(n * N_CANAUX);
  const cw = VUE_L / GRILLE_X, ch = VUE_H / GRILLE_Y;
  const x0 = a.x - VUE_L / 2, y0 = a.y - VUE_H / 2;
  const demi = Math.min(cw, ch) * 0.5;

  for (const o of obs) {
    if (o.type === 'souche') continue;
    const canal = (o.type === 'arbre') ? 0 : 1;
    const i0 = Math.max(0, Math.floor((o.x - o.r - x0) / cw));
    const i1 = Math.min(GRILLE_X - 1, Math.floor((o.x + o.r - x0) / cw));
    const j0 = Math.max(0, Math.floor((o.y - o.r - y0) / ch));
    const j1 = Math.min(GRILLE_Y - 1, Math.floor((o.y + o.r - y0) / ch));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const cx = x0 + (i + 0.5) * cw, cy = y0 + (j + 0.5) * ch;
        const d = Math.hypot(o.x - cx, o.y - cy);
        const v = Math.max(0, Math.min(1, (o.r - d) / demi + 0.5));
        const k = (j * GRILLE_X + i) * N_CANAUX + canal;
        if (v > g[k]) g[k] = v;
      }
    }
  }

  for (let j = 0; j < GRILLE_Y; j++) {
    for (let i = 0; i < GRILLE_X; i++) {
      const cx = x0 + (i + 0.5) * cw, cy = y0 + (j + 0.5) * ch;
      if (cx < 0 || cx > MONDE || cy < 0 || cy > MONDE)
        g[(j * GRILLE_X + i) * N_CANAUX + 2] = 1;
    }
  }
  return g;
}

// le buisson qui camoufle ce point
function buissonCachantObs(x, y, obs) {
  for (const o of obs) {
    if (o.type !== 'buisson') continue;
    if (Math.hypot(o.x - x, o.y - y) < o.r * 0.75) return o;
  }
  return null;
}

// le couvert le plus proche, camouflant ou non
function buissonProche(x, y, obs) {
  let meilleur = null, dmin = Infinity;
  for (const o of obs) {
    if (o.type !== 'buisson') continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < dmin) { dmin = d; meilleur = o; }
  }
  return { o: meilleur, d: dmin };
}

// ============================================================
//  observe(partie, i, memoire) -> { v, detail }
// ============================================================
function observe(p, i, mem) {
  const a = p.agents[i];
  const e = p.agents[1 - i];
  const obs = p.obs;

  const visible = e.vivant && voit(a, e, obs);
  majMemoire(mem, e, visible);

  const cache = buissonCachantObs(a.x, a.y, obs);
  const bp    = buissonProche(a.x, a.y, obs);

  const rayons = [];
  for (let k = 0; k < N_RAYONS; k++) {
    const ang = a.angle + (k / N_RAYONS) * Math.PI * 2;
    rayons.push({ ang, arbre: lanceRayon(a.x, a.y, ang, obs) });
  }

  const grille = grilleEcran(a, obs);

  const menaces = p.balles
    .filter(b => b.par !== i)
    .map(b => ({ b, d: Math.hypot(b.x - a.x, b.y - a.y) }))
    .sort((u, w) => u.d - w.d)
    .slice(0, N_BALLES_VUES);

  const dz = Math.hypot(a.x - p.zone.x, a.y - p.zone.y);
  const horsZone = dz > p.zone.r;

  const v = [];
  const norme = (x, m) => Math.max(-1, Math.min(1, x / m));

  // ---------- A. soi (12) ----------
  v.push(a.pv / PV_MAX);
  v.push(a.munitions / 30);
  v.push(a.rechargement > 0 ? a.rechargement / 1.4 : 0);
  v.push(a.recharge > 0 ? Math.min(1, a.recharge / CADENCE) : 0);
  v.push(norme(a.vx, VITESSE), norme(a.vy, VITESSE));
  v.push(Math.cos(a.angle), Math.sin(a.angle));
  v.push(cache ? 1 : 0);
  v.push(a.tirTimer > 0 ? 1 : 0);
  v.push(a.touche > 0 ? 1 : 0);
  v.push(a.inv[a.slot] ? 1 : 0);

  // ---------- B. position et bords (6) ----------
  v.push(a.x / MONDE, a.y / MONDE);
  v.push(Math.min(1, a.x / PORTEE_VUE), Math.min(1, (MONDE - a.x) / PORTEE_VUE));
  v.push(Math.min(1, a.y / PORTEE_VUE), Math.min(1, (MONDE - a.y) / PORTEE_VUE));

  // ---------- C. couvert (4) ----------
  if (bp.o) {
    v.push(norme(bp.o.x - a.x, PORTEE_VUE), norme(bp.o.y - a.y, PORTEE_VUE));
    v.push(Math.min(1, bp.d / PORTEE_VUE));
  } else { v.push(0, 0, 1); }
  // marge avant de perdre le camouflage, negative si a decouvert
  v.push(cache
    ? norme(cache.r * 0.75 - Math.hypot(cache.x - a.x, cache.y - a.y), R_BUISSON)
    : -1);

  // ---------- D. zone (6) ----------
  v.push(norme(p.zone.x - a.x, PORTEE_VUE), norme(p.zone.y - a.y, PORTEE_VUE));
  v.push(norme(p.zone.r - dz, PORTEE_VUE));
  v.push(horsZone ? 1 : 0);
  v.push(Math.min(1, p.zone.r / ZONE_R0));
  v.push(Math.max(0, Math.min(1, (p.t - ZONE_ATTENTE) / ZONE_DUREE)));

  // ---------- E. adversaire (18) ----------
  v.push(visible ? 1 : 0);
  v.push(mem.connu ? 1 - mem.depuis / OUBLI : 0);
  if (mem.connu) {
    const rx = mem.x - a.x, ry = mem.y - a.y;
    const d = Math.hypot(rx, ry) || 1;
    v.push(norme(rx, PORTEE_VUE), norme(ry, PORTEE_VUE));
    v.push(Math.min(1, d / PORTEE_VUE));
    v.push(rx / d, ry / d);
    v.push(norme(mem.vx, VITESSE), norme(mem.vy, VITESSE));
    const dAng = Math.atan2(ry, rx) - a.angle;
    v.push(Math.cos(dAng), Math.sin(dAng));
    v.push(bloqueVue(a.x, a.y, mem.x, mem.y, obs) ? 0 : 1);
  } else {
    v.push(0, 0, 1, 0, 0, 0, 0, 1, 0, 0);
  }
  v.push(visible ? e.pv / PV_MAX : 0);
  v.push(visible && e.revele > 0 ? 1 : 0);
  v.push(visible && e.rechargement > 0 ? 1 : 0);
  v.push(visible && buissonCachantObs(e.x, e.y, obs) ? 1 : 0);
  if (visible) {
    const rel = e.angle - a.angle;
    v.push(Math.cos(rel), Math.sin(rel));
  } else { v.push(0, 0); }

  // ---------- F. carte de l'ecran ----------
  for (let k = 0; k < grille.length; k++) v.push(grille[k]);

  // ---------- G. rayons courts ----------
  for (const r of rayons) v.push(r.arbre / PORTEE_RAYON);

  // ---------- H. balles ennemies ----------
  for (let k = 0; k < N_BALLES_VUES; k++) {
    const m = menaces[k];
    if (!m) { v.push(0, 0, 0, 0, 0); continue; }
    v.push(1);
    v.push(norme(m.b.x - a.x, PORTEE_VUE), norme(m.b.y - a.y, PORTEE_VUE));
    v.push(norme(m.b.vx, V_BALLE), norme(m.b.vy, V_BALLE));
  }

  return {
    v: Float32Array.from(v),
    detail: { visible, cache, bp, rayons, grille, menaces, mem, horsZone },
  };
}

function tailleObservation() {
  return 12 + 6 + 4 + 6 + 18
       + GRILLE_X * GRILLE_Y * N_CANAUX
       + N_RAYONS
       + N_BALLES_VUES * 5;
}