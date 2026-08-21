const GPU_POIDS = new Map();

function gpuPoids(nom) {
  const cle = VARIANTE + '|' + nom;
  if (!GPU_POIDS.has(cle)) GPU_POIDS.set(cle, bufDepuis(POIDS[nom].donnees));
  return GPU_POIDS.get(cle);
}

function libereVariante(cle) {
  if (!cle) return;
  const prefixe = cle + '|';
  for (const [k, b] of [...GPU_POIDS]) {
    if (k.startsWith(prefixe)) { b.destroy(); GPU_POIDS.delete(k); }
  }
}

// ===================== Convolution naive (pas 2, Cout non multiple de 4) =====================
const WGSL_CONV = `
struct P { Cin:u32, Cout:u32, H:u32, W:u32, K:u32, st:u32, pad:u32, Ho:u32, Wo:u32, n:u32, r0:u32, r1:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  let gid = g.x;
  if (gid >= p.n) { return; }
  let ox = gid % p.Wo;
  let oy = (gid / p.Wo) % p.Ho;
  let oc = gid / (p.Wo * p.Ho);
  var acc = b[oc];
  for (var ic = 0u; ic < p.Cin; ic = ic + 1u) {
    for (var ky = 0u; ky < p.K; ky = ky + 1u) {
      let iy = i32(oy * p.st) - i32(p.pad) + i32(ky);
      if (iy < 0 || iy >= i32(p.H)) { continue; }
      for (var kx = 0u; kx < p.K; kx = kx + 1u) {
        let ix = i32(ox * p.st) - i32(p.pad) + i32(kx);
        if (ix < 0 || ix >= i32(p.W)) { continue; }
        acc = acc + x[ic * p.H * p.W + u32(iy) * p.W + u32(ix)]
                  * w[((oc * p.Cin + ic) * p.K + ky) * p.K + kx];
      }
    }
  }
  y[gid] = acc;
}`;

// ===================== Convolution 1x1 : 4 canaux par fil =====================
const WGSL_CONV1 = `
struct P { Cin:u32, Cout:u32, HW:u32, n:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  let s = g.x % p.HW;
  let ob = (g.x / p.HW) * 4u;
  let r0 = ob * p.Cin; let r1 = r0 + p.Cin;
  let r2 = r1 + p.Cin; let r3 = r2 + p.Cin;
  var a0 = 0.0; var a1 = 0.0; var a2 = 0.0; var a3 = 0.0;
  for (var ic = 0u; ic < p.Cin; ic = ic + 1u) {
    let v = x[ic * p.HW + s];
    a0 = a0 + v * w[r0 + ic];
    a1 = a1 + v * w[r1 + ic];
    a2 = a2 + v * w[r2 + ic];
    a3 = a3 + v * w[r3 + ic];
  }
  y[ob * p.HW + s] = a0 + b[ob];
  y[(ob + 1u) * p.HW + s] = a1 + b[ob + 1u];
  y[(ob + 2u) * p.HW + s] = a2 + b[ob + 2u];
  y[(ob + 3u) * p.HW + s] = a3 + b[ob + 3u];
}`;

