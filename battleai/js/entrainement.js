// ============================================================
//  js/entrainement.js
//
//  Adam, boucle PPO, vivier d'adversaires, sauvegarde des poids.
//  Aucun acces au DOM : ce fichier tourne tel quel sous Node.
// ============================================================

const BETA1       = 0.9;
const BETA2       = 0.999;
const EPS_ADAM    = 1e-8;
const EPOQUES     = 4;      // passages sur une meme fournee
const LR   = 1e-4;      // trois fois plus prudent
const LOT  = 16;        // plus de segments par pas : gradient moins bruite
const NORME_MAX   = 0.5;    // ecretage du gradient global
const KL_STOP    = 0.03;
const VIVIER_MAX  = 10;
const PERIODE_VIVIER = 5;   // fournees entre deux archivages

const CLES = ['dense', 'wz', 'uz', 'wr', 'ur', 'wh', 'uh',
              'tMouv', 'tVisee', 'tTir', 'tRech', 'tVal'];

// ---------- Adam ----------
function creeAdam(c) {
  const e = { t: 0 };
  for (const k of CLES) {
    e[k] = {
      mw: new Float32Array(c[k].w.length), vw: new Float32Array(c[k].w.length),
      mb: new Float32Array(c[k].b.length), vb: new Float32Array(c[k].b.length),
    };
  }
  return e;
}

// norme globale du gradient, pour l'ecretage
function normeGradient(g) {
  let s = 0;
  for (const k of CLES) {
    const gw = g[k].w, gb = g[k].b;
    for (let i = 0; i < gw.length; i++) s += gw[i] * gw[i];
    for (let i = 0; i < gb.length; i++) s += gb[i] * gb[i];
  }
  return Math.sqrt(s);
}

function appliqueAdam(c, g, etat, echelle) {
  etat.t++;
  const cb1 = 1 - Math.pow(BETA1, etat.t);
  const cb2 = 1 - Math.pow(BETA2, etat.t);

  for (const k of CLES) {
    const m = c[k], gm = g[k], e = etat[k];

    for (let i = 0; i < m.w.length; i++) {
      const gr = gm.w[i] * echelle;
      e.mw[i] = BETA1 * e.mw[i] + (1 - BETA1) * gr;
      e.vw[i] = BETA2 * e.vw[i] + (1 - BETA2) * gr * gr;
      m.w[i] -= LR * (e.mw[i] / cb1) / (Math.sqrt(e.vw[i] / cb2) + EPS_ADAM);
    }
    for (let i = 0; i < m.b.length; i++) {
      const gr = gm.b[i] * echelle;
      e.mb[i] = BETA1 * e.mb[i] + (1 - BETA1) * gr;
      e.vb[i] = BETA2 * e.vb[i] + (1 - BETA2) * gr * gr;
      m.b[i] -= LR * (e.mb[i] / cb1) / (Math.sqrt(e.vb[i] / cb2) + EPS_ADAM);
    }
  }
}

// ---------- une fournee : collecte puis apprentissage ----------
function uneFournee(c, adam, vivier, rng) {
  const t0 = maintenantMs();
  const segments = collecteFournee(c, vivier, rng);
  const tCollecte = maintenantMs() - t0;

  const st = statistiques(segments);
  const g = creeGradients(c);

  let perte = 0, ent = 0, kl = 0, clip = 0, nMaj = 0, arret = false;

  for (let ep = 0; ep < EPOQUES && !arret; ep++) {
    // ordre remelange a chaque epoque
    const ordre = segments.map((_, i) => i);
    for (let i = ordre.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      [ordre[i], ordre[j]] = [ordre[j], ordre[i]];
    }

    for (let d = 0; d < ordre.length; d += LOT) {
      videGradients(g);
      let nSeg = 0, klLot = 0;

      for (let q = d; q < Math.min(d + LOT, ordre.length); q++) {
        const r = retropropageSegment(c, g, segments[ordre[q]]);
        perte += r.perte; ent += r.entropie; clip += r.clipes;
        klLot += r.kl; nSeg++;
      }
      if (nSeg === 0) continue;

      klLot /= nSeg;
      kl += klLot; nMaj++;

      // la divergence est trop grande : la politique a trop bouge
      if (Math.abs(klLot) > KL_STOP) { arret = true; break; }

      const n = normeGradient(g);
      const ech = (n > NORME_MAX ? NORME_MAX / n : 1) / nSeg;
      appliqueAdam(c, g, adam, ech);
    }
  }

  return {
    decisions: st.decisions,
    recompense: st.recompenseMoyenne,
    valeur: st.valeurMoyenne,
    perte: nMaj ? perte / (nMaj * LOT) : 0,
    entropie: nMaj ? ent / (nMaj * LOT) : 0,
    kl: nMaj ? kl / nMaj : 0,
    clipes: nMaj ? clip / (nMaj * LOT) : 0,
    arretKL: arret,
    tCollecte: tCollecte / 1000,
    tTotal: (maintenantMs() - t0) / 1000,
  };
}

function maintenantMs() {
  return (typeof performance !== 'undefined') ? performance.now() : Date.now();
}

// ---------- copie profonde, pour le vivier ----------
function copieCerveau(c) {
  const d = { nE: c.nE, tmp: c.tmp };   // les tampons sont reutilisables
  for (const k of CLES) {
    d[k] = { w: Float32Array.from(c[k].w), b: Float32Array.from(c[k].b),
             nIn: c[k].nIn, nOut: c[k].nOut };
  }
  return d;
}

function importeCerveau(_meta, plat) {
  const c = creeCerveau(1);
  let o = 0;
  for (const k of CLES) {
    c[k].w.set(plat.subarray(o, o + c[k].w.length)); o += c[k].w.length;
    c[k].b.set(plat.subarray(o, o + c[k].b.length)); o += c[k].b.length;
  }
  return c;
}

// ---------- serialisation ----------
function exporteCerveau(c) {
  let total = 0;
  const meta = [];
  for (const k of CLES) {
    meta.push({ nom: k, nIn: c[k].nIn, nOut: c[k].nOut, offset: total });
    total += c[k].w.length + c[k].b.length;
  }
  const plat = new Float32Array(total);
  let o = 0;
  for (const k of CLES) {
    plat.set(c[k].w, o); o += c[k].w.length;
    plat.set(c[k].b, o); o += c[k].b.length;
  }
  return { meta: { total, nE: c.nE, cache: N_CACHE, couches: meta }, poids: plat };
}

function importeCerveau(meta, plat) {
  const c = creeCerveau(1);
  let o = 0;
  for (const k of CLES) {
    c[k].w.set(plat.subarray(o, o + c[k].w.length)); o += c[k].w.length;
    c[k].b.set(plat.subarray(o, o + c[k].b.length)); o += c[k].b.length;
  }
  return c;
}

// ---------- la boucle ----------
function creeEntrainement(graine) {
  const c = creeCerveau(graine);
  return {
    c, adam: creeAdam(c), vivier: [], rng: creeRng((graine || 1) * 7919),
    fournee: 0, journal: [],
  };
}

function pasEntrainement(E) {
  const r = uneFournee(E.c, E.adam, E.vivier, E.rng);
  E.fournee++;

  if (E.fournee % PERIODE_VIVIER === 0) {
    E.vivier.push(copieCerveau(E.c));
    if (E.vivier.length > VIVIER_MAX) E.vivier.shift();
  }

  r.fournee = E.fournee;
  E.journal.push(r);
  if (E.journal.length > 200) E.journal.shift();
  return r;
}
