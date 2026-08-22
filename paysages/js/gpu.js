let DEV = null;
const CACHE = new Map();
const CACHE_UNIF = new Map();
const POOL = new Map();
let TEMP = [];
let ENC = null, PASSE = null;

// raison de la perte du device, remplie si le GPU coupe en cours de route
let RAISON_PERTE = null;

// un seul buffer mappable, reutilise a chaque lecture : en creer un par
// etape finit par saturer la memoire GPU sur tablette
let BUF_LECTURE = null;

async function initGPU() {
  if (!navigator.gpu) throw new Error('WebGPU absent');
  const adapt = await navigator.gpu.requestAdapter();
  if (!adapt) throw new Error('aucun adaptateur');
  DEV = await adapt.requestDevice();

  DEV.lost.then((info) => {
    RAISON_PERTE = info.message || info.reason || 'inconnue';
  });

  return adapt;
}

function bufDepuis(tab) {
  const b = DEV.createBuffer({
    size: Math.max(4, tab.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
  });
  DEV.queue.writeBuffer(b, 0, tab);
  return b;
}

function bufVide(n) {
  const taille = Math.max(16, n * 4);
  const libres = POOL.get(taille);
  let b;
  if (libres && libres.length) {
    b = libres.pop();
  } else {
    b = DEV.createBuffer({
      size: taille,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    b._taille = taille;
  }
  TEMP.push(b);
  return b;
}

function bufTemp(tab) {
  const b = bufVide(tab.length);
  DEV.queue.writeBuffer(b, 0, tab);
  return b;
}

function bufUniforme(vals) {
  const cle = vals.join(',');
  let b = CACHE_UNIF.get(cle);
  if (b) return b;
  const t = new Uint32Array(12);
  t.set(vals);
  b = DEV.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  DEV.queue.writeBuffer(b, 0, t);
  CACHE_UNIF.set(cle, b);
  return b;
}

function libereTemp(garder) {
  for (const b of TEMP) {
    if (b === garder) continue;
    if (!POOL.has(b._taille)) POOL.set(b._taille, []);
    POOL.get(b._taille).push(b);
  }
  TEMP = [];
}

function debutLot() {
  ENC = DEV.createCommandEncoder();
  PASSE = ENC.beginComputePass();
}

function finLot() {
  PASSE.end();
  DEV.queue.submit([ENC.finish()]);
  ENC = null; PASSE = null;
}

function pipeline(code) {
  if (CACHE.has(code)) return CACHE.get(code);
  const p = DEV.createComputePipeline({
    layout: 'auto',
    compute: { module: DEV.createShaderModule({ code }), entryPoint: 'main' }
  });
  CACHE.set(code, p);
  return p;
}

function lance(code, buffers, nThreads, taille = 64) {
  const pipe = pipeline(code);
  const groupe = DEV.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: buffers.map((b, i) => ({ binding: i, resource: { buffer: b } }))
  });
  const seul = !PASSE;
  if (seul) debutLot();
  PASSE.setPipeline(pipe);
  PASSE.setBindGroup(0, groupe);
  PASSE.dispatchWorkgroups(Math.ceil(nThreads / taille));
  if (seul) finLot();
}

function concat(ba, na, bb, nb) {
  const by = bufVide(na + nb);
  const dedans = !!PASSE;
  if (dedans) PASSE.end(); else debutLot();
  ENC.copyBufferToBuffer(ba, 0, by, 0, na * 4);
  ENC.copyBufferToBuffer(bb, 0, by, na * 4, nb * 4);
  if (dedans) PASSE = ENC.beginComputePass(); else finLot();
  return by;
}

async function lire(buf, n) {
  const taille = n * 4;

  // un buffer mappable ne peut pas etre plus petit que la demande :
  // on l'agrandit au besoin, notamment lors de l'agrandissement x4
  if (!BUF_LECTURE || BUF_LECTURE.size < taille) {
    if (BUF_LECTURE) BUF_LECTURE.destroy();
    BUF_LECTURE = DEV.createBuffer({
      size: taille,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
    });
  }
  const st = BUF_LECTURE;

  const enc = DEV.createCommandEncoder();
  enc.copyBufferToBuffer(buf, 0, st, 0, taille);
  DEV.queue.submit([enc.finish()]);

  try {
    await st.mapAsync(GPUMapMode.READ, 0, taille);
  } catch (e) {
    // mapAsync echoue presque toujours parce que le device a ete perdu
    if (RAISON_PERTE)
      throw new Error('le GPU a coupé (' + RAISON_PERTE + '). Rechargez la page.');
    throw new Error('lecture GPU impossible. Rechargez la page.');
  }

  const r = new Float32Array(st.getMappedRange(0, taille).slice(0));
  st.unmap();
  return r;
}