// ===================== Convolution 3x3 pas 1 : tuile 8x8, 4 canaux par fil =====================
const WGSL_CONV3 = `
struct P { Cin:u32, Cout:u32, H:u32, W:u32, TX:u32, TY:u32, r0:u32, r1:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;

var<workgroup> sh: array<f32, 100>;
var<workgroup> shw: array<f32, 36>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>,
        @builtin(local_invocation_id) li: vec3<u32>) {
  let tid = li.x;
  let wid = wg.x;
  let tx = wid % p.TX;
  let ty = (wid / p.TX) % p.TY;
  let ob = (wid / (p.TX * p.TY)) * 4u;
  let oxl = tid % 8u;
  let oyl = tid / 8u;

  var a0 = 0.0; var a1 = 0.0; var a2 = 0.0; var a3 = 0.0;

  for (var ic = 0u; ic < p.Cin; ic = ic + 1u) {
    var idx = tid;
    loop {
      if (idx >= 100u) { break; }
      let iy = i32(ty * 8u) - 1 + i32(idx / 10u);
      let ix = i32(tx * 8u) - 1 + i32(idx % 10u);
      var v = 0.0;
      if (iy >= 0 && iy < i32(p.H) && ix >= 0 && ix < i32(p.W)) {
        v = x[ic * p.H * p.W + u32(iy) * p.W + u32(ix)];
      }
      sh[idx] = v;
      idx = idx + 64u;
    }
    if (tid < 36u) {
      shw[tid] = w[((ob + tid / 9u) * p.Cin + ic) * 9u + (tid % 9u)];
    }
    workgroupBarrier();

    for (var ky = 0u; ky < 3u; ky = ky + 1u) {
      let r = (oyl + ky) * 10u + oxl;
      let v0 = sh[r]; let v1 = sh[r + 1u]; let v2 = sh[r + 2u];
      let o = ky * 3u;
      a0 = a0 + v0 * shw[o] + v1 * shw[o + 1u] + v2 * shw[o + 2u];
      a1 = a1 + v0 * shw[9u + o] + v1 * shw[10u + o] + v2 * shw[11u + o];
      a2 = a2 + v0 * shw[18u + o] + v1 * shw[19u + o] + v2 * shw[20u + o];
      a3 = a3 + v0 * shw[27u + o] + v1 * shw[28u + o] + v2 * shw[29u + o];
    }
    workgroupBarrier();
  }

  let hw = p.H * p.W;
  let d = (ty * 8u + oyl) * p.W + (tx * 8u + oxl);
  y[ob * hw + d] = a0 + b[ob];
  y[(ob + 1u) * hw + d] = a1 + b[ob + 1u];
  y[(ob + 2u) * hw + d] = a2 + b[ob + 2u];
  y[(ob + 3u) * hw + d] = a3 + b[ob + 3u];
}`;

