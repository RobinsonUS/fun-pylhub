let cv, ctx, LARG = LARG_JEU, HAUT = HAUT_JEU, ECH = 1, DPR = 1;
let ZOOM = 1, PX = 1;          // PX = ZOOM * DPR : pixels reels par unite monde
let calque, cctx;
const cam = { x: MONDE / 2, y: MONDE / 2 };
const ecranJoueur = { x: 0, y: 0 };

function initRendu() {
  cv = document.getElementById('jeu');
  ctx = cv.getContext('2d');
  calque = document.createElement('canvas');
  cctx = calque.getContext('2d');
  redimensionne();
  window.addEventListener('resize', redimensionne);
  chargeIcones();
  cv.focus({ preventScroll: true });
}

function redimensionne() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);

  // la zone de jeu ne change jamais de taille en unites monde
  LARG = LARG_JEU;
  HAUT = HAUT_JEU;
  ECH  = 1;
  VUE_L = LARG_JEU;
  VUE_H = HAUT_JEU;

  // l'image est reduite si la fenetre est plus petite, jamais agrandie
  ZOOM = Math.min(1, window.innerWidth / LARG_JEU,
                     window.innerHeight / HAUT_JEU);
  PX = ZOOM * DPR;

  cv.style.width  = Math.round(LARG_JEU * ZOOM) + 'px';
  cv.style.height = Math.round(HAUT_JEU * ZOOM) + 'px';
  cv.width  = Math.round(LARG_JEU * PX);
  cv.height = Math.round(HAUT_JEU * PX);
}

function repereMonde() {
  ctx.setTransform(PX, 0, 0, PX,
                   PX * (LARG / 2 - cam.x),
                   PX * (HAUT / 2 - cam.y));
}
function repereEcran() { ctx.setTransform(PX, 0, 0, PX, 0, 0); }

