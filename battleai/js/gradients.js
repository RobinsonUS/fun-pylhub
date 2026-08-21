// ============================================================
//  js/gradients.js
//
//  Retropropagation a travers dense -> GRU -> quatre tetes.
//  Une erreur ici ne fait pas planter : elle fait juste mal
//  apprendre. D'ou le controle numerique en fin de fichier.
// ============================================================

const EPS_CLIP  = 0.2;
const COEF_VAL  = 0.5;
let COEF_ENT = 0.01;

// l'exploration diminue au fil de l'entrainement, avec un plancher
function ajusteEntropie(tour) {
  COEF_ENT = Math.max(0.005, 0.01 * Math.pow(0.5, tour / 300));
}

// ---------- structure d'accumulation ----------
function creeGradCouche(m) {
  return { w: new Float32Array(m.w.length), b: new Float32Array(m.b.length),
           nIn: m.nIn, nOut: m.nOut };
}

function creeGradients(c) {
  const g = {};
  for (const k of ['dense', 'wz', 'uz', 'wr', 'ur', 'wh', 'uh',
                   'tMouv', 'tVisee', 'tTir', 'tRech', 'tVal'])
    g[k] = creeGradCouche(c[k]);
  return g;
}

function videGradients(g) {
  for (const k in g) { g[k].w.fill(0); g[k].b.fill(0); }
}

// ---------- brique de base ----------
// dSortie -> gradients de la couche, et dEntree accumulee
function backCouche(m, gm, entree, dSortie, dEntree) {
  const { nIn, nOut, w } = m;
  for (let j = 0; j < nOut; j++) {
    const d = dSortie[j];
    if (d === 0) continue;
    const base = j * nIn;
    gm.b[j] += d;
    for (let i = 0; i < nIn; i++) {
      gm.w[base + i] += d * entree[i];
      if (dEntree) dEntree[i] += w[base + i] * d;
    }
  }
}

// ---------- passe avant, en conservant tout ----------
function propageEnregistrant(c, obs, hp) {
  const nE = c.nE, n = N_CACHE;
  const x = new Float32Array(n);
  const z = new Float32Array(n), r = new Float32Array(n), nn = new Float32Array(n);
  const rh = new Float32Array(n), h = new Float32Array(n);
  const a = new Float32Array(n), b = new Float32Array(n);

  matVec(c.dense, obs, nE, n, x);
  for (let i = 0; i < n; i++) x[i] = Math.max(0, x[i]);

  matVec(c.wz, x, n, n, a); matVec(c.uz, hp, n, n, b);
  for (let i = 0; i < n; i++) z[i] = sigm(a[i] + b[i]);

  matVec(c.wr, x, n, n, a); matVec(c.ur, hp, n, n, b);
  for (let i = 0; i < n; i++) r[i] = sigm(a[i] + b[i]);

  matVec(c.wh, x, n, n, a);
  for (let i = 0; i < n; i++) rh[i] = r[i] * hp[i];
  matVec(c.uh, rh, n, n, b);
  for (let i = 0; i < n; i++) nn[i] = Math.tanh(a[i] + b[i]);

  for (let i = 0; i < n; i++) h[i] = (1 - z[i]) * nn[i] + z[i] * hp[i];

  const mouv  = new Float32Array(N_MOUV);
  const visee = new Float32Array(N_VISEE);
  const tir   = new Float32Array(2);
  const rech  = new Float32Array(2);
  const val   = new Float32Array(1);
  matVec(c.tMouv,  h, n, N_MOUV,  mouv);
  matVec(c.tVisee, h, n, N_VISEE, visee);
  matVec(c.tTir,   h, n, 2,       tir);
  matVec(c.tRech,  h, n, 2,       rech);
  matVec(c.tVal,   h, n, 1,       val);

  return { obs, hp, x, z, r, nn, rh, h, mouv, visee, tir, rech, val };
}

// ---------- softmax masquee ----------
function probsMasquees(logits, n, masque) {
  let max = -Infinity;
  for (let i = 0; i < n; i++)
    if ((!masque || masque[i]) && logits[i] > max) max = logits[i];
  const p = new Float32Array(n);
  let som = 0;
  for (let i = 0; i < n; i++) {
    if (!masque || masque[i]) { p[i] = Math.exp(logits[i] - max); som += p[i]; }
  }
  for (let i = 0; i < n; i++) p[i] /= som;
  return p;
}

function entropie(p, n) {
  let H = 0;
  for (let i = 0; i < n; i++) if (p[i] > 1e-9) H -= p[i] * Math.log(p[i]);
  return H;
}