// ===================== Convolution 3x3 pas 1 : tuile 16x16, 16 sorties par fil =====================
const WGSL_CONV3B = `
struct P { Cin:u32, Cout:u32, H:u32, W:u32, TX:u32, TY:u32, r0:u32, r1:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;

var<workgroup> sh: array<f32, 1296>;
var<workgroup> shw: array<f32, 144>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>,
        @builtin(local_invocation_id) li: vec3<u32>) {
  let tid = li.x;
  let wid = wg.x;
  let tx  = wid % p.TX;
  let ty  = (wid / p.TX) % p.TY;
  let ob  = (wid / (p.TX * p.TY)) * 4u;
  let txl = tid % 8u;
  let tyl = tid / 8u;
  let bx0 = tx * 16u;
  let by0 = ty * 16u;

  var a0=0.0; var a1=0.0; var a2=0.0; var a3=0.0;
  var a4=0.0; var a5=0.0; var a6=0.0; var a7=0.0;
  var a8=0.0; var a9=0.0; var a10=0.0; var a11=0.0;
  var a12=0.0; var a13=0.0; var a14=0.0; var a15=0.0;

  for (var ic0 = 0u; ic0 < p.Cin; ic0 = ic0 + 4u) {
    var idx = tid;
    loop {
      if (idx >= 1296u) { break; }
      let ch = idx / 324u;
      let r  = idx % 324u;
      let iy = i32(by0) - 1 + i32(r / 18u);
      let ix = i32(bx0) - 1 + i32(r % 18u);
      var v = 0.0;
      if (iy >= 0 && iy < i32(p.H) && ix >= 0 && ix < i32(p.W)) {
        v = x[(ic0 + ch) * p.H * p.W + u32(iy) * p.W + u32(ix)];
      }
      sh[idx] = v;
      idx = idx + 64u;
    }
    var j = tid;
    loop {
      if (j >= 144u) { break; }
      shw[j] = w[((ob + (j % 36u) / 9u) * p.Cin + ic0 + j / 36u) * 9u + (j % 9u)];
      j = j + 64u;
    }
    workgroupBarrier();

    for (var ch = 0u; ch < 4u; ch = ch + 1u) {
      let sb = ch * 324u + (2u * tyl) * 18u + 2u * txl;
      let wb = ch * 36u;
      let v00=sh[sb];     let v01=sh[sb+1u];  let v02=sh[sb+2u];  let v03=sh[sb+3u];
      let v10=sh[sb+18u]; let v11=sh[sb+19u]; let v12=sh[sb+20u]; let v13=sh[sb+21u];
      let v20=sh[sb+36u]; let v21=sh[sb+37u]; let v22=sh[sb+38u]; let v23=sh[sb+39u];
      let v30=sh[sb+54u]; let v31=sh[sb+55u]; let v32=sh[sb+56u]; let v33=sh[sb+57u];

      var o = wb;
      var w0=shw[o]; var w1=shw[o+1u]; var w2=shw[o+2u];
      var w3=shw[o+3u]; var w4=shw[o+4u]; var w5=shw[o+5u];
      var w6=shw[o+6u]; var w7=shw[o+7u]; var w8=shw[o+8u];
      a0 = a0 + v00*w0+v01*w1+v02*w2 + v10*w3+v11*w4+v12*w5 + v20*w6+v21*w7+v22*w8;
      a1 = a1 + v01*w0+v02*w1+v03*w2 + v11*w3+v12*w4+v13*w5 + v21*w6+v22*w7+v23*w8;
      a2 = a2 + v10*w0+v11*w1+v12*w2 + v20*w3+v21*w4+v22*w5 + v30*w6+v31*w7+v32*w8;
      a3 = a3 + v11*w0+v12*w1+v13*w2 + v21*w3+v22*w4+v23*w5 + v31*w6+v32*w7+v33*w8;

      o = wb + 9u;
      w0=shw[o]; w1=shw[o+1u]; w2=shw[o+2u];
      w3=shw[o+3u]; w4=shw[o+4u]; w5=shw[o+5u];
      w6=shw[o+6u]; w7=shw[o+7u]; w8=shw[o+8u];
      a4 = a4 + v00*w0+v01*w1+v02*w2 + v10*w3+v11*w4+v12*w5 + v20*w6+v21*w7+v22*w8;
      a5 = a5 + v01*w0+v02*w1+v03*w2 + v11*w3+v12*w4+v13*w5 + v21*w6+v22*w7+v23*w8;
      a6 = a6 + v10*w0+v11*w1+v12*w2 + v20*w3+v21*w4+v22*w5 + v30*w6+v31*w7+v32*w8;
      a7 = a7 + v11*w0+v12*w1+v13*w2 + v21*w3+v22*w4+v23*w5 + v31*w6+v32*w7+v33*w8;

      o = wb + 18u;
      w0=shw[o]; w1=shw[o+1u]; w2=shw[o+2u];
      w3=shw[o+3u]; w4=shw[o+4u]; w5=shw[o+5u];
      w6=shw[o+6u]; w7=shw[o+7u]; w8=shw[o+8u];
      a8  = a8  + v00*w0+v01*w1+v02*w2 + v10*w3+v11*w4+v12*w5 + v20*w6+v21*w7+v22*w8;
      a9  = a9  + v01*w0+v02*w1+v03*w2 + v11*w3+v12*w4+v13*w5 + v21*w6+v22*w7+v23*w8;
      a10 = a10 + v10*w0+v11*w1+v12*w2 + v20*w3+v21*w4+v22*w5 + v30*w6+v31*w7+v32*w8;
      a11 = a11 + v11*w0+v12*w1+v13*w2 + v21*w3+v22*w4+v23*w5 + v31*w6+v32*w7+v33*w8;

      o = wb + 27u;
      w0=shw[o]; w1=shw[o+1u]; w2=shw[o+2u];
      w3=shw[o+3u]; w4=shw[o+4u]; w5=shw[o+5u];
      w6=shw[o+6u]; w7=shw[o+7u]; w8=shw[o+8u];
      a12 = a12 + v00*w0+v01*w1+v02*w2 + v10*w3+v11*w4+v12*w5 + v20*w6+v21*w7+v22*w8;
      a13 = a13 + v01*w0+v02*w1+v03*w2 + v11*w3+v12*w4+v13*w5 + v21*w6+v22*w7+v23*w8;
      a14 = a14 + v10*w0+v11*w1+v12*w2 + v20*w3+v21*w4+v22*w5 + v30*w6+v31*w7+v32*w8;
      a15 = a15 + v11*w0+v12*w1+v13*w2 + v21*w3+v22*w4+v23*w5 + v31*w6+v32*w7+v33*w8;
    }
    workgroupBarrier();
  }

  let hw = p.H * p.W;
  let d0 = (by0 + 2u * tyl) * p.W + (bx0 + 2u * txl);
  let d1 = d0 + p.W;

  y[ob * hw + d0] = a0 + b[ob];
  y[ob * hw + d0 + 1u] = a1 + b[ob];
  y[ob * hw + d1] = a2 + b[ob];
  y[ob * hw + d1 + 1u] = a3 + b[ob];

  y[(ob + 1u) * hw + d0] = a4 + b[ob + 1u];
  y[(ob + 1u) * hw + d0 + 1u] = a5 + b[ob + 1u];
  y[(ob + 1u) * hw + d1] = a6 + b[ob + 1u];
  y[(ob + 1u) * hw + d1 + 1u] = a7 + b[ob + 1u];

  y[(ob + 2u) * hw + d0] = a8 + b[ob + 2u];
  y[(ob + 2u) * hw + d0 + 1u] = a9 + b[ob + 2u];
  y[(ob + 2u) * hw + d1] = a10 + b[ob + 2u];
  y[(ob + 2u) * hw + d1 + 1u] = a11 + b[ob + 2u];

  y[(ob + 3u) * hw + d0] = a12 + b[ob + 3u];
  y[(ob + 3u) * hw + d0 + 1u] = a13 + b[ob + 3u];
  y[(ob + 3u) * hw + d1] = a14 + b[ob + 3u];
  y[(ob + 3u) * hw + d1 + 1u] = a15 + b[ob + 3u];
}`;

