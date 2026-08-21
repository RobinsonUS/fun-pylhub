// ===================== aleatoire deterministe =====================
function creeRng(graine) {
  let a = graine | 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===================== decor =====================
function genereDecor(rng) {
  const obs = [];
  const marge = 160;
  const libre = MONDE - 2 * marge;

  const poser = (n, r, type) => {
    let essais = 0, poses = 0;
    while (poses < n && essais < n * 100) {
      essais++;
      const x = marge + rng() * libre;
      const y = marge + rng() * libre;
      let ok = true;
      for (const o of obs) {
        if (Math.hypot(o.x - x, o.y - y) < o.r + r + 24) { ok = false; break; }
      }
      if (Math.hypot(x - MONDE / 2, y - MONDE / 2) < 280) ok = false;
      if (ok) {
        obs.push({
          x, y, r, type,
          pv: PV_ARBRE, secousse: 0,
          lobes: 9 + ((rng() * 3) | 0),
          phase: rng() * Math.PI * 2,
          teinte: (rng() * C.arbres.length) | 0,
          taches: [
            { a: rng() * 6.28, d: 0.30 + rng() * 0.35, t: rng() * 6.28 },
            { a: rng() * 6.28, d: 0.30 + rng() * 0.35, t: rng() * 6.28 },
            { a: rng() * 6.28, d: 0.30 + rng() * 0.35, t: rng() * 6.28 },
          ],
        });
        poses++;
      }
    }
  };

  poser(N_ARBRES, R_ARBRE, 'arbre');
  poser(N_BUISSONS, R_BUISSON, 'buisson');
  return obs;
}

// ===================== etat =====================
function creePartie(graine) {
  const rng = creeRng(graine == null ? (Math.random() * 1e9) | 0 : graine);
  const obs = genereDecor(rng);

  // les deux joueurs apparaissent de part et d'autre du centre,
  // sur une direction tiree au hasard, et se font face
  const placer = (dirX, dirY) => {
    for (let i = 0; i < 400; i++) {
      const d = 900 + rng() * 350;
      const ec = (rng() - 0.5) * 260;
      const x = MONDE / 2 + dirX * d - dirY * ec;
      const y = MONDE / 2 + dirY * d + dirX * ec;
      if (x < 150 || x > MONDE - 150 || y < 150 || y > MONDE - 150) continue;
      let ok = true;
      for (const o of obs) {
        if (o.type === 'buisson') continue;
        if (Math.hypot(o.x - x, o.y - y) < o.r + R_JOUEUR + 20) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return { x: MONDE / 2 + dirX * 900, y: MONDE / 2 + dirY * 900 };
  };

  const axe = rng() * Math.PI * 2;
  const ux = Math.cos(axe), uy = Math.sin(axe);
  const p0 = placer(ux, uy);
  const p1 = placer(-ux, -uy);
  const vers0 = Math.atan2(p1.y - p0.y, p1.x - p0.x);

  return {
    rng, obs, t: 0, fini: false, vainqueur: -1,
    zone: { x: MONDE / 2, y: MONDE / 2, r: ZONE_R0 },
    balles: [], particules: [],
    agents: [
      { x: p0.x, y: p0.y, vx: 0, vy: 0, pv: PV_MAX, angle: vers0, recharge: 0,
        vivant: true, secousse: 0, touche: 0, ticZone: 0,
        tirTimer: 0, recul: 0, revele: 0,
        munitions: 30, rechargement: 0, dureeRechargeMax: 0,
        slot: 1, inv: [null, 'fusil', null, null, null, null] },
      { x: p1.x, y: p1.y, vx: 0, vy: 0, pv: PV_MAX, angle: vers0 + Math.PI,
        recharge: 0,
        vivant: true, secousse: 0, touche: 0, ticZone: 0,
        tirTimer: 0, recul: 0, revele: 0,
        munitions: 30, rechargement: 0, dureeRechargeMax: 0,
        slot: 1, inv: [null, 'fusil', null, null, null, null] },
    ],
  };
}

// ===================== collisions =====================
function bloquant(o) { return o.type === 'arbre'; }

function borne(a) {
  a.x = Math.min(MONDE - R_JOUEUR, Math.max(R_JOUEUR, a.x));
  a.y = Math.min(MONDE - R_JOUEUR, Math.max(R_JOUEUR, a.y));
}

function deplace(a, dx, dy, obs, autre) {
  a.x += dx; a.y += dy;
  borne(a);

  for (let iter = 0; iter < 3; iter++) {
    let touche = false;
    for (const o of obs) {
      if (!bloquant(o)) continue;
      const nx = a.x - o.x, ny = a.y - o.y;
      const d = Math.hypot(nx, ny), min = o.r + R_JOUEUR;
      if (d < min) {
        touche = true;
        if (d < 1e-6) { a.x += min; continue; }
        a.x += nx / d * (min - d);
        a.y += ny / d * (min - d);
      }
    }
    if (!touche) break;
  }

  if (autre && autre.vivant) {
    const nx = a.x - autre.x, ny = a.y - autre.y;
    const d = Math.hypot(nx, ny), min = R_JOUEUR * 2;
    if (d < min && d > 1e-6) {
      const p = (min - d) * 0.5;
      a.x += nx / d * p;      a.y += ny / d * p;
      autre.x -= nx / d * p;  autre.y -= ny / d * p;
      borne(autre);
    }
  }

  borne(a);
}

function bloqueVue(x0, y0, x1, y1, obs) {
  const dx = x1 - x0, dy = y1 - y0;
  const long2 = dx * dx + dy * dy;
  if (long2 < 1e-6) return false;
  for (const o of obs) {
    if (!bloquant(o)) continue;
    let t = ((o.x - x0) * dx + (o.y - y0) * dy) / long2;
    t = Math.max(0, Math.min(1, t));
    const px = x0 + dx * t, py = y0 + dy * t;
    if (Math.hypot(o.x - px, o.y - py) < o.r) return true;
  }
  return false;
}

function dansBuisson(x, y, obs) {
  for (const o of obs) {
    if (o.type !== 'buisson') continue;
    if (Math.hypot(o.x - x, o.y - y) < o.r * 0.75) return true;
  }
  return false;
}

// le buisson qui camoufle reellement ce point
function buissonCachant(x, y, obs) {
  for (const o of obs) {
    if (o.type !== 'buisson') continue;
    if (Math.hypot(o.x - x, o.y - y) < o.r * 0.75) return o;
  }
  return null;
}

// ===================== champ de vision =====================
function dansChamp(a, b) {
  return Math.abs(b.x - a.x) <= VUE_L / 2 + R_SPRITE &&
         Math.abs(b.y - a.y) <= VUE_H / 2 + R_SPRITE;
}

// Regle unique, partagee par le rendu et par l'observation de l'IA.
// On voit ce qui est a l'ecran. Les arbres arretent les balles,
// pas le regard. Seul un buisson camoufle.
function voit(a, b, obs) {
  if (!dansChamp(a, b)) return false;
  if (b.revele > 0) return true;          // tirer ou encaisser trahit
  const bu = buissonCachant(b.x, b.y, obs);
  if (!bu) return true;
  return Math.hypot(bu.x - a.x, bu.y - a.y) < bu.r + R_JOUEUR;
}

// ===================== zone =====================
function majZone(p) {
  const t = p.t - ZONE_ATTENTE;
  if (t <= 0) { p.zone.r = ZONE_R0; return; }
  const u = Math.min(1, t / ZONE_DUREE);
  p.zone.r = ZONE_R0 + (ZONE_R1 - ZONE_R0) * u;
}

// ===================== un pas =====================
function pas(p, actions) {
  if (p.fini) return;
  p.t += DT;
  majZone(p);

  for (const o of p.obs) if (o.secousse > 0) o.secousse = Math.max(0, o.secousse - DT);

  for (let k = p.particules.length - 1; k >= 0; k--) {
    const q = p.particules[k];
    q.x += q.vx * DT; q.y += q.vy * DT;
    q.vx *= 0.88; q.vy *= 0.88;
    if (q.rot !== undefined && q.vrot !== undefined) q.rot += q.vrot * DT;
    q.vie -= DT;
    if (q.vie <= 0) p.particules.splice(k, 1);
  }

  for (const a of p.agents) {
    if (a.secousse > 0) a.secousse = Math.max(0, a.secousse - DT);
    if (a.touche   > 0) a.touche   = Math.max(0, a.touche - DT);
    if (a.tirTimer > 0) a.tirTimer = Math.max(0, a.tirTimer - DT);
    if (a.recul    > 0) a.recul    = Math.max(0, a.recul - DT);
    if (a.revele   > 0) a.revele   = Math.max(0, a.revele - DT);
    if (a.rechargement > 0) {
      a.rechargement -= DT;
      if (a.rechargement <= 0) {
        a.munitions = 30;
        a.dureeRechargeMax = 0;
      }
    }
  }

  for (let i = 0; i < 2; i++) {
    const a = p.agents[i], act = actions[i];

    if (act.abandon) { a.pv = 0; a.vivant = false; }
    if (!a.vivant) continue;

    let mx = act.mx || 0, my = act.my || 0;
    const n = Math.hypot(mx, my);
    if (n > 1) { mx /= n; my /= n; }
    a.vx = mx * VITESSE; a.vy = my * VITESSE;
    deplace(a, a.vx * DT, a.vy * DT, p.obs, p.agents[1 - i]);

    if (act.angle !== undefined) a.angle = act.angle;

    // changer d'emplacement annule le rechargement : l'arme quitte la main
    if (act.slot !== undefined && act.slot !== a.slot) {
      a.slot = act.slot;
      a.rechargement = 0;
      a.dureeRechargeMax = 0;
    }

    // on ne recharge que l'arme que l'on tient
    if (act.recharger && a.rechargement <= 0 && a.munitions < 30 && a.inv[a.slot]) {
      a.rechargement = 1.4;
      a.dureeRechargeMax = 1.4;
    }

    a.recharge -= DT;
    if (act.tire && a.recharge <= 0 && a.rechargement <= 0 &&
        a.munitions > 0 && a.inv[a.slot]) {
      a.recharge = CADENCE;
      a.tirTimer = 0.35;
      a.revele = 0.35;
      a.recul = 0.08;
      a.munitions--;

      const dispersionAngle = (p.rng() - 0.5) * DISPERSION;
      const angleTir = a.angle + dispersionAngle;

      const bx = a.x + Math.cos(a.angle) * CANON_L;
      const by = a.y + Math.sin(a.angle) * CANON_L;

      p.balles.push({
        x: bx, y: by,
        vx: Math.cos(angleTir) * V_BALLE,
        vy: Math.sin(angleTir) * V_BALLE,
        ang: angleTir,
        reste: PORTEE, par: i,
      });

      const px = a.x + Math.cos(a.angle) * (CANON_L + 6);
      const py = a.y + Math.sin(a.angle) * (CANON_L + 6);

      p.particules.push({
        type: 'flamme', x: px, y: py, vx: 0, vy: 0,
        ang: a.angle, r: 17, vie: 0.05, vieMax: 0.05,
      });

      const nbEtincelles = 5 + ((p.rng() * 4) | 0);
      for (let e = 0; e < nbEtincelles; e++) {
        const dev = (p.rng() - 0.5) * 0.8;
        const an = a.angle + dev;
        const vit = 90 + p.rng() * 210;
        p.particules.push({
          type: 'etincelle',
          x: px + Math.cos(a.angle) * (p.rng() * 5),
          y: py + Math.sin(a.angle) * (p.rng() * 5),
          vx: Math.cos(an) * vit,
          vy: Math.sin(an) * vit,
          r: 3 + p.rng() * 4,
          rot: p.rng() * Math.PI * 2,
          vrot: (p.rng() - 0.5) * 20,
          vie: 0.10 + p.rng() * 0.12,
          vieMax: 0.22,
        });
      }
    }

    const dz = Math.hypot(a.x - p.zone.x, a.y - p.zone.y);
    if (dz > p.zone.r) {
      a.pv -= ZONE_DEGATS * DT;
      a.touche = 0.30;
      a.revele = 0.35;                 // souffrir de la zone trahit aussi
      a.ticZone = (a.ticZone || 0) - DT;
      if (a.ticZone <= 0) { a.ticZone = 0.45; a.secousse = 0.14; }
      if (a.pv <= 0) { a.pv = 0; a.vivant = false; }
    }
  }

  for (let k = p.balles.length - 1; k >= 0; k--) {
    const b = p.balles[k];
    const dx = b.vx * DT, dy = b.vy * DT;
    const nx = b.x + dx, ny = b.y + dy;

    let mort = false;
    b.reste -= Math.hypot(dx, dy);
    if (b.reste <= 0) mort = true;

    if (!mort) {
      for (const o of p.obs) {
        if (!bloquant(o)) continue;
        if (Math.hypot(o.x - nx, o.y - ny) < o.r + R_BALLE) {
          const degatsArbre = p.rng() < 0.5 ? 10 : 11;
          o.pv -= degatsArbre;
          o.secousse = 0.22;
          if (o.pv <= 0) {
            o.pv = 0; o.type = 'souche'; o.secousse = 0;
            for (let q = 0; q < 22; q++) {
              const an = p.rng() * Math.PI * 2;
              const vi = 90 + p.rng() * 260;
              const dd = p.rng() * o.r * 0.75;
              p.particules.push({
                x: o.x + Math.cos(an) * dd,
                y: o.y + Math.sin(an) * dd,
                vx: Math.cos(an) * vi,
                vy: Math.sin(an) * vi,
                r: o.r * (0.06 + p.rng() * 0.10),
                vie: 0.45 + p.rng() * 0.45,
                vieMax: 0.9,
              });
            }
          }
          mort = true;
          break;
        }
      }
    }

    if (!mort) {
      const cible = p.agents[1 - b.par];
      if (cible.vivant && Math.hypot(cible.x - nx, cible.y - ny) < R_JOUEUR + R_BALLE) {
        const degatsJoueur = p.rng() < 0.5 ? 10 : 11;
        cible.pv -= degatsJoueur;
        cible.secousse = 0.16;
        cible.touche = 0.30;
        cible.revele = 0.35;           // encaisser trahit sa position
        if (cible.pv <= 0) { cible.pv = 0; cible.vivant = false; }
        mort = true;
      }
    }

    if (mort) p.balles.splice(k, 1);
    else { b.x = nx; b.y = ny; }
  }

  const v0 = p.agents[0].vivant, v1 = p.agents[1].vivant;
  if (!v0 || !v1) {
    p.fini = true;
    p.vainqueur = (v0 === v1) ? -1 : (v0 ? 0 : 1);
  } else if (p.t >= DUREE_MAX) {
    p.fini = true; p.vainqueur = -1;
  }
}
