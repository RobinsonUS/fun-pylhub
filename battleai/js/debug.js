// ============================================================
//  Calque de verification : montre exactement ce que l'agent
//  percoit. Touche  O  pour l'afficher ou le masquer.
// ============================================================
let debugActif = false;

function dessineDebug(p, moi, obsRes) {
  if (!debugActif) return;
  if (!obsRes || !obsRes.detail) {
    repereEcran();
    ctx.fillStyle = '#ff9';
    ctx.font = '600 14px ui-monospace, monospace';
    ctx.fillText('debug : observation absente', 20, 40);
    return;
  }
  try {
    dessineDebugInterne(p, moi, obsRes);
  } catch (err) {
    debugActif = false;
    if (typeof montreErr === 'function') montreErr('debug : ' + err.message);
  }
}

function dessineDebugInterne(p, moi, obsRes) {
  if (!debugActif || !obsRes) return;
  const a = p.agents[moi];
  const e = p.agents[1 - moi];
  const d = obsRes.detail;

  repereMonde();
  ctx.save();

  // ---- rectangle du champ de vision, tel que le teste dansChamp ----
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.setLineDash([12, 8]);
  ctx.strokeRect(a.x - VUE_L / 2, a.y - VUE_H / 2, VUE_L, VUE_H);
  ctx.setLineDash([]);

  // ---- carte de l'ecran ----
  const cw = VUE_L / GRILLE_X, chh = VUE_H / GRILLE_Y;
  const gx0 = a.x - VUE_L / 2, gy0 = a.y - VUE_H / 2;
  for (let j = 0; j < GRILLE_Y; j++) {
    for (let i = 0; i < GRILLE_X; i++) {
      const k = (j * GRILLE_X + i) * N_CANAUX;
      const arbre = d.grille[k], buis = d.grille[k + 1], hors = d.grille[k + 2];
      const x = gx0 + i * cw, y = gy0 + j * chh;
      if (arbre > 0.02) {
        ctx.fillStyle = 'rgba(255,90,70,' + (0.35 * arbre).toFixed(3) + ')';
        ctx.fillRect(x, y, cw, chh);
      }
      if (buis > 0.02) {
        ctx.fillStyle = 'rgba(120,255,140,' + (0.30 * buis).toFixed(3) + ')';
        ctx.fillRect(x, y, cw, chh);
      }
      if (hors > 0.5) {
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(x, y, cw, chh);
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, cw, chh);
    }
  }

  // ---- rayons courts de navigation ----
  ctx.lineWidth = 1.5;
  for (const r of d.rayons) {
    const dx = Math.cos(r.ang), dy = Math.sin(r.ang);
    const proche = r.arbre < PORTEE_RAYON;
    ctx.strokeStyle = proche ? 'rgba(255,160,60,0.8)' : 'rgba(255,255,255,0.14)';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(a.x + dx * r.arbre, a.y + dy * r.arbre);
    ctx.stroke();
  }

  // ---- adversaire ----
  if (e.vivant) {
    if (d.visible) {
      // vu : cadre vert et ligne de visee
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#4ee07a';
      ctx.strokeRect(e.x - R_JOUEUR * 1.5, e.y - R_JOUEUR * 1.5,
                     R_JOUEUR * 3, R_JOUEUR * 3);
      const bloque = bloqueVue(a.x, a.y, e.x, e.y, p.obs);
      ctx.lineWidth = 2;
      ctx.strokeStyle = bloque ? 'rgba(255,90,70,0.6)' : 'rgba(255,255,120,0.8)';
      ctx.setLineDash(bloque ? [6, 6] : []);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(e.x, e.y);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      // perdu de vue : rien vers sa vraie position. Un liere trace
      // gris rappelle juste la verite, il ne fait pas partie de
      // l'observation et sert seulement a verifier le camouflage.
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,90,70,0.30)';
      ctx.setLineDash([4, 8]);
      ctx.strokeRect(e.x - R_JOUEUR * 1.5, e.y - R_JOUEUR * 1.5,
                     R_JOUEUR * 3, R_JOUEUR * 3);
      ctx.setLineDash([]);
    }
  }

  // ---- derniere position connue ----
  if (d.mem.connu && !d.visible) {
    const f = 1 - d.mem.depuis / OUBLI;
    ctx.globalAlpha = Math.max(0.15, f);
    ctx.fillStyle = '#ffd45e';
    ctx.beginPath();
    ctx.arc(d.mem.x, d.mem.y, R_JOUEUR * 0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#fff';
    ctx.font = '700 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.mem.depuis.toFixed(1) + ' s', d.mem.x, d.mem.y - R_JOUEUR * 1.2);
    ctx.textAlign = 'left';
  }

  // ---- buisson de couvert le plus proche ----
  if (d.bp.o) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = d.cache ? 'rgba(120,255,140,0.9)' : 'rgba(120,255,140,0.35)';
    ctx.beginPath();
    ctx.arc(d.bp.o.x, d.bp.o.y, d.bp.o.r * 0.75, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  // ---- panneau de valeurs ----
  repereEcran();
  const L = [
    'entrees        ' + obsRes.v.length + '  (attendu ' + tailleObservation() + ')',
    'camoufle       ' + (d.cache ? 'oui' : 'non'),
    'adversaire     ' + (d.visible ? 'VU' : 'perdu depuis ' + d.mem.depuis.toFixed(1) + ' s'),
    'ligne de tir   ' + (e.vivant && !bloqueVue(a.x, a.y, e.x, e.y, p.obs) ? 'degagee' : 'bloquee'),
    'hors zone      ' + (d.horsZone ? 'OUI' : 'non'),
    'balles vues    ' + d.menaces.length,
    'munitions      ' + a.munitions + (a.rechargement > 0 ? '  (recharge)' : ''),
  ];
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(14, 14, 330, 18 + L.length * 20);
  ctx.font = '500 13px ui-monospace, monospace';
  ctx.fillStyle = '#e8f0e0';
  L.forEach((t, k) => ctx.fillText(t, 26, 36 + k * 20));
  ctx.restore();
}