function conv(bx, H, W, nomPoids, st = 1) {
  const [Cout, Cin, K] = POIDS[nomPoids + '.weight'].forme;
  const bw = gpuPoids(nomPoids + '.weight');
  const bb = gpuPoids(nomPoids + '.bias');
  const n3 = Cout * H * W;

  if (K === 3 && st === 1 && Cout % 4 === 0 && Cin % 4 === 0 &&
      H % 16 === 0 && W % 16 === 0) {
    const TX = W / 16, TY = H / 16;
    const by = bufVide(n3);
    lance(WGSL_CONV3B, [bx, bw, bb, by,
                        bufUniforme([Cin, Cout, H, W, TX, TY])],
          (Cout / 4) * TX * TY * 64);
    return { buf: by, C: Cout, H, W };
  }

  if (K === 3 && st === 1 && Cout % 4 === 0 && H % 8 === 0 && W % 8 === 0) {
    const TX = W / 8, TY = H / 8;
    const by = bufVide(n3);
    lance(WGSL_CONV3, [bx, bw, bb, by,
                       bufUniforme([Cin, Cout, H, W, TX, TY])],
          (Cout / 4) * TX * TY * 64);
    return { buf: by, C: Cout, H, W };
  }

  if (K === 1 && st === 1 && Cout % 4 === 0) {
    const HW = H * W;
    const by = bufVide(n3);
    lance(WGSL_CONV1, [bx, bw, bb, by,
                       bufUniforme([Cin, Cout, HW, (Cout / 4) * HW])],
          (Cout / 4) * HW);
    return { buf: by, C: Cout, H, W };
  }

  const pad = (K - 1) / 2;
  const Ho = Math.floor((H + 2 * pad - K) / st) + 1;
  const Wo = Math.floor((W + 2 * pad - K) / st) + 1;
  const n = Cout * Ho * Wo;
  const by = bufVide(n);
  lance(WGSL_CONV, [bx, bw, bb, by,
                    bufUniforme([Cin, Cout, H, W, K, st, pad, Ho, Wo, n])], n);
  return { buf: by, C: Cout, H: Ho, W: Wo };
}