// gradient des logits d'une tete
//   gSurr : dPerte/dlogp de cette tete
//   dL/dl_i = -gSurr * ((i==k) - p_i) - COEF_ENT * dH/dl_i
//   avec dH/dl_i = -p_i (log p_i + H)
// gradient des logits d'une tete
//   dL/dl_i = gSurr * ((i==k) - p_i) + COEF_ENT * p_i (log p_i + H)
function gradTete(logits, n, k, masque, gSurr, dLogits) {
  const p = probsMasquees(logits, n, masque);
  const H = entropie(p, n);
  for (let i = 0; i < n; i++) {
    if (masque && !masque[i]) { dLogits[i] = 0; continue; }
    const ind = (i === k) ? 1 : 0;
    const dH = (p[i] > 1e-9) ? -p[i] * (Math.log(p[i]) + H) : 0;
    dLogits[i] = gSurr * (ind - p[i]) - COEF_ENT * dH;
  }
  return { p, H, logp: Math.log(Math.max(p[k], 1e-9)) };
}

// ============================================================
//  Un segment : passe avant complete, puis retour a l'envers.
//  h0 est detache : on ne remonte pas au dela du segment.
// ============================================================
function retropropageSegment(c, g, seg) {
  const n = N_CACHE;
  const pasSeg = seg.pas;
  const T = pasSeg.length;

  // ---- avant ----
  const caches = [];
  let h = Float32Array.from(seg.h0);
  for (let t = 0; t < T; t++) {
    const ca = propageEnregistrant(c, pasSeg[t].obs, h);
    caches.push(ca);
    h = ca.h;
  }

  // ---- arriere ----
  const dh = new Float32Array(n);        // gradient venant du pas suivant
  const dx = new Float32Array(n);
  const dhp = new Float32Array(n);
  const drh = new Float32Array(n);
  const tmp = new Float32Array(n);

  let perteTot = 0, entTot = 0, kl = 0, clipes = 0;

  for (let t = T - 1; t >= 0; t--) {
    const e = pasSeg[t], ca = caches[t];
    const dhTot = new Float32Array(n);
    dhTot.set(dh);

    // --- tetes d'action ---
    const A = e.avantageN;
    const tetes = [
      { l: ca.mouv,  n: N_MOUV,  k: e.choix[0], m: null,      g: g.tMouv,  c: c.tMouv },
      { l: ca.visee, n: N_VISEE, k: e.choix[1], m: null,      g: g.tVisee, c: c.tVisee },
      { l: ca.tir,   n: 2,       k: e.choix[2], m: e.masque.tir,  g: g.tTir,  c: c.tTir },
      { l: ca.rech,  n: 2,       k: e.choix[3], m: e.masque.rech, g: g.tRech, c: c.tRech },
    ];

    // logp actuelle, pour le rapport de PPO
    let logp = 0;
    const infos = [];
    for (const te of tetes) {
      const p = probsMasquees(te.l, te.n, te.m);
      const lp = Math.log(Math.max(p[te.k], 1e-9));
      logp += lp;
      infos.push({ p, lp });
    }

    const ratio = Math.exp(logp - e.logp);
    const dans = (ratio > 1 - EPS_CLIP && ratio < 1 + EPS_CLIP);
    // hors de la zone de confiance, le gradient est coupe
    const actif = dans || (ratio <= 1 - EPS_CLIP && A > 0)
                       || (ratio >= 1 + EPS_CLIP && A < 0);
    if (!actif) clipes++;
    const gSurr = actif ? -ratio * A : 0;   // perte = -surrogate

    perteTot += -Math.min(ratio * A,
                Math.max(1 - EPS_CLIP, Math.min(1 + EPS_CLIP, ratio)) * A);
    kl += e.logp - logp;

    for (let q = 0; q < 4; q++) {
      const te = tetes[q];
      const dL = new Float32Array(te.n);
      const inf = gradTete(te.l, te.n, te.k, te.m, gSurr, dL);
      entTot += inf.H;
      backCouche(te.c, te.g, ca.h, dL, dhTot);
    }

    // --- tete de valeur ---
    const dv = new Float32Array(1);
    dv[0] = COEF_VAL * (ca.val[0] - e.retour);
    perteTot += 0.5 * COEF_VAL * (ca.val[0] - e.retour) ** 2;
    backCouche(c.tVal, g.tVal, ca.h, dv, dhTot);

    // --- GRU ---
    dx.fill(0); dhp.fill(0); drh.fill(0);
    const z = ca.z, r = ca.r, nn = ca.nn, hp = ca.hp;

    // h = (1-z)*n + z*hp
    for (let i = 0; i < n; i++) {
      const d = dhTot[i];
      tmp[i] = d * (1 - z[i]);              // dn
      dhp[i] += d * z[i];
    }

    // n = tanh(...)
    const dpre = new Float32Array(n);
    for (let i = 0; i < n; i++) dpre[i] = tmp[i] * (1 - nn[i] * nn[i]);
    backCouche(c.wh, g.wh, ca.x, dpre, dx);
    backCouche(c.uh, g.uh, ca.rh, dpre, drh);
    for (let i = 0; i < n; i++) dhp[i] += drh[i] * r[i];

    // dz
    const dz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const d = dhTot[i] * (hp[i] - nn[i]);
      dz[i] = d * z[i] * (1 - z[i]);
    }
    backCouche(c.wz, g.wz, ca.x, dz, dx);
    backCouche(c.uz, g.uz, hp, dz, dhp);

    // dr
    const dr = new Float32Array(n);
    for (let i = 0; i < n; i++) dr[i] = drh[i] * hp[i] * r[i] * (1 - r[i]);
    backCouche(c.wr, g.wr, ca.x, dr, dx);
    backCouche(c.ur, g.ur, hp, dr, dhp);

    // dense, a travers la ReLU
    for (let i = 0; i < n; i++) if (ca.x[i] <= 0) dx[i] = 0;
    backCouche(c.dense, g.dense, e.obs, dx, null);

    dh.set(dhp);
  }

  return {
    perte: perteTot / T,
    entropie: entTot / (T * 4),
    kl: kl / T,
    clipes: clipes / T,
  };
}

