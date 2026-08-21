// ============================================================
//  Le cerveau : dense -> GRU -> quatre tetes d'action + valeur.
//  Ce fichier ne fait que propager vers l'avant. L'apprentissage
//  viendra dans un fichier separe.
// ============================================================

const N_MOUV   = 9;      // 8 directions + immobile
const N_VISEE  = 11;     // increments d'angle
const PAS_VISEE = 0.06;  // rad par cran, soit +-0,30
const N_CACHE  = 256;
const PAS_DECISION = 6;  // une decision tous les 6 pas, 0,1 s

const DIRS = [
  [0, 0], [0, -1], [1, -1], [1, 0], [1, 1],
  [0, 1], [-1, 1], [-1, 0], [-1, -1],
];

// ---------- algebre ----------
function matVec(m, v, nIn, nOut, out) {
  for (let j = 0; j < nOut; j++) {
    let s = m.b[j];
    const base = j * nIn;
    for (let i = 0; i < nIn; i++) s += m.w[base + i] * v[i];
    out[j] = s;
  }
  return out;
}

const sigm = (x) => 1 / (1 + Math.exp(-x));

function creeCouche(nIn, nOut, rng) {
  // initialisation de Xavier : garde la variance stable d'une couche a l'autre
  const lim = Math.sqrt(6 / (nIn + nOut));
  const w = new Float32Array(nIn * nOut);
  for (let k = 0; k < w.length; k++) w[k] = (rng() * 2 - 1) * lim;
  return { w, b: new Float32Array(nOut), nIn, nOut };
}

// ---------- le reseau ----------
function creeCerveau(graine) {
  const rng = creeRng(graine == null ? (Math.random() * 1e9) | 0 : graine);
  const nE = tailleObservation();

  return {
    nE,
    dense: creeCouche(nE, N_CACHE, rng),
    // GRU : trois portes, chacune lit l'entree et l'etat precedent
    wz: creeCouche(N_CACHE, N_CACHE, rng), uz: creeCouche(N_CACHE, N_CACHE, rng),
    wr: creeCouche(N_CACHE, N_CACHE, rng), ur: creeCouche(N_CACHE, N_CACHE, rng),
    wh: creeCouche(N_CACHE, N_CACHE, rng), uh: creeCouche(N_CACHE, N_CACHE, rng),
    tMouv:  creeCouche(N_CACHE, N_MOUV, rng),
    tVisee: creeCouche(N_CACHE, N_VISEE, rng),
    tTir:   creeCouche(N_CACHE, 2, rng),
    tRech:  creeCouche(N_CACHE, 2, rng),
    tVal:   creeCouche(N_CACHE, 1, rng),
    tmp: {
      x: new Float32Array(N_CACHE), z: new Float32Array(N_CACHE),
      r: new Float32Array(N_CACHE), n: new Float32Array(N_CACHE),
      a: new Float32Array(N_CACHE), b: new Float32Array(N_CACHE),
      mouv: new Float32Array(N_MOUV), visee: new Float32Array(N_VISEE),
      tir: new Float32Array(2), rech: new Float32Array(2),
      val: new Float32Array(1),
    },
  };
}

function creeEtatCache() { return new Float32Array(N_CACHE); }

// ---------- une passe ----------
function propage(c, obs, h) {
  const t = c.tmp;

  matVec(c.dense, obs, c.nE, N_CACHE, t.x);
  for (let i = 0; i < N_CACHE; i++) t.x[i] = Math.max(0, t.x[i]);   // ReLU

  matVec(c.wz, t.x, N_CACHE, N_CACHE, t.a);
  matVec(c.uz, h,   N_CACHE, N_CACHE, t.b);
  for (let i = 0; i < N_CACHE; i++) t.z[i] = sigm(t.a[i] + t.b[i]);

  matVec(c.wr, t.x, N_CACHE, N_CACHE, t.a);
  matVec(c.ur, h,   N_CACHE, N_CACHE, t.b);
  for (let i = 0; i < N_CACHE; i++) t.r[i] = sigm(t.a[i] + t.b[i]);

  matVec(c.wh, t.x, N_CACHE, N_CACHE, t.a);
  for (let i = 0; i < N_CACHE; i++) t.n[i] = h[i] * t.r[i];
  matVec(c.uh, t.n, N_CACHE, N_CACHE, t.b);
  for (let i = 0; i < N_CACHE; i++) t.n[i] = Math.tanh(t.a[i] + t.b[i]);

  for (let i = 0; i < N_CACHE; i++)
    h[i] = (1 - t.z[i]) * t.n[i] + t.z[i] * h[i];

  matVec(c.tMouv,  h, N_CACHE, N_MOUV,  t.mouv);
  matVec(c.tVisee, h, N_CACHE, N_VISEE, t.visee);
  matVec(c.tTir,   h, N_CACHE, 2,       t.tir);
  matVec(c.tRech,  h, N_CACHE, 2,       t.rech);
  matVec(c.tVal,   h, N_CACHE, 1,       t.val);

  return t;
}