// ===================== SiLU =====================
const WGSL_SILU = `
struct P { n:u32, r0:u32, r1:u32, r2:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  let v = x[g.x];
  y[g.x] = v / (1.0 + exp(-v));
}`;

function silu(bx, n) {
  const by = bufVide(n);
  lance(WGSL_SILU, [bx, by, bufUniforme([n])], n);
  return by;
}

// ===================== GroupNorm =====================
const WGSL_GN_STATS = `
struct P { C:u32, HW:u32, cpg:u32, G:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> st: array<f32>;
@group(0) @binding(2) var<uniform> p: P;

var<workgroup> ps: array<f32, 64>;
var<workgroup> ps2: array<f32, 64>;

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>,
        @builtin(local_invocation_id) li: vec3<u32>) {
  let grp = wg.x;
  let tid = li.x;
  let n = p.cpg * p.HW;
  let base = grp * n;
  var s = 0.0; var s2 = 0.0;
  var i = tid;
  loop {
    if (i >= n) { break; }
    let v = x[base + i];
    s = s + v; s2 = s2 + v * v;
    i = i + 64u;
  }
  ps[tid] = s; ps2[tid] = s2;
  workgroupBarrier();
  var d = 32u;
  loop {
    if (d == 0u) { break; }
    if (tid < d) {
      ps[tid] = ps[tid] + ps[tid + d];
      ps2[tid] = ps2[tid] + ps2[tid + d];
    }
    workgroupBarrier();
    d = d / 2u;
  }
  if (tid == 0u) {
    let moy = ps[0] / f32(n);
    let vr = ps2[0] / f32(n) - moy * moy;
    st[grp] = moy;
    st[p.G + grp] = 1.0 / sqrt(max(vr, 0.0) + 1e-5);
  }
}`;

const WGSL_GN_APPL = `
struct P { C:u32, HW:u32, cpg:u32, G:u32, n:u32, r0:u32, r1:u32, r2:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> st: array<f32>;
@group(0) @binding(2) var<storage, read> w: array<f32>;
@group(0) @binding(3) var<storage, read> b: array<f32>;
@group(0) @binding(4) var<storage, read_write> y: array<f32>;
@group(0) @binding(5) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  let c = g.x / p.HW;
  let grp = c / p.cpg;
  y[g.x] = (x[g.x] - st[grp]) * st[p.G + grp] * w[c] + b[c];
}`;

function groupnorm(bx, C, H, W, nom) {
  const G = 32, HW = H * W, cpg = C / G, n = C * HW;
  const bst = bufVide(2 * G);
  lance(WGSL_GN_STATS, [bx, bst, bufUniforme([C, HW, cpg, G])], G * 64);
  const by = bufVide(n);
  lance(WGSL_GN_APPL, [bx, bst, gpuPoids(nom + '.weight'),
                       gpuPoids(nom + '.bias'), by,
                       bufUniforme([C, HW, cpg, G, n])], n);
  return by;
}

// ===================== Linear =====================
const WGSL_LIN = `
struct P { Cin:u32, Cout:u32, r0:u32, r1:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> w: array<f32>;
@group(0) @binding(2) var<storage, read> b: array<f32>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.Cout) { return; }
  var acc = b[g.x];
  for (var i = 0u; i < p.Cin; i = i + 1u) {
    acc = acc + w[g.x * p.Cin + i] * x[i];
  }
  y[g.x] = acc;
}`;

function lineaire(bx, nom) {
  const [Cout, Cin] = POIDS[nom + '.weight'].forme;
  const by = bufVide(Cout);
  lance(WGSL_LIN, [bx, gpuPoids(nom + '.weight'),
                   gpuPoids(nom + '.bias'), by,
                   bufUniforme([Cin, Cout])], Cout);
  return { buf: by, n: Cout };
}

// ===================== ajout par canal / somme =====================
const WGSL_ADD_CANAL = `
struct P { HW:u32, n:u32, r0:u32, r1:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> v: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  y[g.x] = x[g.x] + v[g.x / p.HW];
}`;

