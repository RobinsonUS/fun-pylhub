const touches = {};
let drag = null;
const souris = { x: 0, y: 0, vu: false, enfonce: false };
let partie = null;
const MOI = 0;
let slotVoulu = 1;                 // le moteur applique ce choix, pas nous

let cerveauIA = null;              // survit aux parties
let agentIA = null;
let iaDeterministe = false;

function slotSousPointeur(x, y) {
  for (const z of zonesInv()) {
    if (x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h) return z.i;
  }
  return -1;
}

// ---------- clavier ----------
// les fleches et ZQSD pilotent le meme personnage
function toucheDeplacement(code, key) {
  if (code === 'KeyZ' || key === 'z' || code === 'ArrowUp')    return 'haut';
  if (code === 'KeyS' || key === 's' || code === 'ArrowDown')  return 'bas';
  if (code === 'KeyQ' || key === 'q' || code === 'ArrowLeft')  return 'gauche';
  if (code === 'KeyD' || key === 'd' || code === 'ArrowRight') return 'droite';
  if (code === 'Space' || key === ' ') return 'espace';
  return null;
}

window.addEventListener('keydown', (e) => {
  const code = e.code;
  const key = (e.key || '').toLowerCase();

  // Entree ne relance que si la partie est terminee : jamais d'abandon
  if (code === 'Enter' || key === 'enter') {
    e.preventDefault();
    if (partie && partie.fini) nouvelle();
    return;
  }

  if (code === 'KeyR' || key === 'r') {
    if (partie && !partie.fini) { e.preventDefault(); touches['r'] = true; }
    return;
  }

  if (code.startsWith('Digit') || (key >= '1' && key <= '6')) {
    if (partie && partie.agents) {
      e.preventDefault();
      const chiffre = parseInt(code.replace('Digit', '')) || parseInt(key);
      if (chiffre >= 1 && chiffre <= 6) slotVoulu = chiffre - 1;
    }
    return;
  }

  const t = toucheDeplacement(code, key);
  if (t) { e.preventDefault(); touches[t] = true; }
});

window.addEventListener('keyup', (e) => {
  const code = e.code;
  const key = (e.key || '').toLowerCase();

  if (code === 'KeyR' || key === 'r') { touches['r'] = false; return; }

  const t = toucheDeplacement(code, key);
  if (t) touches[t] = false;
});

// ---------- pointeur ----------
function estSouris(e) { return !e.pointerType || e.pointerType === 'mouse'; }
function nulPart(e) { return e.clientX === 0 && e.clientY === 0; }

// le canvas a une taille fixe et peut etre reduit a l'affichage :
// on ramene la position du pointeur dans le repere du jeu
function versJeu(e) {
  const r = cv.getBoundingClientRect();
  const z = ZOOM || 1;
  return { x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z };
}

function bougePointeur(e) {
  if (!estSouris(e) || nulPart(e)) return;
  const p = versJeu(e);
  souris.x = p.x; souris.y = p.y; souris.vu = true;
  if (drag) { drag.x = souris.x; drag.y = souris.y; }
}

addEventListener('pointermove', bougePointeur, { passive: true });
addEventListener('mousemove', bougePointeur, { passive: true });

addEventListener('pointerdown', (e) => {
  if (!estSouris(e)) return;
  if (!nulPart(e)) {
    const p = versJeu(e);
    souris.x = p.x; souris.y = p.y; souris.vu = true;
  }
  if (cv) cv.focus({ preventScroll: true });

  if (!partie || !partie.agents) return;
  const a = partie.agents[MOI];
  const i = slotSousPointeur(souris.x, souris.y);

  if (i >= 0) {
    if (i > 0 && a.inv && a.inv[i]) {
      drag = { depuis: i, objet: a.inv[i], x: souris.x, y: souris.y };
    }
    slotVoulu = i;
    return;
  }
  souris.enfonce = true;
});

function relachePointeur() {
  if (drag && partie && partie.agents) {
    const a = partie.agents[MOI];
    const j = slotSousPointeur(souris.x, souris.y);
    if (j > 0 && j !== drag.depuis) {
      const tmp = a.inv[j];
      a.inv[j] = a.inv[drag.depuis];
      a.inv[drag.depuis] = tmp;
      slotVoulu = j;
    }
    drag = null;
  }
  souris.enfonce = false;
}

addEventListener('pointerup', relachePointeur);
addEventListener('pointercancel', relachePointeur);
addEventListener('blur', () => { souris.enfonce = false; drag = null; });

addEventListener('wheel', (e) => {
  e.preventDefault();
  const d = e.deltaY > 0 ? 1 : -1;
  slotVoulu = (slotVoulu + d + NB_SLOTS) % NB_SLOTS;
}, { passive: false });

addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
addEventListener('touchmove',  (e) => e.preventDefault(), { passive: false });

function prendFocus() { if (cv) cv.focus({ preventScroll: true }); }
addEventListener('load', prendFocus);
addEventListener('focus', prendFocus);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) prendFocus();
});

// ---------- actions ----------
function actionJoueur() {
  let mx = 0, my = 0;
  if (touches['gauche']) mx -= 1;
  if (touches['droite']) mx += 1;
  if (touches['haut'])   my -= 1;
  if (touches['bas'])    my += 1;

  let angle = partie.agents[MOI].angle;
  if (souris.vu)
    angle = Math.atan2(souris.y - ecranJoueur.y, souris.x - ecranJoueur.x);

  return {
    mx, my, angle,
    slot: slotVoulu,
    recharger: !!touches['r'],
    tire: (souris.enfonce || !!touches['espace']) && !drag,
    abandon: false,
  };
}

function actionSecond() {
  return agitIA(agentIA, partie, 1);
}

function nouvelle() {
  drag = null;
  slotVoulu = 1;
  partie = creePartie();
  if (!cerveauIA) cerveauIA = creeCerveau();
  agentIA = creeAgentIA(cerveauIA, 1);
  cam.x = partie.agents[MOI].x;
  cam.y = partie.agents[MOI].y;
  ecranJoueur.x = LARG / 2;
  ecranJoueur.y = HAUT / 2;
}

let precedent = 0, reste = 0;

function boucle(maintenant) {
  requestAnimationFrame(boucle);
  if (!precedent) precedent = maintenant;
  let dt = (maintenant - precedent) / 1000;
  precedent = maintenant;
  if (dt > 0.25) dt = 0.25;

  reste += dt;
  while (reste >= DT) {
    if (partie && !partie.fini) pas(partie, [ actionJoueur(), actionSecond() ]);
    reste -= DT;
  }

  if (partie) {
    dessine(partie, MOI, souris.vu ? souris : null, drag);

    if (partie.fini) {
      repereEcran();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, HAUT / 2 - 60, LARG, 120);
      ctx.fillStyle = '#fff';
      ctx.font = '700 32px system-ui, sans-serif';
      ctx.textAlign = 'center';
      const txt = partie.vainqueur === MOI ? 'Victoire'
                : partie.vainqueur === -1 ? 'Match nul' : 'Defaite';
      ctx.fillText(txt, LARG / 2, HAUT / 2);
      ctx.font = '400 16px system-ui, sans-serif';
      ctx.fillText('Appuyez sur Entree pour rejouer', LARG / 2, HAUT / 2 + 32);
      ctx.textAlign = 'left';
    }
  }
}

// ---------- demarrage ----------
initRendu();
prendFocus();
(async () => {
  cerveauIA = await chargePoidsEntraines();
  nouvelle();
  requestAnimationFrame(boucle);
})();
