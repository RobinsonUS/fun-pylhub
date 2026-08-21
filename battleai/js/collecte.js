// ============================================================
//  js/collecte.js
//
//  Fait jouer des parties sans affichage et enregistre tout ce
//  dont PPO aura besoin. Rien ici ne touche au canvas.
// ============================================================

const LONG_SEGMENT = 32;      // decisions par segment de retropropagation
const N_PARTIES    = 16;      // parties menees de front

// ---------- une partie en cours de collecte ----------
function creeSession(cerveauA, cerveauB, graine) {
  const p = creePartie(graine);
  return {
    p,
    ag: [
      creeAgentIA(cerveauA, graine ^ 0x5f3a),
      creeAgentIA(cerveauB, graine ^ 0xa17c),
    ],
    // on n'apprend que du joueur 0 ; le joueur 1 est l'adversaire
    traj: [],
    avant: instantane(p, 0),
    pas: 0,
  };
}

// ---------- une decision, puis PAS_DECISION pas de jeu ----------
function avanceSession(s) {
  const p = s.p;
  if (p.fini) return false;

  // etat cache d'avant la decision : PPO en aura besoin pour rejouer
  const hAvant = Float32Array.from(s.ag[0].h);
  const o = observe(p, 0, s.ag[0].mem);
  const t = propage(s.ag[0].c, o.v, s.ag[0].h);

  const a = p.agents[0];
  const mq = masques(a);
  const km = tireSoftmax(t.mouv,  N_MOUV,  s.ag[0].rng);
  const kv = tireSoftmax(t.visee, N_VISEE, s.ag[0].rng);
  const kt = tireSoftmax(t.tir,   2,       s.ag[0].rng, mq.tir);
  const kr = tireSoftmax(t.rech,  2,       s.ag[0].rng, mq.rech);

  // meme regle qu'en jeu : a court de munitions, on recharge d'office
  let recharger = kr === 1;
  if (a.munitions === 0 && a.rechargement <= 0 && a.inv[a.slot]) recharger = true;

  const d = DIRS[km];
  const act0 = {
    mx: d[0], my: d[1],
    angle: a.angle + (kv - (N_VISEE - 1) / 2) * PAS_VISEE,
    slot: a.slot,
    tire: kt === 1,
    recharger,
    abandon: false,
  };

  const entree = {
    obs: o.v,                       // deja une copie, observe en cree une
    h: hAvant,
    choix: [km, kv, kt, kr],
    masque: mq,
    logp: logProbTotale(t, [km, kv, kt, kr], mq),
    v: t.val[0],
    r: 0,
    termine: false,
  };

  // l'action est maintenue pendant tout le bloc
  for (let k = 0; k < PAS_DECISION && !p.fini; k++) {
    pas(p, [act0, agitIA(s.ag[1], p, 1)]);
  }

  entree.r = recompense(p, 0, s.avant);
  entree.termine = p.fini;
  s.avant = instantane(p, 0);
  s.traj.push(entree);
  s.pas++;

  return !p.fini;
}

// ---------- log-probabilite de l'action choisie ----------
// Somme des quatre tetes. Le masque est applique ici EXACTEMENT
// comme au moment du tirage : sans cela, les probabilites du jeu
// et celles de l'entrainement divergeraient.
function logSoftmax(logits, n, k, masque) {
  let max = -Infinity;
  for (let i = 0; i < n; i++)
    if ((!masque || masque[i]) && logits[i] > max) max = logits[i];
  let som = 0;
  for (let i = 0; i < n; i++)
    if (!masque || masque[i]) som += Math.exp(logits[i] - max);
  return (logits[k] - max) - Math.log(som);
}

function logProbTotale(t, choix, mq) {
  return logSoftmax(t.mouv,  N_MOUV,  choix[0])
       + logSoftmax(t.visee, N_VISEE, choix[1])
       + logSoftmax(t.tir,   2,       choix[2], mq.tir)
       + logSoftmax(t.rech,  2,       choix[3], mq.rech);
}

// ---------- une fournee complete ----------
// Renvoie un tableau de segments de LONG_SEGMENT decisions,
// chacun avec l'etat cache de depart. C'est l'unite d'apprentissage.
function collecteFournee(cerveau, vivier, rng) {
  const segments = [];

  for (let n = 0; n < N_PARTIES; n++) {
    // un adversaire tire dans le passe empeche les deux agents de
    // s'enfermer dans une strategie mutuelle absurde
    const adv = (rng() < 0.75 || vivier.length === 0)
      ? cerveau
      : vivier[(rng() * vivier.length) | 0];

    const s = creeSession(cerveau, adv, (rng() * 1e9) | 0);
    while (avanceSession(s)) { /* jusqu'a la fin de partie */ }

    // valeur du dernier etat, nulle si la partie s'est terminee
    const vFin = s.p.fini ? 0 : s.traj[s.traj.length - 1].v;
    calculeAvantages(s.traj, vFin);

    for (let d = 0; d < s.traj.length; d += LONG_SEGMENT) {
      const bout = s.traj.slice(d, d + LONG_SEGMENT);
      if (bout.length < 4) continue;              // trop court pour apprendre
      segments.push({ h0: bout[0].h, pas: bout });
    }
  }

  return segments;
}

// ---------- suivi ----------
function statistiques(segments) {
  let n = 0, r = 0, v = 0;
  for (const s of segments)
    for (const e of s.pas) { n++; r += e.r; v += e.v; }
  return { decisions: n, recompenseMoyenne: r / n, valeurMoyenne: v / n };
}