function ajoutCanal(bx, bv, C, H, W) {
  const n = C * H * W, by = bufVide(n);
  lance(WGSL_ADD_CANAL, [bx, bv, by, bufUniforme([H * W, n])], n);
  return by;
}

const WGSL_ADD = `
struct P { n:u32, r0:u32, r1:u32, r2:u32 };
@group(0) @binding(0) var<storage, read> a: array<f32>;
@group(0) @binding(1) var<storage, read> b: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  y[g.x] = a[g.x] + b[g.x];
}`;

function somme(ba, bb, n) {
  const by = bufVide(n);
  lance(WGSL_ADD, [ba, bb, by, bufUniforme([n])], n);
  return by;
}

// ===================== encodage du temps =====================
function embTemps(t, dim) {
  const moitie = dim / 2, e = new Float32Array(dim);
  for (let k = 0; k < moitie; k++) {
    const f = Math.exp(-Math.log(10000) * k / moitie);
    e[k] = Math.sin(t * f);
    e[moitie + k] = Math.cos(t * f);
  }
  return e;
}

function embedTemps(t) {
  const base = ARCHI.base;
  let b = bufTemp(embTemps(t, base));
  b = lineaire(b, 'temps.0').buf;
  b = silu(b, base * 4);
  return lineaire(b, 'temps.2');
}

// ===================== BlocRes =====================
function blocRes(bx, C, H, W, bteSilu, nom) {
  const [Cout] = POIDS[nom + '.c1.weight'].forme;
  const nOut = Cout * H * W;

  let h = groupnorm(bx, C, H, W, nom + '.n1');
  h = silu(h, C * H * W);
  h = conv(h, H, W, nom + '.c1').buf;

  const proj = lineaire(bteSilu, nom + '.t').buf;
  h = ajoutCanal(h, proj, Cout, H, W);

  let h2 = groupnorm(h, Cout, H, W, nom + '.n2');
  h2 = silu(h2, nOut);
  h2 = conv(h2, H, W, nom + '.c2').buf;

  const rac = (C === Cout) ? bx : conv(bx, H, W, nom + '.raccourci').buf;
  return { buf: somme(h2, rac, nOut), C: Cout, H, W };
}

// ===================== Attention =====================
const WGSL_ATT_SCORES = `
struct P { C:u32, HW:u32, n:u32, HW4:u32 };
@group(0) @binding(0) var<storage, read> qkv: array<f32>;
@group(0) @binding(1) var<storage, read_write> s: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  let i  = g.x / p.HW4;
  let jb = (g.x % p.HW4) * 4u;
  let kb = p.C * p.HW;
  var a0 = 0.0; var a1 = 0.0; var a2 = 0.0; var a3 = 0.0;
  for (var c = 0u; c < p.C; c = c + 1u) {
    let q = qkv[c * p.HW + i];
    let o = kb + c * p.HW + jb;
    a0 = a0 + q * qkv[o];
    a1 = a1 + q * qkv[o + 1u];
    a2 = a2 + q * qkv[o + 2u];
    a3 = a3 + q * qkv[o + 3u];
  }
  let e = inverseSqrt(f32(p.C));
  let d = i * p.HW + jb;
  s[d] = a0 * e; s[d + 1u] = a1 * e; s[d + 2u] = a2 * e; s[d + 3u] = a3 * e;
}`;

const WGSL_SOFTMAX = `
struct P { HW:u32, r0:u32, r1:u32, r2:u32 };
@group(0) @binding(0) var<storage, read_write> s: array<f32>;
@group(0) @binding(1) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.HW) { return; }
  let base = g.x * p.HW;
  var mx = s[base];
  for (var j = 1u; j < p.HW; j = j + 1u) { mx = max(mx, s[base + j]); }
  var som = 0.0;
  for (var j = 0u; j < p.HW; j = j + 1u) {
    let e = exp(s[base + j] - mx);
    s[base + j] = e; som = som + e;
  }
  let inv = 1.0 / som;
  for (var j = 0u; j < p.HW; j = j + 1u) { s[base + j] = s[base + j] * inv; }
}`;