function disque(x, y, r, coul) {
  ctx.fillStyle = coul;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ===================== feuillages =====================
function ajouteCheminBlob(x, y, r, lobes, phase, amp) {
  const n = lobes * 14;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (1 + amp * Math.cos(lobes * a + phase));
    const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function cheminBlob(x, y, r, lobes, phase, amp) {
  ctx.beginPath();
  ajouteCheminBlob(x, y, r, lobes, phase, amp);
}

function dessineOmbreArbre(o) {
  const { r, lobes, phase } = o;
  const amp = 0.075;
  const s = o.secousse || 0;
  const x = o.x + (s > 0 ? Math.sin(s * 130) * r * 0.09 * (s / 0.22) : 0);
  const y = o.y + (s > 0 ? Math.cos(s * 155) * r * 0.05 * (s / 0.22) : 0);

  const rayonBase = r * 0.92;
  const epaisseurBande = (R_JOUEUR * 1.35) / 3;

  ctx.save();
  ctx.lineWidth = epaisseurBande;
  ctx.strokeStyle = C.ombre;
  ctx.lineJoin = 'round';
  cheminBlob(x, y, rayonBase + epaisseurBande / 2, lobes, phase, amp);
  ctx.stroke();
  ctx.restore();
}

function dessineArbreTexture(o) {
  const { r, lobes, phase } = o;
  const pal = C.arbres[o.teinte];
  const amp = 0.075;
  const s = o.secousse || 0;
  const x = o.x + (s > 0 ? Math.sin(s * 130) * r * 0.09 * (s / 0.22) : 0);
  const y = o.y + (s > 0 ? Math.cos(s * 155) * r * 0.05 * (s / 0.22) : 0);

  ctx.lineJoin = 'round';
  ctx.lineWidth = r * 0.15;
  ctx.strokeStyle = C.traitArbre;
  cheminBlob(x, y, r * 0.92, lobes, phase, amp);
  ctx.stroke();

  ctx.fillStyle = pal.ext;
  cheminBlob(x, y, r * 0.92, lobes, phase, amp);
  ctx.fill();

  ctx.fillStyle = pal.int;
  cheminBlob(x, y, r * 0.58, lobes, phase, amp * 1.4);
  ctx.fill();

  ctx.fillStyle = pal.tache;
  for (const t of o.taches) {
    ctx.save();
    ctx.translate(x + Math.cos(t.a) * r * t.d, y + Math.sin(t.a) * r * t.d);
    ctx.rotate(t.t);
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.11, r * 0.055, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function dessineSouche(o) {
  const { x, y, r, lobes, phase } = o;
  const amp = 0.075;
  ctx.fillStyle = C.souche;
  cheminBlob(x, y, r * 0.92, lobes, phase, amp);
  ctx.fill();
}

function dessineOmbreBuisson(o) {
  const { x, y, r, phase } = o;
  const lobes = 8, amp = 0.135;
  const rayonBase = r * 0.90;
  const epaisseurBande = (R_JOUEUR * 1.35) / 3;

  ctx.save();
  ctx.lineWidth = epaisseurBande;
  ctx.strokeStyle = C.ombre;
  ctx.lineJoin = 'round';
  cheminBlob(x, y, rayonBase + epaisseurBande / 2, lobes, phase, amp);
  ctx.stroke();
  ctx.restore();
}

function dessineBuissonTexture(o) {
  const { x, y, r, phase } = o;
  const B = C.buisson;
  const lobes = 8, amp = 0.135;

  ctx.lineJoin = 'round';
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = B.trait;
  cheminBlob(x, y, r * 0.90, lobes, phase, amp);
  ctx.stroke();

  ctx.fillStyle = B.ext;
  cheminBlob(x, y, r * 0.90, lobes, phase, amp);
  ctx.fill();

  ctx.fillStyle = B.int;
  cheminBlob(x, y, r * 0.62, lobes, phase, amp * 0.8);
  ctx.fill();

  ctx.fillStyle = B.tache;
  cheminBlob(x, y, r * 0.13, lobes, phase, 0.30);
  ctx.fill();
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(x, y + s * r * 0.42, r * 0.09, r * 0.19, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ===================== balle =====================
function dessineBalle(b) {
  const ang = (b.ang !== undefined) ? b.ang : Math.atan2(b.vy, b.vx);
  const L = L_BALLE, W = R_BALLE;

  const a = Math.max(0, Math.min(1, b.reste / FONDU_BALLE));
  if (a <= 0) return;

  ctx.save();
  ctx.globalAlpha = a;

  const distParcourue = PORTEE - b.reste;
  const longTrainee = Math.min(180, distParcourue);

  if (longTrainee > 0) {
    const tailX = b.x - Math.cos(ang) * longTrainee;
    const tailY = b.y - Math.sin(ang) * longTrainee;

    const grad = ctx.createLinearGradient(tailX, tailY, b.x, b.y);
    grad.addColorStop(0, 'rgba(200, 200, 200, 0)');
    grad.addColorStop(1, 'rgba(210, 210, 210, 0.25)');

    ctx.beginPath();
    ctx.moveTo(tailX, tailY);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = W * 1.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = grad;
    ctx.stroke();
  }

  ctx.translate(b.x, b.y);
  ctx.rotate(ang);

  ctx.fillStyle = C.ombre;
  ctx.beginPath();
  ctx.ellipse(0, 0, L, W, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-L, -W);
  ctx.lineTo(L * 0.25, -W);
  ctx.quadraticCurveTo(L, -W * 0.85, L, 0);
  ctx.quadraticCurveTo(L, W * 0.85, L * 0.25, W);
  ctx.lineTo(-L, W);
  ctx.closePath();
  ctx.lineWidth = W * 0.45;
  ctx.strokeStyle = C.traitB;
  ctx.stroke();
  ctx.fillStyle = C.balle;
  ctx.fill();

  ctx.restore();
}

// ===================== arme et ombre d'arme =====================
function trapeze(y0, y1, l0, l1, r) {
  const a = l0 / 2, b = l1 / 2;
  ctx.beginPath();
  ctx.moveTo(-a + r, y0);
  ctx.lineTo(a - r, y0);
  ctx.quadraticCurveTo(a, y0, a, y0 - r);
  ctx.lineTo(b, y1 + r);
  ctx.quadraticCurveTo(b, y1, b - r, y1);
  ctx.lineTo(-b + r, y1);
  ctx.quadraticCurveTo(-b, y1, -b, y1 + r);
  ctx.lineTo(-a, y0 - r);
  ctx.quadraticCurveTo(-a, y0, -a + r, y0);
  ctx.closePath();
}

function segment(y0, y1, l0, l1, r, coul, ep) {
  ctx.lineWidth = ep;
  ctx.strokeStyle = C.traitP;
  trapeze(y0, y1, l0, l1, r);
  ctx.stroke();
  ctx.fillStyle = coul;
  ctx.fill();
}

function dessineArme(R) {
  ctx.save();
  ctx.lineJoin = 'round';
  const ep = R * 0.16;

  segment(-R * 0.80, -R * 1.10, R * 0.32, R * 0.32, R * 0.04, C.armeOr,    ep);
  segment(-R * 1.10, -R * 1.38, R * 0.34, R * 0.34, R * 0.04, C.armeMauve, ep);
  segment(-R * 1.38, -R * 1.72, R * 0.38, R * 0.38, R * 0.05, C.armeBleu,  ep);
  segment(-R * 1.72, -R * 2.35, R * 0.42, R * 0.34, R * 0.06, C.armeOr,    ep);
  segment(-R * 2.35, -R * 2.56, R * 0.22, R * 0.20, R * 0.04, C.armeMauve, ep * 0.9);
  segment(-R * 2.56, -R * 3.05, R * 0.12, R * 0.11, R * 0.03, C.canon,     ep * 0.7);

  ctx.restore();
}

function dessineOmbreArme(R) {
  ctx.save();
  ctx.lineJoin = 'round';
  const ep = R * 0.28;
  const coulOmbre = C.ombre;

  const segOmbre = (y0, y1, l0, l1, r) => {
    ctx.lineWidth = ep;
    ctx.strokeStyle = C.ombre;
    trapeze(y0, y1, l0 * 1.32, l1 * 1.32, r);
    ctx.stroke();
    ctx.fillStyle = coulOmbre;
    ctx.fill();
  };

  segOmbre(-R * 0.80, -R * 1.10, R * 0.32, R * 0.32, R * 0.04);
  segOmbre(-R * 1.10, -R * 1.38, R * 0.34, R * 0.34, R * 0.04);
  segOmbre(-R * 1.38, -R * 1.72, R * 0.38, R * 0.38, R * 0.05);
  segOmbre(-R * 1.72, -R * 2.35, R * 0.42, R * 0.34, R * 0.06);
  segOmbre(-R * 2.35, -R * 2.56, R * 0.22, R * 0.20, R * 0.04);
  segOmbre(-R * 2.56, -R * 3.05, R * 0.12, R * 0.11, R * 0.03);

  ctx.restore();
}

// ===================== personnage =====================
function rectOriente(x0, y0, x1, y1, larg) {
  const dx = x1 - x0, dy = y1 - y0;
  const d = Math.hypot(dx, dy) || 1;
  const nx = -dy / d * (larg / 2), ny = dx / d * (larg / 2);
  ctx.beginPath();
  ctx.moveTo(x0 + nx, y0 + ny);
  ctx.lineTo(x1 + nx, y1 + ny);
  ctx.lineTo(x1 - nx, y1 - ny);
  ctx.lineTo(x0 - nx, y0 - ny);
  ctx.closePath();
}

function dessineOmbrePerso(x, y, angle, secousse, arme, recul) {
  const R = R_JOUEUR;
  const s = secousse || 0;
  const dx = s > 0 ? Math.sin(s * 190) * R * 0.09 * (s / 0.16) : 0;
  const dy = s > 0 ? Math.cos(s * 220) * R * 0.05 * (s / 0.16) : 0;

  const rec = recul || 0;
  const reculDist = rec > 0 ? (rec / 0.08) * 8 : 0;
  const rx = Math.cos(angle) * reculDist;
  const ry = Math.sin(angle) * reculDist;

  const posX = x + dx - rx;
  const posY = y + dy - ry;

  ctx.save();
  ctx.translate(posX, posY);

  ctx.fillStyle = C.ombre;
  ctx.beginPath();
  ctx.arc(0, 0, R * 1.25, 0, Math.PI * 2);
  ctx.arc(0, 0, R, 0, Math.PI * 2, true);
  ctx.fill();

  if (arme) {
    ctx.rotate(angle + Math.PI / 2);
    dessineOmbreArme(R);
  }

  ctx.restore();
}

function dessinePerso(x, y, angle, coul, secousse, touche, arme, recul) {
  const R = R_JOUEUR;
  const noir = C.traitP;
  const rm = R * 0.42;
  const ep = R * 0.24;
  const largBras = rm * 2 * 0.75;

  const s = secousse || 0;
  const dx = s > 0 ? Math.sin(s * 190) * R * 0.09 * (s / 0.16) : 0;
  const dy = s > 0 ? Math.cos(s * 220) * R * 0.05 * (s / 0.16) : 0;

  const rec = recul || 0;
  const reculDist = rec > 0 ? (rec / 0.08) * 8 : 0;
  const rx = Math.cos(angle) * reculDist;
  const ry = Math.sin(angle) * reculDist;

  const posX = x + dx - rx;
  const posY = y + dy - ry;

  ctx.save();
  ctx.translate(posX, posY);

  const t = touche || 0;
  if (t > 0) {
    const a = t / 0.30;
    const g = ctx.createRadialGradient(0, 0, R * 0.8, 0, 0, R * 1.9);
    g.addColorStop(0, 'rgba(230,60,50,' + (0.42 * a).toFixed(3) + ')');
    g.addColorStop(1, 'rgba(230,60,50,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, R * 1.9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.rotate(angle + Math.PI / 2);

  ctx.lineJoin = 'round';
  ctx.lineWidth = ep;
  ctx.strokeStyle = noir;

  if (!arme) {
    for (const c of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(c * R * 0.66, -R * 0.62, R * 0.46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = C.main;
      ctx.fill();
    }
  } else {
    const mg = { x: -R * 0.14, y: -R * 1.62 };
    const att = { x: -R * 0.04, y: -R * 0.30 };

    ctx.beginPath();
    ctx.arc(R * 0.42, -R * 1.00, rm, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = C.main;
    ctx.fill();

    rectOriente(att.x, att.y, mg.x, mg.y, largBras);
    ctx.stroke();
    ctx.fillStyle = C.bras;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(mg.x, mg.y, rm, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = C.main;
    ctx.fill();

    dessineArme(R);
  }

  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fillStyle = coul;
  ctx.fill();
  ctx.lineWidth = R * 0.21;
  ctx.strokeStyle = noir;
  ctx.stroke();

  ctx.restore();
}

// Jauge de rechargement, posee au sol sous le joueur
function dessineSphereChargement(j) {
  if (!j.rechargement || j.rechargement <= 0) return;

  const total = j.dureeRechargeMax || 1.4;
  const prog  = Math.max(0, Math.min(1, 1 - j.rechargement / total));

  const R  = R_JOUEUR * 0.98;
  const cx = j.x;
  const cy = j.y + R_JOUEUR * 2.75;
  const TAU = Math.PI * 2;

  ctx.save();

  // ombre aussi fine que celle du joueur
  const eb = R_JOUEUR * 0.25;
  ctx.lineWidth = eb;
  ctx.strokeStyle = C.ombre;
  ctx.beginPath();
  ctx.arc(cx, cy, R + eb / 2, 0, TAU);
  ctx.stroke();

  // disque vert sombre
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, TAU);
  ctx.fillStyle = 'rgba(58, 82, 40, 0.88)';
  ctx.fill();

  // arc de progression, en contour interieur
  const ea = R * 0.17;
  ctx.lineWidth = ea;
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, R - ea / 2, -Math.PI / 2, -Math.PI / 2 + prog * TAU);
  ctx.stroke();

  // temps restant, une decimale, virgule francaise
  const txt = j.rechargement.toFixed(1).replace('.', ',');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '800 ' + Math.round(R * 0.68) +
             'px system-ui, -apple-system, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(txt, cx, cy + R * 0.03);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

function dessineJoueur(p, j, coul, alpha, decoupe, gch, hau, demiL, demiH, arme,
                       textureSeule = false) {
  const direct = (alpha >= 1);
  const memeCtx = ctx;
  let px = 0;

  if (!direct) {
    // calque a la taille du personnage, pas de l'ecran :
    // sinon on recopie 3 millions de pixels quatre fois par image
    px = Math.max(2, Math.ceil(2 * R_SPRITE * PX));
    if (calque.width !== px) { calque.width = px; calque.height = px; }
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.clearRect(0, 0, px, px);
    cctx.setTransform(PX, 0, 0, PX, px / 2 - j.x * PX, px / 2 - j.y * PX);
    ctx = cctx;
  }

  ctx.save();
  if (decoupe) {
    ctx.beginPath();
    ctx.rect(gch - 200, hau - 200, demiL * 2 + 400, demiH * 2 + 400);
    ctx.clip();
  }

  if (textureSeule) {
    dessinePerso(j.x, j.y, j.angle, coul, j.secousse, j.touche, arme, j.recul);
  } else {
    dessineOmbrePerso(j.x, j.y, j.angle, j.secousse, arme, j.recul);
  }

  ctx.restore();

  if (!direct) {
    ctx = memeCtx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(calque,
                  PX * (LARG / 2 - cam.x) + j.x * PX - px / 2,
                  PX * (HAUT / 2 - cam.y) + j.y * PX - px / 2);
    ctx.restore();
    repereMonde();
  }
}

// ===================== viseur =====================
function traitsViseur(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.moveTo(x - r - 9, y); ctx.lineTo(x - r + 2, y);
  ctx.moveTo(x + r - 2, y); ctx.lineTo(x + r + 9, y);
  ctx.moveTo(x, y - r - 9); ctx.lineTo(x, y - r + 2);
  ctx.moveTo(x, y + r - 2); ctx.lineTo(x, y + r + 9);
  ctx.stroke();
}

function dessineViseur(x, y) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  traitsViseur(x, y, 14);
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#ffffff';
  traitsViseur(x, y, 14);
  ctx.restore();
}

// ===================== barre de vie =====================
function dessineBarrePV(pv) {
  const larg = 312, haut = 45, rc = 9;
  const x = 28, y = HAUT - haut - 52;
  const bas = pv < 30;

  const cadre = (x0, y0, l, h, rr) => {
    ctx.beginPath();
    ctx.moveTo(x0 + rr, y0);
    ctx.lineTo(x0 + l - rr, y0);
    ctx.quadraticCurveTo(x0 + l, y0, x0 + l, y0 + rr);
    ctx.lineTo(x0 + l, y0 + h - rr);
    ctx.quadraticCurveTo(x0 + l, y0 + h, x0 + l - rr, y0 + h);
    ctx.lineTo(x0 + rr, y0 + h);
    ctx.quadraticCurveTo(x0, y0 + h, x0, y0 + h - rr);
    ctx.lineTo(x0, y0 + rr);
    ctx.quadraticCurveTo(x0, y0, x0 + rr, y0);
    ctx.closePath();
  };

  ctx.lineJoin = 'round';
  cadre(x, y, larg, haut, rc);
  ctx.fillStyle = bas ? C.pvRougeVide : C.pvVertVide;
  ctx.fill();

  const f = Math.max(0, Math.min(1, pv / PV_MAX));
  if (f > 0) {
    ctx.save();
    cadre(x, y, larg, haut, rc);
    ctx.clip();
    ctx.fillStyle = bas ? C.pvRouge : C.pvVert;
    ctx.fillRect(x, y, larg * f, haut);
    ctx.restore();
  }

  cadre(x, y, larg, haut, rc);
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.pvTrait;
  ctx.stroke();

  const n = String(Math.max(0, Math.ceil(pv)));
  ctx.textBaseline = 'middle';
  ctx.font = '700 18px system-ui, -apple-system, sans-serif';
  const ty = y + haut / 2 + 1;
  let tx = x + 12;

  ctx.fillStyle = '#ffffff';
  ctx.fillText(n, tx, ty);
  tx += ctx.measureText(n).width;

  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fillText(' / ' + PV_MAX, tx, ty);

  ctx.textBaseline = 'alphabetic';
}

// ===================== inventaire =====================
function zonesInv() {
  const w = 72, gap = 12;
  const total = NB_SLOTS * w + (NB_SLOTS - 1) * gap;
  const x0 = (LARG - total) / 2;
  const y0 = HAUT - w - 46;
  const z = [];
  for (let i = 0; i < NB_SLOTS; i++)
    z.push({ i, x: x0 + i * (w + gap), y: y0, w, h: w });
  return z;
}

function cadreArrondi(x, y, l, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + l - r, y);
  ctx.quadraticCurveTo(x + l, y, x + l, y + r);
  ctx.lineTo(x + l, y + h - r);
  ctx.quadraticCurveTo(x + l, y + h, x + l - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const NOMS_ICONES = ['mains', 'fusil'];
const EXTENSIONS  = ['png', 'webp', 'jpg', 'jpeg', 'svg'];
const ICONES = {};
let etatIcones = 'icones : chargement...';
let etatIconesOk = false;

function chargeUneImage(url, delai = 1200) {
  return new Promise((ok, ko) => {
    const im = new Image();
    let fini = false;
    const t = setTimeout(() => { if (!fini) { fini = true; ko(0); } }, delai);
    im.onload = () => {
      if (fini) return;
      fini = true; clearTimeout(t);
      im.naturalWidth > 0 ? ok(im) : ko(0);
    };
    im.onerror = () => { if (!fini) { fini = true; clearTimeout(t); ko(0); } };
    im.src = url;
  });
}

function cheminsPossibles(nom, ext) {
  const rel = 'img/' + nom + '.' + ext;
  const l = [rel, './' + rel];
  try { l.push(new URL(rel, document.baseURI).href); } catch (e) {}
  try {
    const d = location.pathname.replace(/[^/]*$/, '');
    l.push(location.origin + d + rel);
  } catch (e) {}
  return l;
}

async function chargeIcones() {
  const etat = {};
  for (const nom of NOMS_ICONES) etat[nom] = '...';

  const majEtat = () => {
    etatIcones = 'icones : ' +
      NOMS_ICONES.map(n => n + ' ' + etat[n]).join('   |   ');
    etatIconesOk = NOMS_ICONES.every(n => ICONES[n]);
  };
  majEtat();

  await Promise.all(NOMS_ICONES.map(async (nom) => {
    for (const ext of EXTENSIONS) {
      for (const base of cheminsPossibles(nom, ext)) {
        try {
          ICONES[nom] = await chargeUneImage(base);
          etat[nom] = 'ok';
          majEtat();
          return;
        } catch (e) { /* chemin suivant */ }
      }
    }
    etat[nom] = 'INTROUVABLE';
    majEtat();
  }));

  if (!etatIconesOk && typeof montreErr === 'function') montreErr(etatIcones);
  return etatIcones;
}

function dessineImageIcone(img, x, y, w, h) {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;

  if (!nw || !nh) {
    ctx.drawImage(img, x, y, w, h);
    return;
  }

  const scale = Math.max(w / nw, h / nh);
  const destW = nw * scale;
  const destH = nh * scale;
  const destX = x + (w - destW) / 2;
  const destY = y + (h - destH) / 2;

  ctx.drawImage(img, destX, destY, destW, destH);
}

function dessineIcone(nom, x, y, w, h) {
  const img = ICONES[nom];
  if (img) dessineImageIcone(img, x, y, w, h);
}

function contenuSlot(inv, i) {
  return i === 0 ? 'mains' : inv[i];
}

function caseInv(x, y, w, h, pleine, objet, munitions, rechargement) {
  const r = 8;

  ctx.save();
  cadreArrondi(x, y, w, h, r);
  ctx.clip();

  if (objet) {
    dessineIcone(objet, x, y, w, h);
  }
  ctx.restore();

  cadreArrondi(x + 1.5, y + 1.5, w - 3, h - 3, Math.max(2, r - 2));
  ctx.lineWidth = 3;
  ctx.strokeStyle = C.invBord;
  ctx.stroke();

  if (objet && objet !== 'mains') {
    ctx.save();
    ctx.font = '700 13px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';

    const texteMun = String(munitions);
    const tx = x + w - 8;
    const ty = y + h - 6;

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(texteMun, tx, ty);

    ctx.fillStyle = '#ffffff';
    ctx.fillText(texteMun, tx, ty);
    ctx.restore();
  }
}

function dessineInventaire(agent, slot, drag) {
  const zs = zonesInv();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  for (const z of zs) {
    const sel = (z.i === slot);
    const g = sel ? 4 : 0;
    const enVol = drag && drag.depuis === z.i;
    const objet = enVol ? null : contenuSlot(agent.inv, z.i);

    caseInv(z.x - g, z.y - g, z.w + g * 2, z.h + g * 2,
            !!objet, objet, agent.munitions, agent.rechargement);

    const bw = 22, bh = 17;
    const bx = z.x + z.w / 2 - bw / 2, by = z.y + z.h + 10;
    cadreArrondi(bx, by, bw, bh, 5);
    ctx.fillStyle = C.invNumFond;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = C.invNumBord;
    ctx.stroke();
    ctx.font = '700 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(z.i + 1), bx + bw / 2, by + bh / 2 + 1);
  }

  if (drag && drag.objet) {
    const w = zs[0].w;
    ctx.globalAlpha = 0.92;
    caseInv(drag.x - w / 2, drag.y - w / 2, w, w, true, drag.objet,
            agent.munitions, agent.rechargement);
    ctx.globalAlpha = 1;
  }

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ===================== scene =====================
function dessine(p, moi, viseur, drag) {
  const a = p.agents[moi];
  cam.x = a.x;
  cam.y = a.y;

  repereEcran();
  ctx.fillStyle = C.dehors;
  ctx.fillRect(0, 0, LARG, HAUT);

  repereMonde();
  ecranJoueur.x = LARG / 2;
  ecranJoueur.y = HAUT / 2;

  const demiL = LARG / 2, demiH = HAUT / 2;
  const gch = cam.x - demiL, drt = cam.x + demiL;
  const hau = cam.y - demiH, bas = cam.y + demiH;

  ctx.fillStyle = C.sol;
  ctx.fillRect(0, 0, MONDE, MONDE);

  const grille = () => {
    ctx.beginPath();
    for (let x = Math.floor(gch / CELL) * CELL; x < drt + CELL; x += CELL) {
      ctx.moveTo(x, hau); ctx.lineTo(x, bas + CELL);
    }
    for (let y = Math.floor(hau / CELL) * CELL; y < bas + CELL; y += CELL) {
      ctx.moveTo(gch, y); ctx.lineTo(drt + CELL, y);
    }
    ctx.stroke();
  };
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = C.ligneDehors;
  grille();
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, MONDE, MONDE);
  ctx.clip();
  ctx.strokeStyle = C.ligne;
  grille();
  ctx.restore();

  const visible = (o) =>
    o.x > gch - o.r * 1.4 && o.x < drt + o.r * 1.4 &&
    o.y > hau - o.r * 1.4 && o.y < bas + o.r * 1.4;

  // traces au sol : sous absolument tout le reste
  for (const o of p.obs)
    if (o.type === 'souche' && visible(o)) dessineSouche(o);

  // ombres du decor
  for (const o of p.obs) {
    if (!visible(o)) continue;
    if (o.type === 'arbre') dessineOmbreArbre(o);
    else if (o.type === 'buisson') dessineOmbreBuisson(o);
  }

  const moiCache = dansBuisson(a.x, a.y, p.obs);

  // ---- etat visuel de chaque joueur, calcule une seule fois ----
  for (let i = 0; i < 2; i++) {
    const j = p.agents[i];
    if (!j.vivant) continue;
    const sien = (i === moi);
    if (j.alphaVis === undefined) j.alphaVis = 1;

    let dansUnBuisson = false;
    let buissonPartage = false;      // je touche le buisson ou il se cache

    for (const o of p.obs) {
      if (o.type !== 'buisson') continue;
      const dJ = Math.hypot(o.x - j.x, o.y - j.y);
      const dM = Math.hypot(o.x - a.x, o.y - a.y);
      if (dJ < o.r * 0.75) dansUnBuisson = true;
      if (dJ < o.r * 0.75 && dM < o.r + R_JOUEUR) buissonPartage = true;
    }

    // tirer ou encaisser trahit la position
    const trahi = j.revele > 0;

    let cible = 1.0;
    if (sien) {
      cible = dansUnBuisson ? (trahi ? 1.0 : 0.4) : 1.0;
    } else if (dansUnBuisson) {
      // la transparence ne concerne que ce qui est camoufle
      cible = (trahi || buissonPartage) ? 0.5 : 0.0;
    } else {
      cible = 1.0;
    }

    j.alphaVis += (cible - j.alphaVis) * 0.16;

    // un joueur repere dans un buisson doit se voir en ENTIER :
    // on le dessine alors par dessus le feuillage
    j._dessus = !sien && dansUnBuisson && (trahi || buissonPartage);
    j._decoupe = !sien && !moiCache && !buissonPartage;
    j._arme = !!j.inv[j.slot];
  }

  // ---- joueurs caches par la vegetation : sous le feuillage ----
  const pose = (dessus, texture) => {
    for (let i = 0; i < 2; i++) {
      const j = p.agents[i];
      if (!j.vivant || !!j._dessus !== dessus) continue;
      dessineJoueur(p, j, C.perso, j.alphaVis, j._decoupe,
                    gch, hau, demiL, demiH, j._arme, texture);
    }
  };

  pose(false, false);
  pose(false, true);

  // jauges de rechargement : posees au sol, hors du calque des
  // personnages, sinon elles seraient tronquees par ses bords
  for (const j of p.agents)
    if (j.vivant) dessineSphereChargement(j);

  // ---- particules ----
  for (const q of p.particules) {
    const alphaVal = Math.max(0, Math.min(1, q.vie / q.vieMax));
    ctx.save();
    ctx.globalAlpha = alphaVal;

    if (q.type === 'flamme') {
      ctx.translate(q.x, q.y);
      ctx.rotate(q.ang);
      ctx.scale(0.6 + 0.4 * alphaVal, alphaVal);

      ctx.fillStyle = '#ff6a00';
      ctx.beginPath();
      ctx.moveTo(0, -q.r * 0.4);
      ctx.quadraticCurveTo(q.r * 1.0, -q.r * 0.8, q.r * 2.5, 0);
      ctx.quadraticCurveTo(q.r * 1.0, q.r * 0.8, 0, q.r * 0.4);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffcc00';
      ctx.beginPath();
      ctx.moveTo(0, -q.r * 0.2);
      ctx.quadraticCurveTo(q.r * 0.6, -q.r * 0.4, q.r * 1.6, 0);
      ctx.quadraticCurveTo(q.r * 0.6, q.r * 0.4, 0, q.r * 0.2);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(q.r * 0.3, 0, q.r * 0.3, q.r * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();

    } else if (q.type === 'etincelle') {
      const vitesse = Math.hypot(q.vx, q.vy);
      ctx.translate(q.x, q.y);
      ctx.rotate(Math.atan2(q.vy, q.vx));

      const longueur  = (vitesse * 0.035 + q.r) * alphaVal;
      const epaisseur = q.r * 0.6 * alphaVal;

      ctx.fillStyle = '#ff6a00';
      ctx.beginPath();
      ctx.ellipse(0, 0, longueur, epaisseur * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffdd66';
      ctx.beginPath();
      ctx.ellipse(0, 0, longueur * 0.7, epaisseur, 0, 0, Math.PI * 2);
      ctx.fill();

    } else {
      disque(q.x, q.y + q.r * 0.5, q.r, C.eclatOmb);
      disque(q.x, q.y, q.r, C.eclat);
    }

    ctx.restore();
  }

  for (const b of p.balles) dessineBalle(b);

  // ---- vegetation ----
  for (const o of p.obs)
    if (o.type === 'arbre' && visible(o)) dessineArbreTexture(o);

  for (const o of p.obs) {
    if (o.type !== 'buisson' || !visible(o)) continue;
    const touchePar = (j) => Math.hypot(o.x - j.x, o.y - j.y) < o.r + R_JOUEUR;
    // le feuillage s'estompe si je le traverse, ou s'il abrite un repere
    let clair = touchePar(a);
    for (const j of p.agents)
      if (j.vivant && j.revele > 0 &&
          Math.hypot(o.x - j.x, o.y - j.y) < o.r * 0.75) clair = true;

    if (o.alphaVis === undefined) o.alphaVis = 1;
    o.alphaVis += ((clair ? 0.5 : 1) - o.alphaVis) * 0.16;
    ctx.globalAlpha = o.alphaVis;
    dessineBuissonTexture(o);
    ctx.globalAlpha = 1;
  }

  // ---- joueurs reperes dans un buisson : par dessus le feuillage ----
  pose(true, false);
  pose(true, true);

  // ---- oeil du cyclone ----
  ctx.save();
  ctx.beginPath();
  ctx.rect(gch - 100, hau - 100, demiL * 2 + 200, demiH * 2 + 200);
  ctx.arc(p.zone.x, p.zone.y, p.zone.r, 0, Math.PI * 2, true);
  ctx.fillStyle = C.horsZone;
  ctx.fill('evenodd');
  ctx.restore();

  ctx.strokeStyle = C.zone;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.arc(p.zone.x, p.zone.y, p.zone.r, 0, Math.PI * 2);
  ctx.stroke();

  // ---- interface ----
  repereEcran();
  dessineBarrePV(p.agents[moi].pv);
  if (p.agents[moi].inv)
    dessineInventaire(p.agents[moi], p.agents[moi].slot, drag);

  if (!etatIconesOk) {
    ctx.font = '600 12px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(etatIcones, 14, 22);
  }

  if (viseur) dessineViseur(viseur.x, viseur.y);
}
