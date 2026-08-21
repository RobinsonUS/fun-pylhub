// ===================== calendrier =====================
let ABAR = null;

function calendrier(T, s = 0.008) {
  const f = new Float64Array(T + 1);
  for (let i = 0; i <= T; i++)
    f[i] = Math.pow(Math.cos((i / T + s) / (1 + s) * Math.PI / 2), 2);
  const ab = new Float64Array(T + 1);
  for (let i = 0; i <= T; i++) ab[i] = f[i] / f[0];
  const abar = new Float64Array(T);
  let cum = 1;
  for (let i = 1; i <= T; i++) {
    let beta = 1 - ab[i] / ab[i - 1];
    beta = Math.min(Math.max(beta, 1e-8), 0.999);
    cum *= (1 - beta);
    abar[i - 1] = cum;
  }
  return abar;
}

// ===================== aleatoire =====================
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(n, rng) {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(rng(), 1e-12), v = rng();
    const r = Math.sqrt(-2 * Math.log(u)), th = 2 * Math.PI * v;
    a[i] = r * Math.cos(th);
    if (i + 1 < n) a[i + 1] = r * Math.sin(th);
  }
  return a;
}

// ===================== themes =====================
// couleur visee pour le haut et pour le bas de l'image (RGB 0-255)
const THEMES = {
  aucun:    null,
  foret:    { haut: [185, 200, 210], bas: [ 55,  95,  50] },
  montagne: { haut: [120, 155, 200], bas: [130, 140, 150] },
  desert:   { haut: [155, 190, 215], bas: [200, 165, 110] },
  ocean:    { haut: [165, 195, 220], bas: [ 45, 105, 150] },
  coucher:  { haut: [225, 130,  85], bas: [ 90,  60,  70] },
  neige:    { haut: [200, 215, 235], bas: [225, 232, 240] },
  nuit:     { haut: [ 25,  35,  70], bas: [ 15,  20,  35] },
  prairie:  { haut: [145, 185, 220], bas: [130, 165,  80] },
};

function cibles(nom) {
  const t = THEMES[nom];
  if (!t) return null;
  const conv = (c) => c.map(v => v / 127.5 - 1);
  return { haut: conv(t.haut), bas: conv(t.bas) };
}

// poids vertical lisse : 1 en haut, 0 en bas, transition douce
function poidsHaut(y, H) {
  const u = y / (H - 1);
  const v = Math.min(1, Math.max(0, (0.72 - u) / 0.45));
  return v * v * (3 - 2 * v);      // lissage cubique
}

// deplace la moyenne de couleur de x0 vers celle du theme.
// n'ajoute aucune structure : seules les moyennes du haut et du bas bougent.
function guide(x0, H, W, cib, force) {
  if (!cib || force <= 0) return;
  const hw = H * W;
  const w = new Float32Array(H);
  let sw = 0;
  for (let y = 0; y < H; y++) { w[y] = poidsHaut(y, H); sw += w[y]; }
  const sb = H - sw;

  for (let c = 0; c < 3; c++) {
    const base = c * hw;
    let mh = 0, mb = 0;
    for (let y = 0; y < H; y++) {
      let ligne = 0;
      for (let x = 0; x < W; x++) ligne += x0[base + y * W + x];
      ligne /= W;
      mh += ligne * w[y];
      mb += ligne * (1 - w[y]);
    }
    mh /= sw; mb /= sb;

    const dh = (cib.haut[c] - mh) * force;
    const db = (cib.bas[c]  - mb) * force;
    for (let y = 0; y < H; y++) {
      const d = dh * w[y] + db * (1 - w[y]);
      const b = base + y * W;
      for (let x = 0; x < W; x++) {
        const v = x0[b + x] + d;
        x0[b + x] = v < -1 ? -1 : (v > 1 ? 1 : v);
      }
    }
  }
}

// ===================== sessions =====================
function construitSuite(tDepart, n) {
  if (n < 2) return [tDepart];
  const s = [];
  for (let i = 0; i < n; i++) s.push(Math.floor(tDepart * (1 - i / (n - 1))));
  return s;
}

// opts : {H, W, etapes, theme, influence, graine, depart, tDepart}
function creeSession(opts) {
  const T = ARCHI.T;
  if (!ABAR) ABAR = calendrier(T);

  const H = opts.H, W = opts.W, n = 3 * H * W;
  const graine = (opts.graine == null) ? (Math.random() * 1e9) | 0 : opts.graine;
  const rng = mulberry32(graine);

  let tDepart = T - 1;
  let x = randn(n, rng);           // bruit purement aleatoire, jamais retouche

  if (opts.depart) {
    tDepart = Math.min(T - 1, Math.max(1, opts.tDepart | 0));
    const at = ABAR[tDepart], sa = Math.sqrt(at), s1 = Math.sqrt(1 - at);
    for (let k = 0; k < n; k++) x[k] = sa * opts.depart[k] + s1 * x[k];
  }

  return {
    x, H, W, n, graine, rng,
    suite: construitSuite(tDepart, opts.etapes),
    i: 0, fait: 0,
    cib: opts.depart ? null : cibles(opts.theme),
    force: opts.influence || 0,
  };
}

function sessionFinie(s) { return s.i >= s.suite.length; }

function replanifie(s, etapesRestantes) {
  const t = (s.i < s.suite.length) ? s.suite[s.i] : 0;
  s.suite = construitSuite(t, Math.max(2, etapesRestantes));
  s.i = 0;
}

async function pasSession(s) {
  const t = s.suite[s.i];
  const T = ARCHI.T;

  const bx = bufTemp(s.x);
  const y = avant(bx, t, s.H, s.W);
  const eps = await lire(y.buf, s.n);
  libereTemp(null);

  const at = ABAR[t], sa = Math.sqrt(at), s1a = Math.sqrt(1 - at);
  const x0 = new Float32Array(s.n);
  for (let k = 0; k < s.n; k++) {
    const v = (s.x[k] - s1a * eps[k]) / sa;
    x0[k] = v < -1 ? -1 : (v > 1 ? 1 : v);
  }

  // guidage : fort au debut, nul a la fin
  if (s.cib && s.force > 0) guide(x0, s.H, s.W, s.cib, s.force * (t / T));

  if (s.i + 1 < s.suite.length) {
    const ap = ABAR[s.suite[s.i + 1]], sp = Math.sqrt(ap), s1p = Math.sqrt(1 - ap);
    // on recalcule le bruit implique par le x0 corrige
    for (let k = 0; k < s.n; k++) {
      const e = (s.x[k] - sa * x0[k]) / s1a;
      s.x[k] = sp * x0[k] + s1p * e;
    }
  } else {
    s.x.set(x0);
  }

  s.i++; s.fait++;
  return x0;
}

// ===================== affichage =====================
function versPixels(x, H, W) {
  const d = new Uint8ClampedArray(H * W * 4);
  const hw = H * W;
  for (let i = 0; i < hw; i++) {
    d[i * 4]     = (x[i] + 1) * 127.5;
    d[i * 4 + 1] = (x[hw + i] + 1) * 127.5;
    d[i * 4 + 2] = (x[2 * hw + i] + 1) * 127.5;
    d[i * 4 + 3] = 255;
  }
  return d;
}