const WGSL_ATT_OUT = `
struct P { C:u32, HW:u32, n:u32, r:u32 };
@group(0) @binding(0) var<storage, read> qkv: array<f32>;
@group(0) @binding(1) var<storage, read> att: array<f32>;
@group(0) @binding(2) var<storage, read_write> h: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  let i  = g.x % p.HW;
  let cb = (g.x / p.HW) * 4u;
  let vb = 2u * p.C * p.HW;
  let o0 = vb + cb * p.HW; let o1 = o0 + p.HW;
  let o2 = o1 + p.HW;      let o3 = o2 + p.HW;
  let ab = i * p.HW;
  var a0 = 0.0; var a1 = 0.0; var a2 = 0.0; var a3 = 0.0;
  for (var j = 0u; j < p.HW; j = j + 1u) {
    let a = att[ab + j];
    a0 = a0 + a * qkv[o0 + j];
    a1 = a1 + a * qkv[o1 + j];
    a2 = a2 + a * qkv[o2 + j];
    a3 = a3 + a * qkv[o3 + j];
  }
  h[cb * p.HW + i] = a0;
  h[(cb + 1u) * p.HW + i] = a1;
  h[(cb + 2u) * p.HW + i] = a2;
  h[(cb + 3u) * p.HW + i] = a3;
}`;

function attention(bx, C, H, W, nom) {
  const HW = H * W, n = C * HW;
  const g = groupnorm(bx, C, H, W, nom + '.n');
  const qkv = conv(g, H, W, nom + '.qkv');
  const bs = bufVide(HW * HW);
  lance(WGSL_ATT_SCORES, [qkv.buf, bs,
        bufUniforme([C, HW, HW * HW / 4, HW / 4])], HW * HW / 4);
  lance(WGSL_SOFTMAX, [bs, bufUniforme([HW])], HW);
  const bh = bufVide(n);
  lance(WGSL_ATT_OUT, [qkv.buf, bs, bh, bufUniforme([C, HW, n / 4])], n / 4);
  const o = conv(bh, H, W, nom + '.sortie');
  return { buf: somme(o.buf, bx, n), C, H, W };
}

// ===================== Agrandissement =====================
const WGSL_UP = `
struct P { C:u32, H:u32, W:u32, n:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read_write> y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  let W2 = p.W * 2u; let H2 = p.H * 2u;
  let ox = g.x % W2;
  let oy = (g.x / W2) % H2;
  let c  = g.x / (W2 * H2);
  y[g.x] = x[c * p.H * p.W + (oy / 2u) * p.W + (ox / 2u)];
}`;

function agrandit(bx, C, H, W) {
  const n = C * 4 * H * W, by = bufVide(n);
  lance(WGSL_UP, [bx, by, bufUniforme([C, H, W, n])], n);
  return { buf: by, C, H: H * 2, W: W * 2 };
}

// ===================== Plan =====================
let PLAN = null;

function construitPlan() {
  const { base, mult, n_res, attn, taille } = ARCHI;
  const desc = [], mont = [];
  let canaux = [base], c = base, res = taille, k = 0;

  for (let i = 0; i < mult.length; i++) {
    for (let r = 0; r < n_res; r++) {
      const e = { t: 'res', nom: `descente.${k}.0` };
      c = base * mult[i];
      if (attn.includes(res)) e.attn = `descente.${k}.1`;
      desc.push(e); canaux.push(c); k++;
    }
    if (i < mult.length - 1) {
      desc.push({ t: 'down', nom: `descente.${k}.0` });
      canaux.push(c); res /= 2; k++;
    }
  }

  k = 0;
  for (let i = mult.length - 1; i >= 0; i--) {
    for (let r = 0; r < n_res + 1; r++) {
      const e = { t: 'res', nom: `montee.${k}.0` };
      canaux.pop();
      c = base * mult[i];
      if (attn.includes(res)) e.attn = `montee.${k}.1`;
      mont.push(e); k++;
    }
    if (i > 0) { mont.push({ t: 'up', nom: `montee.${k}.1` }); res *= 2; k++; }
  }
  return { desc, mont };
}

