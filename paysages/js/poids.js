let POIDS = null;
let ARCHI = null;
let VARIANTE = null;
const VARIANTES = {};
let COUCHES_SR = null;

const TAILLE_MORCEAU = 20 * 1024 * 1024;

// Telecharge un .bin, decoupe ou non, avec progression.
// octets : taille totale attendue, deduite du json.
async function chargeBin(chemin, octets, progres) {
  const nMorceaux = Math.ceil(octets / TAILLE_MORCEAU);
  const sortie = new Uint8Array(octets);
  let pos = 0;

  for (let i = 0; i < nMorceaux; i++) {
    const url = (nMorceaux === 1) ? chemin : chemin + '.' + i;
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + ' : HTTP ' + r.status);

    const type = r.headers.get('content-type') || '';
    if (type.includes('text/html')) {
      throw new Error(url + " : le serveur renvoie une page HTML, le fichier n'existe pas");
    }

    const buf = new Uint8Array(await r.arrayBuffer());

    if (buf.length < 1000) {
      const apercu = new TextDecoder().decode(buf.subarray(0, 200));
      throw new Error(url + ' : seulement ' + buf.length + ' octets. Contenu : ' + apercu);
    }

    sortie.set(buf, pos);
    pos += buf.length;
    if (progres) progres(pos, octets);
  }

  if (pos !== octets)
    throw new Error(chemin + ' : ' + pos + ' octets au lieu de ' + octets);

  return sortie.buffer;
}

async function chargeVariante(cle, base, progres) {
  const rj = await fetch('./modele/' + base + '.json');
  if (!rj.ok) throw new Error(base + '.json : HTTP ' + rj.status);
  const desc = await rj.json();

  const ab = await chargeBin('./modele/' + base + '.bin', desc.total * 4, progres);
  const brut = new Float32Array(ab);

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

async function chargePoidsSR(progres) {
  const rj = await fetch('./modele/poids_sr.json');
  if (!rj.ok) throw new Error('poids_sr.json : HTTP ' + rj.status);
  const desc = await rj.json();

  const ab = await chargeBin('./modele/poids_sr.bin', desc.total * 4, progres);
  const brut = new Float32Array(ab);

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