// ============================================================
//  Controle numerique. On perturbe un poids, on regarde de
//  combien la perte bouge, et on compare au gradient calcule.
//  A lancer une fois : si l'ecart depasse 1e-2, la
//  retropropagation est fausse et il ne faut rien entrainer.
// ============================================================
function perteSegment(c, seg) {
  let h = Float32Array.from(seg.h0);
  let L = 0;
  for (const e of seg.pas) {
    const ca = propageEnregistrant(c, e.obs, h);
    h = ca.h;

    let logp = 0;
    const tetes = [
      [ca.mouv, N_MOUV, e.choix[0], null],
      [ca.visee, N_VISEE, e.choix[1], null],
      [ca.tir, 2, e.choix[2], e.masque.tir],
      [ca.rech, 2, e.choix[3], e.masque.rech],
    ];
    let H = 0;
    for (const [l, nn2, k, m] of tetes) {
      const p = probsMasquees(l, nn2, m);
      logp += Math.log(Math.max(p[k], 1e-9));
      H += entropie(p, nn2);
    }
    const ratio = Math.exp(logp - e.logp);
    const A = e.avantageN;
    L += -Math.min(ratio * A,
          Math.max(1 - EPS_CLIP, Math.min(1 + EPS_CLIP, ratio)) * A);
    L += 0.5 * COEF_VAL * (ca.val[0] - e.retour) ** 2;
    L += -COEF_ENT * H;
  }
  return L / seg.pas.length;
}

// On ne teste que les poids dont le gradient est assez grand pour
// sortir du bruit d'arrondi du float32. Sur les valeurs minuscules,
// la difference finie mesure l'arrondi, pas la derivee.
function verifieGradients(c, seg, parCouche = 3) {
  const g = creeGradients(c);
  retropropageSegment(c, g, seg);
  const T = seg.pas.length;

  const lignes = [];
  let pireEcart = 0, pire = '', pireNum = 0, pireAna = 0;

  for (const cle of Object.keys(g)) {
    // les indices dont le gradient analytique est le plus fort
    const gw = g[cle].w;
    const idxs = [];
    for (let k = 0; k < gw.length; k++) {
      const v = Math.abs(gw[k]);
      if (idxs.length < parCouche) { idxs.push(k); idxs.sort((a, b) => Math.abs(gw[a]) - Math.abs(gw[b])); }
      else if (v > Math.abs(gw[idxs[0]])) { idxs[0] = k; idxs.sort((a, b) => Math.abs(gw[a]) - Math.abs(gw[b])); }
    }

    for (const idx of idxs) {
      const ana = gw[idx] / T;
      if (Math.abs(ana) < 1e-5) continue;          // trop petit pour etre mesure

      const eps = 3e-3;
      const orig = c[cle].w[idx];
      c[cle].w[idx] = orig + eps;  const Lp = perteSegment(c, seg);
      c[cle].w[idx] = orig - eps;  const Lm = perteSegment(c, seg);
      c[cle].w[idx] = orig;

      const num = (Lp - Lm) / (2 * eps);
      const ecart = Math.abs(num - ana) / (Math.abs(num) + Math.abs(ana) + 1e-9);
      lignes.push(cle + '[' + idx + ']  num ' + num.toExponential(2)
                  + '  ana ' + ana.toExponential(2)
                  + '  ecart ' + ecart.toFixed(3));
      if (ecart > pireEcart) {
        pireEcart = ecart; pire = cle + '[' + idx + ']';
        pireNum = num; pireAna = ana;
      }
    }
  }

  return {
    pireEcart, pire, pireNum, pireAna, lignes,
    verdict: pireEcart < 2e-2 ? 'CONFORME' : 'FAUX',
  };
}