// ===================== Passage avant =====================
function avant(bx, t, H, W) {
  if (!PLAN) PLAN = construitPlan();
  debutLot();

  const te = embedTemps(t);
  const teS = silu(te.buf, te.n);

  let h = conv(bx, H, W, 'entree');
  const piles = [h];

  for (const e of PLAN.desc) {
    if (e.t === 'res') {
      h = blocRes(h.buf, h.C, h.H, h.W, teS, e.nom);
      if (e.attn) h = attention(h.buf, h.C, h.H, h.W, e.attn);
    } else {
      h = conv(h.buf, h.H, h.W, e.nom, 2);
    }
    piles.push(h);
  }

  h = blocRes(h.buf, h.C, h.H, h.W, teS, 'milieu.0');
  h = attention(h.buf, h.C, h.H, h.W, 'milieu.1');
  h = blocRes(h.buf, h.C, h.H, h.W, teS, 'milieu.2');

  for (const e of PLAN.mont) {
    if (e.t === 'up') {
      h = agrandit(h.buf, h.C, h.H, h.W);
      h = conv(h.buf, h.H, h.W, e.nom);
    } else {
      const s = piles.pop();
      const b = concat(h.buf, h.C * h.H * h.W, s.buf, s.C * s.H * s.W);
      h = blocRes(b, h.C + s.C, h.H, h.W, teS, e.nom);
      if (e.attn) h = attention(h.buf, h.C, h.H, h.W, e.attn);
    }
  }

  let f = groupnorm(h.buf, h.C, h.H, h.W, 'fin.0');
  f = silu(f, h.C * h.H * h.W);
  const sortie = conv(f, h.H, h.W, 'fin.2');

  finLot();
  return sortie;
}

const WGSL_PRELU = `
struct P { HW:u32, n:u32, r0:u32, r1:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> a: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  let v = x[g.x];
  y[g.x] = select(a[g.x / p.HW] * v, v, v > 0.0);
}`;

function prelu(bx, C, H, W, nom) {
  const n = C * H * W, by = bufVide(n);
  lance(WGSL_PRELU, [bx, gpuPoids(nom + '.weight'), by,
                     bufUniforme([H * W, n])], n);
  return by;
}

const WGSL_SHUFFLE = `
struct P { C:u32, H:u32, W:u32, r:u32, n:u32, r0:u32, r1:u32, r2:u32 };
@group(0) @binding(0) var<storage, read> x: array<f32>;
@group(0) @binding(1) var<storage, read> src: array<f32>;
@group(0) @binding(2) var<storage, read_write> y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) g: vec3<u32>) {
  if (g.x >= p.n) { return; }
  let W2 = p.W * p.r;
  let H2 = p.H * p.r;
  let ox = g.x % W2;
  let oy = (g.x / W2) % H2;
  let c  = g.x / (W2 * H2);
  let w = ox / p.r; let j = ox % p.r;
  let h = oy / p.r; let i = oy % p.r;
  let hw = p.H * p.W;
  let ci = c * p.r * p.r + i * p.r + j;
  y[g.x] = x[ci * hw + h * p.W + w] + src[c * hw + h * p.W + w];
}`;

function shuffleEtAjoute(bx, bsrc, C, H, W, r) {
  const n = C * H * r * W * r, by = bufVide(n);
  lance(WGSL_SHUFFLE, [bx, bsrc, by, bufUniforme([C, H, W, r, n])], n);
  return { buf: by, C, H: H * r, W: W * r };
}

function agrandisSR(bx, H, W) {
  let h = bx;
  let C = 3;
  for (const c of COUCHES_SR) {
    if (c.t === 'conv') {
      const r = conv(h, H, W, c.nom);
      h = r.buf; C = r.C;
    } else {
      h = prelu(h, C, H, W, c.nom);
    }
  }
  return shuffleEtAjoute(h, bx, 3, H, W, 4);
}
