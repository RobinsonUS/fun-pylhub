// ============================================================
//  js/recompense.js
//
//  Ce que l'agent cherche a maximiser. Volontairement pauvre :
//  degats, issue de la partie, et un cout du temps. Aucune
//  recompense de forme, sinon l'agent optimise le bonus et
//  non le jeu.
// ============================================================

const R_DEGAT_INFLIGE = 1.0;    // par point de vie retire, rapporte a 100
const R_DEGAT_SUBI    = 1.0;
const R_VICTOIRE      = 3.0;
const R_DEFAITE       = -3.0;
const R_NUL           = -1.5;   // camper n'est pas un abri
const R_TEMPS         = 0.0015; // par decision

const GAMMA  = 0.995;
const LAMBDA = 0.95;

// Photographie des compteurs, prise avant chaque bloc de pas
function instantane(p, i) {
  return {
    pvMoi:  p.agents[i].pv,
    pvAdv:  p.agents[1 - i].pv,
  };
}

// Recompense d'une decision : ce qui a change pendant les
// PAS_DECISION pas ou l'action etait maintenue.
function recompense(p, i, avant) {
  const moi = p.agents[i], adv = p.agents[1 - i];

  const inflige = Math.max(0, avant.pvAdv - adv.pv);
  const subi    = Math.max(0, avant.pvMoi - moi.pv);

  let r = (inflige / 100) * R_DEGAT_INFLIGE
        - (subi    / 100) * R_DEGAT_SUBI
        - R_TEMPS;

  if (p.fini) {
    if (p.vainqueur === i)       r += R_VICTOIRE;
    else if (p.vainqueur === -1) r += R_NUL;
    else                         r += R_DEFAITE;
  }
  return r;
}

// ============================================================
//  Avantages generalises. On remonte la trajectoire a l'envers :
//  chaque decision herite d'une part de ce qui a suivi.
// ============================================================
function calculeAvantages(traj, valeurFinale) {
  const n = traj.length;
  let suivant = valeurFinale;
  let gae = 0;

  for (let t = n - 1; t >= 0; t--) {
    const e = traj[t];
    const continu = e.termine ? 0 : 1;
    const delta = e.r + GAMMA * suivant * continu - e.v;
    gae = delta + GAMMA * LAMBDA * continu * gae;
    e.avantage = gae;
    e.retour = gae + e.v;        // cible de la tete de valeur
    suivant = e.v;
  }

  // normalisation : stabilise l'echelle du gradient d'une
  // fournee a l'autre
  let m = 0;
  for (const e of traj) m += e.avantage;
  m /= n;
  let s = 0;
  for (const e of traj) s += (e.avantage - m) ** 2;
  s = Math.sqrt(s / n) + 1e-8;
  for (const e of traj) e.avantageN = (e.avantage - m) / s;
}