// Seules les actions mecaniquement impossibles sont retirees.
// Un choix qui a une consequence, comme foncer dans un arbre,
// reste disponible : c'est a l'agent de l'apprendre.
function masques(a) {
  const arme = !!a.inv[a.slot];
  const peutTirer = arme && a.recharge <= 0 && a.rechargement <= 0 && a.munitions > 0;
  const peutRecharger = arme && a.rechargement <= 0 && a.munitions < 30;
  return {
    tir:  [1, peutTirer ? 1 : 0],
    rech: [1, peutRecharger ? 1 : 0],
  };
}

function meilleureAction(logits, n, masque) {
  let k = -1, max = -Infinity;
  for (let i = 0; i < n; i++) {
    if (masque && !masque[i]) continue;
    if (logits[i] > max) { max = logits[i]; k = i; }
  }
  return k < 0 ? 0 : k;
}

// tirage softmax, en ignorant les options interdites
function tireSoftmax(logits, n, rng, masque) {
  let max = -Infinity;
  for (let i = 0; i < n; i++)
    if ((!masque || masque[i]) && logits[i] > max) max = logits[i];

  let som = 0;
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p[i] = (!masque || masque[i]) ? Math.exp(logits[i] - max) : 0;
    som += p[i];
  }
  if (som <= 0) return 0;                 // tout interdit : on ne fait rien

  let u = rng() * som;
  for (let i = 0; i < n; i++) { u -= p[i]; if (u <= 0) return i; }
  return n - 1;
}

// ---------- l'agent complet ----------
function creeAgentIA(cerveau, graine) {
  return {
    c: cerveau,
    h: creeEtatCache(),
    mem: creeMemoire(),
    rng: creeRng(graine == null ? (Math.random() * 1e9) | 0 : graine),
    compteur: 0,
    derniere: { mx: 0, my: 0, angle: 0, tire: false, recharger: false },
    derniereObs: null,
  };
}

// appelee a chaque pas, ne reflechit qu'un pas sur PAS_DECISION
function agitIA(ag, p, i) {
  const a = p.agents[i];

  if (ag.compteur % PAS_DECISION === 0) {
    const o = observe(p, i, ag.mem);
    ag.derniereObs = o;
    const t = propage(ag.c, o.v, ag.h);


    const mq = masques(a);
    const det = (typeof iaDeterministe !== 'undefined') && iaDeterministe;
    const pick = (l, n, m) => det ? meilleureAction(l, n, m)
                                  : tireSoftmax(l, n, ag.rng, m);
    const km = pick(t.mouv,  N_MOUV,  null);
    const kv = pick(t.visee, N_VISEE, null);
    const kt = pick(t.tir,   2,       mq.tir);
    const kr = pick(t.rech,  2,       mq.rech);

    // a court de munitions, on recharge : ne pas le faire n'est
    // jamais un choix valable, autant l'imposer
    let forceRech = kr === 1;
    if (a.munitions === 0 && a.rechargement <= 0 && a.inv[a.slot]) forceRech = true;

    const d = DIRS[km];
    ag.derniere = {
      mx: d[0], my: d[1],
      // angle absolu fige au moment de la decision : sans cela
      // l'increment s'appliquerait a chacun des PAS_DECISION pas
      angle: a.angle + (kv - (N_VISEE - 1) / 2) * PAS_VISEE,
      tire: kt === 1,
      recharger: kr === 1,
      choix: { km, kv, kt, kr },
      masque: mq,
      valeur: t.val[0],
      recharger: forceRech,
    };
  }
  ag.compteur++;

  const d = ag.derniere;
  return {
    mx: d.mx, my: d.my,
    angle: d.angle,
    slot: a.slot,
    tire: d.tire,
    recharger: d.recharger,
    abandon: false,
  };
}
