let POIDS = null;
let ARCHI = null;
let VARIANTE = null;
const VARIANTES = {};
let COUCHES_SR = null;

async function chargeVariante(cle, base) {
  const rj = await fetch('modele/' + base + '.json?v=' + Date.now());
  if (!rj.ok) throw new Error(base + '.json : HTTP ' + rj.status);
  const desc = await rj.json();

  const rb = await fetch('modele/' + base + '.bin?v=' + Date.now());
  if (!rb.ok) throw new Error(base + '.bin : HTTP ' + rb.status);
  const brut = new Float32Array(await rb.arrayBuffer());
  if (brut.length !== desc.total)
    throw new Error(base + ' : ' + brut.length + ' au lieu de ' + desc.total);

  const p = {};
  for (const t of desc.tenseurs) {
    p[t.nom] = { donnees: brut.subarray(t.offset, t.offset + t.taille), forme: t.forme };
  }
  VARIANTES[cle] = { poids: p, archi: desc.archi };
  return desc;
}

function choisitVariante(cle) {
  if (!VARIANTES[cle]) throw new Error('variante inconnue : ' + cle);
  if (VARIANTE === cle) return;
  libereVariante(VARIANTE);
  VARIANTE = cle;
  POIDS = VARIANTES[cle].poids;
  ARCHI = VARIANTES[cle].archi;
  PLAN = null;
}

async function chargePoidsSR() {
  const rj = await fetch('modele/poids_sr.json?v=' + Date.now());
  if (!rj.ok) throw new Error('poids_sr.json : HTTP ' + rj.status);
  const desc = await rj.json();

  const rb = await fetch('modele/poids_sr.bin?v=' + Date.now());
  if (!rb.ok) throw new Error('poids_sr.bin : HTTP ' + rb.status);
  const brut = new Float32Array(await rb.arrayBuffer());
  if (brut.length !== desc.total) throw new Error('taille SR incoherente');

  // les poids SR sont ajoutes a toutes les variantes
  for (const cle of Object.keys(VARIANTES)) {
    for (const t of desc.tenseurs) {
      VARIANTES[cle].poids[t.nom] = {
        donnees: brut.subarray(t.offset, t.offset + t.taille), forme: t.forme
      };
    }
  }
  COUCHES_SR = desc.couches;
  return desc;
}

function empreinte(nom) {
  const d = POIDS[nom].donnees;
  let s = 0;
  for (let i = 0; i < d.length; i++) s += Math.abs(d[i]);
  return s;
}