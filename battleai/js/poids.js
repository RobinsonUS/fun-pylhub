// ============================================================
//  js/poids.js
//
//  Chargement silencieux des poids entraines.
//  Rien ne s'affiche : en cas d'echec, le jeu tourne avec un
//  cerveau aleatoire plutot que de casser.
// ============================================================

const CLES_POIDS = ['dense', 'wz', 'uz', 'wr', 'ur', 'wh', 'uh',
                    'tMouv', 'tVisee', 'tTir', 'tRech', 'tVal'];

const VERSION_POIDS = '2';

function importeCerveau(meta, plat) {
  const c = creeCerveau(1);
  let o = 0;
  for (const k of CLES_POIDS) {
    c[k].w.set(plat.subarray(o, o + c[k].w.length)); o += c[k].w.length;
    c[k].b.set(plat.subarray(o, o + c[k].b.length)); o += c[k].b.length;
  }
  return c;
}

// renvoie le cerveau charge, ou null
async function chargePoidsEntraines() {
  try {
    const rj = await fetch('poids.json');
    if (!rj.ok) return null;
    const meta = await rj.json();

    // architecture differente : les poids ne veulent rien dire
    if (meta.nE && meta.nE !== tailleObservation()) return null;

    const rb = await fetch('poids.bin');
    if (!rb.ok) return null;
    const plat = new Float32Array(await rb.arrayBuffer());
    if (plat.length !== meta.total) return null;

    return importeCerveau(meta, plat);
  } catch (e) {
    return null;
  }
}
