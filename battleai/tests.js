// ============================================================
//  js/tests.js
//
//  Bancs d'essai affiches dans le bandeau de la page.
//  Touche T : verifie la retropropagation.
//  Touche Y : mesure la vitesse de collecte.
// ============================================================

function dit(t) {
  if (typeof montreErr === 'function') montreErr(t);
}

// ---------- une seule partie, pour un test rapide ----------
function collecteUnePartie(cerveau, graine) {
  const s = creeSession(cerveau, cerveau, graine);
  while (avanceSession(s)) { /* jusqu'a la fin */ }
  const vFin = s.p.fini ? 0 : s.traj[s.traj.length - 1].v;
  calculeAvantages(s.traj, vFin);
  const bout = s.traj.slice(0, Math.min(LONG_SEGMENT, s.traj.length));
  return { segment: { h0: bout[0].h, pas: bout }, traj: s.traj, partie: s.p };
}

// ---------- T : la retropropagation est-elle juste ? ----------
function testGradients() {
  dit('--- controle de la retropropagation ---');
  try {
    const c = creeCerveau(1);
    const t0 = performance.now();
    const u = collecteUnePartie(c, 4242);
    dit('partie jouee : ' + u.traj.length + ' decisions, '
        + ((performance.now() - t0) / 1000).toFixed(2) + ' s');
    dit('segment teste : ' + u.segment.pas.length + ' decisions');

    // on utilise peu d'echantillons : chaque point coute deux passes
    const t1 = performance.now();
    const r = verifieGradients(c, u.segment, 20);
    dit('ecart le pire  ' + r.pireEcart.toExponential(2) + '  sur ' + r.pire);
    dit('  numerique    ' + r.pireNum.toExponential(3));
    dit('  analytique   ' + r.pireAna.toExponential(3));
    dit('verdict        ' + r.verdict);
    if (r.verdict !== 'CONFORME') {
      dit('--- detail ---');
      for (const l of r.lignes) dit(l);
      dit('>>> NE PAS ENTRAINER tant que ce test echoue.');
    }
  } catch (e) {
    dit('ERREUR pendant le test : ' + e.message);
  }
}

// ---------- Y : combien coute une fournee ? ----------
function testVitesse() {
  dit('--- vitesse de collecte ---');
  try {
    const c = creeCerveau(1);
    const rng = creeRng(7);
    const t0 = performance.now();
    const segs = collecteFournee(c, [], rng);
    const dt = (performance.now() - t0) / 1000;
    const st = statistiques(segs);
    dit('segments        ' + segs.length);
    dit('decisions       ' + st.decisions);
    dit('recompense moy  ' + st.recompenseMoyenne.toFixed(4));
    dit('valeur moy      ' + st.valeurMoyenne.toFixed(4));
    dit('duree           ' + dt.toFixed(1) + ' s pour ' + N_PARTIES + ' parties');
    dit('soit            ' + (st.decisions / dt).toFixed(0) + ' decisions/s');
  } catch (e) {
    dit('ERREUR pendant le test : ' + e.message);
  }
}

// ---------- U : entrainement, une fournee a la fois ----------
let ENTR = null;
let entrEnCours = false;

function pasEntrainementAffiche() {
  if (entrEnCours) { dit('fournee deja en cours'); return; }

  // on verifie que tout est charge avant de se lancer
  const requis = ['creeEntrainement', 'pasEntrainement', 'creeCerveau',
                  'collecteFournee', 'retropropageSegment'];
  const absents = requis.filter(n => typeof self[n] !== 'function'
                                  && typeof window[n] !== 'function');
  if (absents.length) {
    dit('fichiers manquants, fonctions absentes : ' + absents.join(', '));
    return;
  }

  try {
    if (!ENTR) {
      ENTR = creeEntrainement(1);
      dit('--- entrainement demarre ---');
      dit('entrees ' + ENTR.c.nE + '  cache ' + N_CACHE);
    }
  } catch (e) {
    dit('ERREUR a la creation : ' + e.message);
    return;
  }

  entrEnCours = true;
  dit('fournee en cours, patiente...');

  // on laisse le navigateur redessiner avant de bloquer le fil
  setTimeout(() => {
    try {
      const r = pasEntrainement(ENTR);
      dit('#' + String(r.fournee).padStart(3)
        + '  recomp ' + r.recompense.toFixed(4)
        + '  perte ' + r.perte.toFixed(3)
        + '  entrop ' + r.entropie.toFixed(3)
        + '  kl ' + r.kl.toFixed(4)
        + (r.arretKL ? ' [stop]' : '')
        + '  ' + r.tTotal.toFixed(1) + ' s');
    } catch (e) {
      dit('ERREUR entrainement : ' + e.message);
      dit(String(e.stack || '').split('\n').slice(0, 3).join('\n'));
    }
    entrEnCours = false;
  }, 50);
}

// ---------- P : charger les poids entraines ----------
async function chargePoidsEntraines(silencieux) {
  try {
    const rj = await fetch('poids.json?v=' + Date.now());
    if (!rj.ok) { if (!silencieux) dit('poids.json : HTTP ' + rj.status); return; }
    const meta = await rj.json();

    const rb = await fetch('poids.bin?v=' + Date.now());
    const plat = new Float32Array(await rb.arrayBuffer());
    if (plat.length !== meta.total) {
      dit('taille incoherente : ' + plat.length + ' au lieu de ' + meta.total);
      return;
    }

    cerveauIA = importeCerveau(meta, plat);
    agentIA = creeAgentIA(cerveauIA, 1);
    dit('poids charges, tour ' + (meta.tour || '?'));
  } catch (e) {
    if (!silencieux) dit('ERREUR chargement : ' + e.message);
  }
}

// tentative au demarrage, sans bruit si les fichiers sont absents
setTimeout(() => chargePoidsEntraines(true), 300);