// --- Scene, camera, renderer ---

const scene = new THREE.Scene();
const gameContainer = document.getElementById("game-container");

const camera = new THREE.PerspectiveCamera(
	75,
	gameContainer.clientWidth / gameContainer.clientHeight,
	0.1,
	1000
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
gameContainer.appendChild(renderer.domElement); // dans son propre conteneur, plus jamais superpose aux boutons

// se dimensionne sur SON PROPRE conteneur (pas toute la fenetre) : le plateau et les boutons
// sont desormais deux zones separees dans la mise en page (voir style.css), donc le canvas ne
// doit occuper QUE l'espace qui lui est reellement alloue
function resizeRendererToContainer() {
	const width = gameContainer.clientWidth;
	const height = gameContainer.clientHeight;
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
	renderer.setSize(width, height);
}
resizeRendererToContainer();

// --- Dimensions de la grille : rectangulaire, plus large/longue que haute ---

const SIZE_X = 90;
const SIZE_Y = 64; // encore agrandie pour remonter le curseur (il touchait deja le plafond de la grille avant)
const SIZE_Z = 90;
const VOXEL = 0.5;

function worldX(i) { return (i - SIZE_X / 2) * VOXEL; }
function worldY(i) { return (i - SIZE_Y / 2) * VOXEL; }
function worldZ(i) { return (i - SIZE_Z / 2) * VOXEL; }

// --- Lumieres ---

const horizontalSize = Math.max(SIZE_X, SIZE_Z) * VOXEL;

const light = new THREE.DirectionalLight(0xffffff, 2);
light.position.set(horizontalSize, horizontalSize * 1.2, horizontalSize);
light.castShadow = true;

light.shadow.camera.left = -horizontalSize;
light.shadow.camera.right = horizontalSize;
light.shadow.camera.top = horizontalSize;
light.shadow.camera.bottom = -horizontalSize;
light.shadow.camera.near = 0.5;
light.shadow.camera.far = horizontalSize * 5;
light.shadow.mapSize.set(1024, 1024);

scene.add(light);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

// --- Elements : proprietes physiques + palette de couleurs (identique a la version 2D) ---

const ELEMENTS = {
	sand:    { density: 2, viscosity: 0 },
	wetSand: { density: 2, viscosity: 0 },
	dirt:    { density: 2, viscosity: 0 },
	mud:     { density: 2, viscosity: 0 },
	rock:    { density: 2, viscosity: 0 },
	water:   { density: 1, viscosity: 0.6, flowRate: 6 }
};

const PALETTES = {
	sand:    ["#e7d778", "#e0d071", "#eede7f", "#e6d677", "#e4d475", "#e2d273"],
	wetSand: ["#7d7130", "#9c904e", "#9e9150", "#85793a", "#9f9353", "#918446"],
	dirt:    ["#603d13", "#755429", "#553b18", "#6a481d", "#724f25", "#69481d"],
	mud:     ["#332012", "#291608", "#422f21", "#321f11", "#412e20", "#372416"],
	rock:    ["#515151", "#565656", "#969696", "#838383", "#989898", "#7e7e7e"],
	water:   ["#1e64fa", "#2369fe", "#2065fe", "#266cff", "#195ef7", "#1f65fb"]
};
const SHADE_COUNT = 6;

const TRANSFORMATIONS = [
	{ catalyst: "water", target: "sand", result: "wetSand", radius: 4 },
	{ catalyst: "water", target: "dirt", result: "mud", radius: 8 }
];

const CAN_FALL = new Set(["sand", "wetSand", "dirt", "mud", "rock", "water"]);
const CAN_DIAGONAL = new Set(["sand", "dirt", "water"]);
const CAN_LATERAL = new Set(["water"]);

function canMoveInto(fromType, toType) {
	if (toType === "empty") return true;
	if (ELEMENTS[fromType].density <= ELEMENTS[toType].density) return false;
	return Math.random() < ELEMENTS[toType].viscosity;
}

// --- Grille de donnees (types) : une seule couche de sable au demarrage ---

const grid = [];
for (let x = 0; x < SIZE_X; x++) {
	grid.push([]);
	for (let y = 0; y < SIZE_Y; y++) {
		grid[x].push([]);
		for (let z = 0; z < SIZE_Z; z++) {
			grid[x][y].push(y === 0 ? "rock" : "empty");
		}
	}
}

// --- Rendu : un InstancedMesh par (type, nuance) — 36 au total, couleurs solides, pas de vertexColors ---
// (evite completement le bug rencontre entre InstancedMesh et vertexColors)

const geometry = new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL);
// capacite par groupe (type x nuance) PLAFONNEE independamment du volume de la grille :
// avant, chacun des 36 groupes reservait de la memoire pour la grille ENTIERE, ce qui aurait
// explose en agrandissant le terrain — un seul (type,nuance) n'occupe jamais qu'une fraction
// du total en pratique, donc une capacite fixe et genereuse suffit largement
const GROUP_CAPACITY = Math.min(SIZE_X * SIZE_Y * SIZE_Z, 20000);

const groups = {}; // groups[type][shadeIndex] = { mesh, slotCoords[], currentVisualPos[] }

// Three.js calcule par defaut la sphere de visibilite (frustum culling) d'un InstancedMesh a
// partir de SA GEOMETRIE (un seul voxel, ~0.5 unite) — pas de l'etendue reelle ou les instances
// sont dispersees dans toute la grille. Resultat : sous certains angles, Three.js pense (a tort)
// que le groupe entier est hors du champ de vision et le fait disparaitre completement, meme si
// des instances sont bien visibles a l'ecran. On calcule ici la VRAIE sphere englobante de toute
// la grille (fixe, connue a l'avance) et on l'applique a chaque groupe — corrige le bug tout en
// gardant le benefice du culling (contrairement a le desactiver completement)
const gridBoundsCenter = new THREE.Vector3(
	(worldX(0) + worldX(SIZE_X - 1)) / 2,
	(worldY(0) + worldY(SIZE_Y - 1)) / 2,
	(worldZ(0) + worldZ(SIZE_Z - 1)) / 2
);
const gridBoundsRadius = Math.sqrt(
	((worldX(SIZE_X - 1) - worldX(0)) / 2) ** 2 +
	((worldY(SIZE_Y - 1) - worldY(0)) / 2) ** 2 +
	((worldZ(SIZE_Z - 1) - worldZ(0)) / 2) ** 2
) + VOXEL; // petite marge pour la demi-taille d'un voxel

for (const type of Object.keys(ELEMENTS)) {
	groups[type] = [];
	for (let shadeIndex = 0; shadeIndex < SHADE_COUNT; shadeIndex++) {
		const materialOptions = { color: PALETTES[type][shadeIndex] };
		if (type === "water") {
			materialOptions.transparent = true;
			materialOptions.opacity = 0.8; // un peu transparente, comme demande
		}
		const material = new THREE.MeshStandardMaterial(materialOptions);
		const mesh = new THREE.InstancedMesh(geometry, material, GROUP_CAPACITY);
		mesh.castShadow = true;
		mesh.receiveShadow = false;
		mesh.count = 0;
		mesh.boundingSphere = new THREE.Sphere(gridBoundsCenter.clone(), gridBoundsRadius);
		scene.add(mesh);
		groups[type].push({ mesh, slotCoords: new Array(GROUP_CAPACITY).fill(null), currentVisualPos: new Array(GROUP_CAPACITY).fill(null) });
	}
}

const indexAt = [];
for (let x = 0; x < SIZE_X; x++) {
	indexAt.push([]);
	for (let y = 0; y < SIZE_Y; y++) {
		indexAt[x].push(new Array(SIZE_Z).fill(null));
	}
}

const dummy = new THREE.Object3D();
const scratchMatrix = new THREE.Matrix4();

function writeMatrixAt(mesh, slot, position) {
	dummy.position.copy(position);
	dummy.updateMatrix();
	mesh.setMatrixAt(slot, dummy.matrix);
}

// types cibles des transformations (sand, dirt) — sert a savoir quelles cases surveiller
const TARGET_TYPES = new Set(TRANSFORMATIONS.map((rule) => rule.target));

// encode/decode une position (x,y,z) en un seul entier : plus rapide a manipuler dans les Set
// qu'une cle texte "x,y,z" (pas de concatenation/parsing de chaines a chaque tick)
function cellKey(x, y, z) {
	return (x * SIZE_Y + y) * SIZE_Z + z;
}
function decodeCellKey(key) {
	const z = key % SIZE_Z;
	const y = Math.floor(key / SIZE_Z) % SIZE_Y;
	const x = Math.floor(key / (SIZE_Z * SIZE_Y));
	return [x, y, z];
}

// ensembles des cases ACTIVES : seules celles-ci sont examinees a chaque tick de physique/
// transformation, au lieu de TOUTE la grille — indispensable pour qu'agrandir la grille ne
// fasse pas grossir le cout de calcul avec (la plupart des cases restent vides en pratique)
const activeFalling = new Set(); // cases occupees par un type qui peut tomber
const transformCandidates = new Set(); // cases occupees par un type cible de transformation

function trackCell(x, y, z, type) {
	const key = cellKey(x, y, z);
	if (CAN_FALL.has(type)) activeFalling.add(key); else activeFalling.delete(key);
	if (TARGET_TYPES.has(type)) transformCandidates.add(key); else transformCandidates.delete(key);
}

function untrackCell(x, y, z) {
	const key = cellKey(x, y, z);
	activeFalling.delete(key);
	transformCandidates.delete(key);
}

function createVoxelInstance(x, y, z, type) {
	const shadeIndex = Math.floor(Math.random() * SHADE_COUNT);
	const group = groups[type][shadeIndex];
	if (group.mesh.count >= GROUP_CAPACITY) return; // garde-fou : capacite de ce groupe atteinte

	const slot = group.mesh.count;
	const worldPos = new THREE.Vector3(worldX(x), worldY(y), worldZ(z));

	group.slotCoords[slot] = { x, y, z };
	group.currentVisualPos[slot] = worldPos;
	indexAt[x][y][z] = { type, shadeIndex, slot };

	writeMatrixAt(group.mesh, slot, worldPos);
	group.mesh.count++;
	group.mesh.instanceMatrix.needsUpdate = true;

	grid[x][y][z] = type;
	trackCell(x, y, z, type);
}

function removeVoxelInstance(x, y, z) {
	const entry = indexAt[x][y][z];
	if (!entry) return;

	animatingEntries.delete(entry);
	untrackCell(x, y, z);

	const group = groups[entry.type][entry.shadeIndex];
	const lastSlot = group.mesh.count - 1;

	if (entry.slot !== lastSlot) {
		const lastCoords = group.slotCoords[lastSlot];
		group.slotCoords[entry.slot] = lastCoords;
		group.currentVisualPos[entry.slot] = group.currentVisualPos[lastSlot];

		const lastEntry = indexAt[lastCoords.x][lastCoords.y][lastCoords.z];
		lastEntry.slot = entry.slot;

		group.mesh.getMatrixAt(lastSlot, scratchMatrix);
		group.mesh.setMatrixAt(entry.slot, scratchMatrix);
	}

	indexAt[x][y][z] = null;
	group.mesh.count--;
	group.mesh.instanceMatrix.needsUpdate = true;

	grid[x][y][z] = "empty";
}

function convertVoxel(x, y, z, newType) {
	removeVoxelInstance(x, y, z);
	createVoxelInstance(x, y, z, newType);
}

for (let x = 0; x < SIZE_X; x++) {
	for (let y = 0; y < SIZE_Y; y++) {
		for (let z = 0; z < SIZE_Z; z++) {
			const type = grid[x][y][z];
			if (type === "empty") continue;
			createVoxelInstance(x, y, z, type);
		}
	}
}

// --- Camera orbitale, faite maison (coordonnees spheriques) ---

let radius = horizontalSize * 1.3;
let theta = Math.PI / 4;
let phi = Math.PI / 3;

// la camera orbite autour de ce point, pas de l'origine — le terrain se trouve pres du sol
// (y=0), alors que l'origine (0,0,0) est le centre vertical de TOUTE la grille (tres haut
// au-dessus du terrain) ; sans ca, le terrain se retrouve ecrase en bas de l'ecran, avec
// un enorme vide au-dessus
const cameraTarget = new THREE.Vector3(0, worldY(10), 0);

function updateCameraPosition() {
	camera.position.set(
		cameraTarget.x + radius * Math.sin(phi) * Math.sin(theta),
		cameraTarget.y + radius * Math.cos(phi),
		cameraTarget.z + radius * Math.sin(phi) * Math.cos(theta)
	);
	camera.lookAt(cameraTarget);
}
updateCameraPosition();

const pointers = new Map();

function getPointerDistance() {
	const pts = Array.from(pointers.values());
	const dx = pts[0].x - pts[1].x;
	const dy = pts[0].y - pts[1].y;
	return Math.sqrt(dx * dx + dy * dy);
}

let lastPinchDistance = null;

renderer.domElement.addEventListener("pointerdown", (e) => {
	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
	if (pointers.size === 2) lastPinchDistance = getPointerDistance();
});

renderer.domElement.addEventListener("pointermove", (e) => {
	if (!pointers.has(e.pointerId)) return;

	const prev = pointers.get(e.pointerId);
	const dx = e.clientX - prev.x;
	const dy = e.clientY - prev.y;
	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

	if (pointers.size === 1) {
		const sensitivity = 0.005;
		theta -= dx * sensitivity;
		phi -= dy * sensitivity;
		phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi));
		updateCameraPosition();
	} else if (pointers.size === 2) {
		const currentDistance = getPointerDistance();
		if (lastPinchDistance !== null) {
			const delta = currentDistance - lastPinchDistance;
			radius -= delta * (horizontalSize * 0.02);
			radius = Math.max(horizontalSize * 0.4, Math.min(horizontalSize * 5, radius));
			updateCameraPosition();
		}
		lastPinchDistance = currentDistance;
	}
});

// zoom a la molette (souris) — equivalent du pincement tactile
renderer.domElement.addEventListener("wheel", (e) => {
	e.preventDefault();
	radius += e.deltaY * (horizontalSize * 0.001);
	radius = Math.max(horizontalSize * 0.4, Math.min(horizontalSize * 5, radius));
	updateCameraPosition();
}, { passive: false });

// --- Outils ---

let tapMode = "build";
let currentElement = "sand";

// le pinceau se regle par PALIER (1 a 6), pas directement en taille : chaque palier double
// la taille reelle (1x1, 2x2, 4x4, 8x8, 16x16, 32x32), donc n'expose que peu de choix a
// l'utilisateur tout en couvrant une large plage
const BRUSH_LEVELS = [1, 2, 4, 8, 16, 32];
let brushLevel = 3; // palier par defaut -> taille 4x4x4
let brushSize = BRUSH_LEVELS[brushLevel - 1];

document.querySelectorAll(".tool").forEach((btn) => {
	btn.addEventListener("click", (e) => {
		// si on tenait quelque chose et qu'on change d'outil, on le depose plutot que de le perdre
		if (tapMode === "drag" && heldVoxels) releaseDragSelection();

		if (e.currentTarget.dataset.mode === "destroy") {
			tapMode = "destroy";
		} else if (e.currentTarget.dataset.mode === "drag") {
			tapMode = "drag";
		} else if (e.currentTarget.dataset.el) {
			tapMode = "build";
			currentElement = e.currentTarget.dataset.el;
		}
		document.querySelectorAll(".tool").forEach((b) => b.classList.remove("active"));
		e.currentTarget.classList.add("active");
		updateCursorAppearance();
	});
});

document.querySelectorAll(".brush-btn").forEach((btn) => {
	btn.addEventListener("click", (e) => {
		const action = e.currentTarget.dataset.action;
		if (action === "increase") brushLevel = Math.min(BRUSH_LEVELS.length, brushLevel + 1);
		else if (action === "decrease") brushLevel = Math.max(1, brushLevel - 1);
		brushSize = BRUSH_LEVELS[brushLevel - 1];
		updateCursorAppearance();
	});
});

// retire tout ce qui existe et remet la couche de sable de depart (y=0 partout), comme au
// tout premier chargement — reutilise activeFalling (deja tenu a jour, contient TOUTES les
// cases occupees puisque tous nos types sont "capables de tomber") plutot que de parcourir
// toute la grille, meme les cases vides
function resetTerrain() {
	// annule proprement tout ce qui est en cours (une saisie Drag active, par exemple)
	heldVoxels = null;
	dragBrushSize = null;

	const occupied = Array.from(activeFalling, decodeCellKey);
	for (const [x, y, z] of occupied) {
		if (indexAt[x][y][z]) removeVoxelInstance(x, y, z);
	}

	for (let x = 0; x < SIZE_X; x++) {
		for (let z = 0; z < SIZE_Z; z++) {
			createVoxelInstance(x, 0, z, "rock");
		}
	}

	updateHeldVisual();
	updateCursorAppearance();
}

document.getElementById("reset-btn").addEventListener("click", resetTerrain);

// --- Interaction tactile : uniquement la camera (orbiter/zoomer), plus aucun dessin/destruction
// au tap — toute construction/destruction passe desormais par le clavier (Espace/Entree/Retour
// arriere), voir plus bas

function releasePointer(e) {
	pointers.delete(e.pointerId);
	lastPinchDistance = pointers.size === 2 ? getPointerDistance() : null;
}
renderer.domElement.addEventListener("pointerup", releasePointer);
renderer.domElement.addEventListener("pointercancel", releasePointer);

// --- Curseur de depot, pilote au clavier (flèches ou ZQSD) : alternative fiable au tap sur une
// face 3D, qui peut echouer a cause de l'occlusion (relief voisin plus haut) ou d'une cible qui
// bouge (l'eau qui coule pendant le geste). Le curseur reste toujours tout en haut de la grille,
// et l'element largue tombe naturellement par la physique existante, comme n'importe quel voxel

let cursorX = Math.floor(SIZE_X / 2);
let cursorZ = Math.floor(SIZE_Z / 2);

// position VISUELLE du curseur (flottante), separee de cursorX/cursorZ (toujours entiers, utilises
// tel quel par toute la logique de grille — capture, construction, destruction). Elle rattrape
// en douceur cursorX/cursorZ a chaque frame, au lieu de sauter instantanement case par case —
// c'est ce qui rendait le deplacement du cube (et de la boule tenue en Drag) saccade
let visualCursorX = cursorX;
let visualCursorZ = cursorZ;
const CURSOR_VISUAL_SMOOTHING = 14; // plus grand = rattrape plus vite la position logique

function updateVisualCursorPosition(deltaMs) {
	const t = 1 - Math.exp(-CURSOR_VISUAL_SMOOTHING * (deltaMs / 1000)); // lissage independant du framerate
	visualCursorX += (cursorX - visualCursorX) * t;
	visualCursorZ += (cursorZ - visualCursorZ) * t;
}

const MAX_BRUSH = 32; // taille reelle maximale atteignable (palier 6)

// on reserve quelques couches tout en haut de la grille comme "marge de manoeuvre" : sans ca,
// il serait geometriquement impossible que la base d'un pinceau 4x4x4 tombe au meme niveau
// que celle d'un pinceau 1x1x1 (il faut de la place pour que les tailles plus grandes s'etendent
// vers le haut sans depasser le sommet reel de la grille)
const DROP_BOTTOM_Y = SIZE_Y - 1 - (MAX_BRUSH - 1);

// geometrie "unitaire" (une case), a la taille EXACTE d'un voxel — mise a l'echelle par
// brushSize ensuite (voir updateBuildCursor), donc doit faire pile VOXEL pour que le cube
// affiche corresponde exactement au volume reellement pose (brushSize x VOXEL par axe).
// Un facteur de reduction ici se serait multiplie par brushSize, rendant le cube de plus en
// plus petit que ce qu'il represente a mesure que le pinceau grandit
const cursorGeometry = new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL);
const cursorMaterial = new THREE.MeshBasicMaterial({ color: 0x67f668, wireframe: true });
const cursorMesh = new THREE.Mesh(cursorGeometry, cursorMaterial);
scene.add(cursorMesh);

function findTopmostOccupiedY(x, z) {
	for (let y = SIZE_Y - 1; y >= 0; y--) {
		if (grid[x][y][z] !== "empty") return y;
	}
	return -1;
}

// genere les positions possibles a l'interieur d'une sphere inscrite dans un cube de cote
// "size", triees par distance croissante au centre — jamais les coins du cube, sinon on obtient
// un cube plein et non une boule. Definie ICI (avant le pool de marqueurs) pour pouvoir
// dimensionner ce dernier correctement — une sphere complete peut necessiter bien plus de
// marqueurs qu'un simple marqueur par colonne
function generateBallOffsets(size) {
	const offset = Math.floor(size / 2);
	const boxMinX = -offset, boxMaxX = -offset + size - 1;
	// Y suit la MEME convention que le cube affiche (updateBuildCursor) : base a 0, pas symetrique
	// autour de 0 comme X/Z — sinon la moitie de la sphere (dy negatifs) se retrouve SOUS le cube
	const boxMinY = 0, boxMaxY = size - 1;
	const boxMinZ = -offset, boxMaxZ = -offset + size - 1;
	const centerX = (boxMinX + boxMaxX) / 2, centerY = (boxMinY + boxMaxY) / 2, centerZ = (boxMinZ + boxMaxZ) / 2;
	const sphereRadius = (size / 2) * 0.9; // legere marge de securite, pour ne jamais toucher les bords du cube

	const candidates = [];
	for (let dx = boxMinX; dx <= boxMaxX; dx++) {
		for (let dy = boxMinY; dy <= boxMaxY; dy++) {
			for (let dz = boxMinZ; dz <= boxMaxZ; dz++) {
				const dist = Math.sqrt((dx - centerX) ** 2 + (dy - centerY) ** 2 + (dz - centerZ) ** 2);
				if (dist > sphereRadius) continue; // hors de la sphere inscrite : jamais utilise
				candidates.push({ dx, dy, dz, dist });
			}
		}
	}
	candidates.sort((a, b) => a.dist - b.dist);
	return candidates;
}

// cache de la CAPACITE (nombre de positions) par taille de pinceau — seulement 5 valeurs
// possibles (BRUSH_LEVELS), calculees une seule fois chacune. Sans ca, connaitre juste la
// capacite (utilisee a CHAQUE FRAME par l'apercu de Drag) regenererait et retrierait toute la
// liste de positions (jusqu'a ~1500 pour le plus gros pinceau) 60 fois par seconde
const ballCapacityCache = new Map();
function getBallCapacity(size) {
	if (!ballCapacityCache.has(size)) ballCapacityCache.set(size, generateBallOffsets(size).length);
	return ballCapacityCache.get(size);
}

// taille maximale possible d'une capture Drag (calculee une fois, pour le plus gros pinceau
// possible) — sert a dimensionner a la fois le pool de marqueurs de surbrillance ET le pool de
// cubes visuels tenus
const MAX_HELD_VOXELS = generateBallOffsets(MAX_BRUSH).length;

// pool de petits marqueurs, pour surligner les voxels REELLEMENT vises (Erase en rouge : un par
// colonne, le sommet uniquement — apercu de Drag en bleu : TOUS les voxels qui seraient
// reellement captures, potentiellement plusieurs par colonne) — geometrie DEDIEE, un peu plus
// GRANDE qu'un vrai voxel (pas cursorGeometry, plus petite : un contour plus petit que le voxel
// qu'il souligne se retrouve cache a l'interieur au lieu de deborder visiblement autour, le
// rendant quasi invisible)
const highlightGeometry = new THREE.BoxGeometry(VOXEL * 1.15, VOXEL * 1.15, VOXEL * 1.15);
const highlightMaterial = new THREE.MeshBasicMaterial({ color: 0xff4444, wireframe: true });
const highlightMeshes = [];
for (let i = 0; i < MAX_HELD_VOXELS; i++) {
	const m = new THREE.Mesh(highlightGeometry, highlightMaterial);
	m.visible = false;
	scene.add(m);
	highlightMeshes.push(m);
}

// --- Outil Drag : capture INSTANTANEE, LIMITEE a ce qu'une sphere inscrite dans le cube du
// pinceau peut contenir (pas tout le volume du cube, sinon ca ne ressemble jamais a une boule).
// Les voxels captures sont immediatement retires de la grille (comme une vraie suppression) et
// gardes en memoire (type + couleur + position relative dans la sphere) — ils n'existent plus
// du tout dans le monde pendant qu'on les tient, donc AUCUN systeme (gravite, transformations,
// terrain voisin) n'a jamais besoin de les ignorer ni ne peut jamais les perturber. Le "bloc
// tenu" se deplace de facon RIGIDE avec le curseur (juste une translation, recalculee a chaque
// deplacement, aucune simulation entre-temps) : impossible de perdre un element en route. Une
// petite representation visuelle (les vrais voxels, aux vraies couleurs) suit le curseur pendant
// le transport. Au relachement, le bloc est repose par-dessus le relief a la nouvelle position
// (en gardant sa forme de boule), et la physique normale reprend la main immediatement (chute,
// etc.), exactement comme un terrain normal.

let heldVoxels = null; // liste de { dx, dy, dz, type, color } (position relative au CENTRE de la sphere) ou null
let dragBrushSize = null; // taille du pinceau figee au moment de la capture

// pool de petits cubes solides, aux VRAIES couleurs des voxels transportes — un par voxel tenu,
// cache quand rien n'est tenu ou que l'emplacement n'est pas utilise
const heldVisualGeometry = new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL); // meme taille qu'un vrai voxel, pour se toucher sans espace
const heldVisualMeshes = [];
for (let i = 0; i < MAX_HELD_VOXELS; i++) {
	const mat = new THREE.MeshStandardMaterial({ color: 0xffffff });
	const m = new THREE.Mesh(heldVisualGeometry, mat);
	m.visible = false;
	scene.add(m);
	heldVisualMeshes.push(m);
}

// combien de cubes visuels etaient actifs lors du dernier appel — sert a ne cacher QUE le
// delta (voir updateHeldVisual), pas tout le pool a chaque frame (couteux depuis que le pool
// peut contenir plusieurs milliers d'emplacements pour les gros pinceaux)
let heldVisualActiveCount = 0;

// positionne (ou cache) chaque petit cube visuel selon ce qui est actuellement tenu — appelee
// a chaque frame maintenant (voir loop()), puisque la position visuelle lissee change en
// continu meme quand le curseur logique reste fixe (elle rattrape sa cible en douceur)
function updateHeldVisual() {
	const count = heldVoxels ? heldVoxels.length : 0;

	for (let i = 0; i < count; i++) {
		const mesh = heldVisualMeshes[i];
		const v = heldVoxels[i];
		mesh.visible = true;
		mesh.material.color.set(v.color);
		mesh.position.set(worldX(visualCursorX + v.dx), worldY(DROP_BOTTOM_Y + v.dy), worldZ(visualCursorZ + v.dz));
	}
	// on ne cache que ce qui etait actif avant et ne l'est plus (pas tout le pool)
	for (let i = count; i < heldVisualActiveCount; i++) heldVisualMeshes[i].visible = false;
	heldVisualActiveCount = count;
}

// cache de la liste des colonnes triees par distance au centre — ne depend QUE de
// cursorX/cursorZ/brushSize (jamais du terrain), donc inutile de la reconstruire et de la
// retrier a chaque frame : seulement quand le curseur bouge ou que la taille du pinceau change
let cachedColumnsKey = null;
let cachedSortedColumns = null;

function getSortedFootprintColumns() {
	const key = cursorX * 100000 + cursorZ * 100 + brushSize; // encodage simple, suffisant ici
	if (cachedColumnsKey === key) return cachedSortedColumns;

	const offset = Math.floor(brushSize / 2);
	const center = getFootprintCenter();
	const columns = [];
	for (let dx = 0; dx < brushSize; dx++) {
		for (let dz = 0; dz < brushSize; dz++) {
			const tx = cursorX - offset + dx;
			const tz = cursorZ - offset + dz;
			const dist = Math.sqrt((tx - center.x) ** 2 + (tz - center.z) ** 2);
			columns.push({ tx, tz, dist });
		}
	}
	columns.sort((a, b) => a.dist - b.dist);

	cachedColumnsKey = key;
	cachedSortedColumns = columns;
	return columns;
}

// parcourt l'empreinte du pinceau (a la position actuelle du curseur) et renvoie la liste des
// positions REELLES (tx,ty,tz) qui seraient capturees par Drag — CHAQUE colonne descend depuis
// SON PROPRE sommet (pas une reference commune, pour bien suivre un relief irregulier), et on
// s'arrete des que la sphere (inscrite dans le cube du pinceau) est pleine. Fonction PURE (ne
// modifie rien), partagee entre la vraie capture et l'apercu de surbrillance — comme ca, les
// deux utilisent EXACTEMENT le meme calcul et ne peuvent jamais diverger
function computeDragCapturePositions() {
	const capacity = getBallCapacity(brushSize);

	// colonnes triees par distance au CENTRE de l'empreinte (pas un simple parcours ligne par
	// ligne) : sans ca, l'arret des que la sphere est pleine coupait le parcours en plein milieu
	// d'un balayage lineaire, laissant des colonnes entieres jamais visitees — resultat, une
	// capture concentree dans un coin au lieu d'un disque bien centre sous le cube
	const columns = getSortedFootprintColumns();

	const positions = [];
	outer:
	for (const { tx, tz } of columns) {
		if (tx < 0 || tx >= SIZE_X || tz < 0 || tz >= SIZE_Z) continue;

		const localTop = findTopmostOccupiedY(tx, tz); // sommet PROPRE a cette colonne
		if (localTop < 0) continue; // rien dans cette colonne

		for (let dy = 0; dy < brushSize; dy++) {
			if (positions.length >= capacity) break outer; // la sphere est pleine, on s'arrete la

			const ty = localTop - dy;
			if (ty < 0) continue;
			if (grid[tx][ty][tz] === "empty") continue;

			positions.push({ tx, ty, tz });
		}
	}
	return positions;
}

// capture jusqu'a ce qu'une sphere (inscrite dans le cube du pinceau affiche) puisse contenir —
// reutilise EXACTEMENT le meme parcours que l'apercu (computeDragCapturePositions), pour que ce
// qui est surligne avant la capture corresponde toujours a ce qui est vraiment capture
function captureDragSelection() {
	dragBrushSize = brushSize;

	const offsetsPool = generateBallOffsets(dragBrushSize);
	const positions = computeDragCapturePositions();
	const captured = [];

	for (let i = 0; i < positions.length; i++) {
		const { tx, ty, tz } = positions[i];
		const entry = indexAt[tx][ty][tz];
		if (!entry) continue; // garde-fou (ne devrait pas arriver, la case vient d'etre verifiee occupee)

		const color = PALETTES[entry.type][entry.shadeIndex]; // vraie couleur, avant de retirer le voxel
		const o = offsetsPool[i]; // position dans la boule, deja triee par distance au centre

		captured.push({ dx: o.dx, dy: o.dy, dz: o.dz, type: entry.type, color });
		removeVoxelInstance(tx, ty, tz); // retire IMMEDIATEMENT : plus jamais dans le monde pendant la tenue
	}

	if (captured.length > 0) {
		heldVoxels = captured;
		updateHeldVisual();
	} else {
		dragBrushSize = null;
	}
}

// depose la boule EXACTEMENT la ou elle etait affichee (a la hauteur fixe de l'outil, comme
// dropElement pour Build) — pas de calcul de relief pour la poser au sol : elle est simplement
// LARGUEE depuis la ou elle flottait, et c'est la physique normale (chute, diagonale...) qui
// la fait tomber et se poser naturellement, exactement comme un bloc de sable qu'on dessine
function releaseDragSelection() {
	if (!heldVoxels) return;

	for (const v of heldVoxels) {
		const tx = cursorX + v.dx;
		const ty = DROP_BOTTOM_Y + v.dy; // exactement la position ou elle etait affichee
		const tz = cursorZ + v.dz;

		if (tx < 0 || tx >= SIZE_X || ty < 0 || ty >= SIZE_Y || tz < 0 || tz >= SIZE_Z) continue; // perdu si hors limites
		if (grid[tx][ty][tz] !== "empty") continue; // perdu si deja occupe (tres rare a cette hauteur)
		createVoxelInstance(tx, ty, tz, v.type); // la physique normale prend le relais des la prochaine frame
	}

	heldVoxels = null;
	dragBrushSize = null;
	updateHeldVisual(); // cache la representation visuelle
	updateCursorAppearance(); // rafraichit l'apercu (surbrillance) puisqu'on reste en mode drag
}

// centre REEL de l'empreinte du pinceau (X/Z), qui correspond exactement a la ou les voxels
// sont vraiment poses (offset entier asymetrique pour les tailles paires) — avant, le curseur
// affiche etait centre sur cursorX/cursorZ directement, ce qui creait un decalage d'une demi-case
// pour les pinceaux de taille paire (2 et 4) par rapport a la zone reellement affectee
function getFootprintCenter() {
	const offset = Math.floor(brushSize / 2);
	return {
		x: cursorX - offset + (brushSize - 1) / 2,
		z: cursorZ - offset + (brushSize - 1) / 2
	};
}

// meme centrage que getFootprintCenter, mais base sur la position VISUELLE (lissee) du curseur —
// utilise uniquement pour l'affichage du cube (jamais pour la logique de grille, qui doit
// toujours rester sur des cases entieres exactes)
function getVisualFootprintCenter() {
	const offset = Math.floor(brushSize / 2);
	return {
		x: visualCursorX - offset + (brushSize - 1) / 2,
		z: visualCursorZ - offset + (brushSize - 1) / 2
	};
}

// met a jour le curseur (cube plein), aligne sur le centre VISUEL (lisse) de l'empreinte,
// toujours a la meme hauteur fixe quel que soit l'outil (comme demande) — seule sa couleur
// change. Utilise la position lissee (pas cursorX/cursorZ direct) pour un deplacement fluide
// plutot que des sauts case par case
function updateBuildCursor() {
	const center = getVisualFootprintCenter();
	const centerWorldY = (worldY(DROP_BOTTOM_Y) + worldY(DROP_BOTTOM_Y + brushSize - 1)) / 2;

	cursorMesh.visible = true;
	cursorMesh.scale.set(brushSize, brushSize, brushSize);
	cursorMesh.position.set(worldX(center.x), centerWorldY, worldZ(center.z));
}

// combien de marqueurs etaient actifs lors du dernier appel — PARTAGE entre Erase et l'apercu
// de Drag (un seul des deux est actif a la fois) : sert a ne cacher QUE le delta a chaque
// appel, pas tout le pool (couteux depuis que le pool peut contenir plusieurs milliers
// d'emplacements pour les gros pinceaux)
let highlightActiveCount = 0;

// met a jour les marqueurs de surbrillance pour ERASE : un par colonne de l'empreinte,
// positionne exactement sur le voxel qui serait reellement retire (le plus haut occupe de
// cette colonne) — Erase ne retire jamais qu'UN SEUL voxel par colonne, d'ou un marqueur par
// colonne suffit a representer fidelement ce qui serait fait
function updateEraseHighlights() {
	const offset = Math.floor(brushSize / 2);
	let idx = 0;

	for (let dx = 0; dx < brushSize; dx++) {
		for (let dz = 0; dz < brushSize; dz++) {
			const tx = cursorX - offset + dx;
			const tz = cursorZ - offset + dz;

			if (tx < 0 || tx >= SIZE_X || tz < 0 || tz >= SIZE_Z) continue;
			const ty = findTopmostOccupiedY(tx, tz);
			if (ty < 0) continue;

			const mesh = highlightMeshes[idx++];
			mesh.visible = true;
			mesh.position.set(worldX(tx), worldY(ty), worldZ(tz));
		}
	}
	for (let i = idx; i < highlightActiveCount; i++) highlightMeshes[i].visible = false;
	highlightActiveCount = idx;
}

// met a jour les marqueurs de surbrillance pour l'APERCU DE DRAG : un marqueur par voxel
// REELLEMENT capturable (potentiellement plusieurs par colonne, en profondeur, jusqu'a la
// limite de la sphere) — reutilise EXACTEMENT le meme calcul que la vraie capture
// (computeDragCapturePositions), donc ce qui est surligne correspond toujours a ce qui serait
// vraiment saisi (contrairement a avant, ou seul le sommet de chaque colonne etait indique,
// ce qui ne representait qu'une fraction de ce que Drag capture reellement)
function updateDragPreviewHighlights() {
	const positions = computeDragCapturePositions();

	for (let i = 0; i < positions.length; i++) {
		const { tx, ty, tz } = positions[i];
		const mesh = highlightMeshes[i];
		mesh.visible = true;
		mesh.position.set(worldX(tx), worldY(ty), worldZ(tz));
	}
	for (let i = positions.length; i < highlightActiveCount; i++) highlightMeshes[i].visible = false;
	highlightActiveCount = positions.length;
}

// bascule l'apparence selon l'outil actif : le cube du haut reste TOUJOURS visible, a la MEME
// hauteur fixe, et change juste de couleur (vert = build, rouge = destroy, bleu = drag) ; les
// marqueurs sur les cibles reelles s'affichent en mode destroy ET en mode drag (avant capture)
function updateCursorAppearance() {
	const color = tapMode === "build" ? 0x67f668 : tapMode === "destroy" ? 0xff4444 : 0xc0ceb6;
	cursorMaterial.color.set(color);
	updateBuildCursor(); // l'outil reste toujours a la meme hauteur fixe, quel que soit le mode

	if (tapMode === "destroy") {
		highlightMaterial.color.set(color);
		updateEraseHighlights();
	} else if (tapMode === "drag" && !heldVoxels) {
		highlightMaterial.color.set(color);
		updateDragPreviewHighlights();
	} else {
		for (let i = 0; i < highlightActiveCount; i++) highlightMeshes[i].visible = false;
		highlightActiveCount = 0;
	}

	updateHeldVisual(); // deplace (rigidement) la representation visuelle de ce qui est tenu, s'il y en a
}
updateCursorAppearance();

// depose un cube complet de brushSize^3, dont la BASE reste toujours au niveau DROP_BOTTOM_Y
// quelle que soit la taille du pinceau (au lieu d'un sommet fixe et une base qui varie)
function dropElement() {
	const offset = Math.floor(brushSize / 2);

	for (let dx = 0; dx < brushSize; dx++) {
		for (let dy = 0; dy < brushSize; dy++) {
			for (let dz = 0; dz < brushSize; dz++) {
				const tx = cursorX - offset + dx;
				const ty = DROP_BOTTOM_Y + dy; // dy=0 -> base (toujours DROP_BOTTOM_Y), dy croissant -> vers le haut
				const tz = cursorZ - offset + dz;
				if (tx < 0 || tx >= SIZE_X || ty < 0 || ty >= SIZE_Y || tz < 0 || tz >= SIZE_Z) continue;
				if (grid[tx][ty][tz] !== "empty") continue;
				createVoxelInstance(tx, ty, tz, currentElement);
			}
		}
	}
}

// retire, pour chaque colonne de l'empreinte du pinceau, le voxel le plus haut occupe
// (symetrique de dropElement, mais base sur le relief existant plutot qu'un point fixe)
function destroyAtCursor() {
	const offset = Math.floor(brushSize / 2);

	for (let dx = 0; dx < brushSize; dx++) {
		for (let dz = 0; dz < brushSize; dz++) {
			const tx = cursorX - offset + dx;
			const tz = cursorZ - offset + dz;
			if (tx < 0 || tx >= SIZE_X || tz < 0 || tz >= SIZE_Z) continue;
			const ty = findTopmostOccupiedY(tx, tz);
			if (ty < 0) continue;
			removeVoxelInstance(tx, ty, tz);
		}
	}
	updateEraseHighlights();
}

// suivi des touches actuellement enfoncees (plutot que de reagir a chaque evenement keydown
// separement), pour pouvoir traiter DEPLACEMENT et DEPOT en meme temps, en continu, tant que
// les touches restent appuyees — necessaire pour "peindre en marchant"
const heldKeys = new Set();
window.addEventListener("keydown", (e) => heldKeys.add(e.key.toLowerCase()));
window.addEventListener("keyup", (e) => heldKeys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => heldKeys.clear()); // evite une touche "bloquee" enfoncee si on change de fenetre

const CURSOR_MOVE_INTERVAL = 75; // ms entre deux pas de deplacement du curseur (doublee, comme demande)
const ACTION_REPEAT_INTERVAL = 150; // ms entre deux depots/destructions, en continu
let cursorMoveAccumulator = 0;
let actionAccumulator = 0;
let spaceWasHeld = false; // pour detecter un NOUVEL appui (drag), distinct d'un maintien (build/destroy)
let awaitingSpaceRelease = false; // force a attendre un VRAI relachement avant d'accepter une action
// (evite qu'un doigt reste appuye trop longtemps sur Espace ne declenche un depot immediat
// juste apres le retour automatique sur Build+Sand a la fin d'un drag)

function processHeldKeys(deltaMs) {
	// deplacement du curseur, RELATIF a la camera (comme avant), mais reevalue en continu
	cursorMoveAccumulator += deltaMs;
	if (cursorMoveAccumulator >= CURSOR_MOVE_INTERVAL) {
		cursorMoveAccumulator = 0;

		const forwardX = -Math.sin(theta);
		const forwardZ = -Math.cos(theta);
		const rightX = Math.cos(theta);
		const rightZ = -Math.sin(theta);

		function snapToGridStep(dirX, dirZ) {
			if (Math.abs(dirX) > Math.abs(dirZ)) return { dx: Math.sign(dirX), dz: 0 };
			return { dx: 0, dz: Math.sign(dirZ) };
		}

		let moved = false;
		const applyStep = (dirX, dirZ) => {
			const s = snapToGridStep(dirX, dirZ);
			cursorX = Math.max(0, Math.min(SIZE_X - 1, cursorX + s.dx));
			cursorZ = Math.max(0, Math.min(SIZE_Z - 1, cursorZ + s.dz));
			moved = true;
		};

		if (heldKeys.has("arrowup") || heldKeys.has("z")) applyStep(forwardX, forwardZ);
		if (heldKeys.has("arrowdown") || heldKeys.has("s")) applyStep(-forwardX, -forwardZ);
		if (heldKeys.has("arrowleft") || heldKeys.has("q")) applyStep(-rightX, -rightZ);
		if (heldKeys.has("arrowright") || heldKeys.has("d")) applyStep(rightX, rightZ);

		if (moved) updateCursorAppearance();
	}

	// depot/destruction/drag, independant du deplacement — peut se produire EN MEME TEMPS
	actionAccumulator += deltaMs;

	const spaceIsHeldRaw = heldKeys.has(" ") || heldKeys.has("enter");

	// tant qu'on attend un relachement explicite, on ignore completement l'etat de la touche
	// (meme si elle est physiquement toujours enfoncee) jusqu'a ce qu'elle soit vraiment relachee
	if (awaitingSpaceRelease) {
		if (!spaceIsHeldRaw) awaitingSpaceRelease = false;
	}
	const spaceIsHeld = spaceIsHeldRaw && !awaitingSpaceRelease;

	const spaceJustPressed = spaceIsHeld && !spaceWasHeld;
	spaceWasHeld = spaceIsHeld;

	// le drag capture/relache sur un SEUL appui (pas en boucle tant qu'on maintient, contrairement
	// a build/destroy) : sinon on capturerait/relacherait en rafale toutes les 150ms
	if (tapMode === "drag" && spaceJustPressed) {
		if (heldVoxels) releaseDragSelection();
		else captureDragSelection();
		updateCursorAppearance();
	}

	if (actionAccumulator >= ACTION_REPEAT_INTERVAL) {
		actionAccumulator = 0;

		if (tapMode !== "drag" && spaceIsHeld) {
			if (tapMode === "build") dropElement();
			else destroyAtCursor();
		} else if (heldKeys.has("backspace") || heldKeys.has("delete")) {
			destroyAtCursor();
		}
	}
}

window.addEventListener("resize", resizeRendererToContainer);

// --- Transformations ---

function propagate(startX, startY, startZ, rule) {
	if (rule.radius <= 1) return;

	// cle entiere (cellKey) au lieu d'une cle texte, et pointeur de lecture au lieu de
	// queue.shift() (qui reindexe tout le tableau a chaque appel — couteux repete beaucoup
	// de fois pour une propagation large)
	const visited = new Set();
	visited.add(cellKey(startX, startY, startZ));
	const queue = [{ x: startX, y: startY, z: startZ, distance: 0 }];
	let head = 0;

	while (head < queue.length) {
		const current = queue[head++];
		if (current.distance >= rule.radius - 1) continue;

		const neighbors = [
			{ x: current.x - 1, y: current.y, z: current.z },
			{ x: current.x + 1, y: current.y, z: current.z },
			{ x: current.x, y: current.y - 1, z: current.z },
			{ x: current.x, y: current.y + 1, z: current.z },
			{ x: current.x, y: current.y, z: current.z - 1 },
			{ x: current.x, y: current.y, z: current.z + 1 }
		];

		for (const n of neighbors) {
			if (n.x < 0 || n.x >= SIZE_X || n.y < 0 || n.y >= SIZE_Y || n.z < 0 || n.z >= SIZE_Z) continue;
			const key = cellKey(n.x, n.y, n.z);
			if (visited.has(key)) continue;
			visited.add(key);
			if (grid[n.x][n.y][n.z] !== rule.target) continue;

			const nextDistance = current.distance + 1;
			const probability = 1 / (nextDistance + 1);
			if (Math.random() < probability) {
				convertVoxel(n.x, n.y, n.z, rule.result);
				queue.push({ x: n.x, y: n.y, z: n.z, distance: nextDistance });
			}
		}
	}
}

function applyTransformations() {
	// idem que la physique : on ne regarde que les cases candidates (sable/terre), pas toute
	// la grille — un instantane, puisque propagate()/convertVoxel() modifient cet ensemble
	// pendant qu'on le parcourt
	const cells = Array.from(transformCandidates, decodeCellKey);

	for (const [x, y, z] of cells) {
		const cellType = grid[x][y][z];

		for (const rule of TRANSFORMATIONS) {
			if (cellType !== rule.target) continue;

			const neighbors = [
				{ x: x - 1, y, z }, { x: x + 1, y, z },
				{ x, y: y - 1, z }, { x, y: y + 1, z },
				{ x, y, z: z - 1 }, { x, y, z: z + 1 }
			];

			for (const n of neighbors) {
				if (n.x < 0 || n.x >= SIZE_X || n.y < 0 || n.y >= SIZE_Y || n.z < 0 || n.z >= SIZE_Z) continue;
				if (grid[n.x][n.y][n.z] === rule.catalyst) {
					convertVoxel(x, y, z, rule.result);
					removeVoxelInstance(n.x, n.y, n.z);
					propagate(x, y, z, rule);
					break;
				}
			}
		}
	}
}

// --- Physique ---

const animatingEntries = new Set();

const DIAGONAL_DIRECTIONS = [
	{ dx: 1, dz: 0 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }, { dx: 0, dz: -1 }
];

// parcourt les 4 directions en partant d'un index aleatoire (au lieu de copier+melanger tout
// le tableau a chaque appel) : meme resultat statistique (ordre aleatoire), zero allocation
function forEachDirectionRandomStart(callback) {
	const start = Math.floor(Math.random() * DIAGONAL_DIRECTIONS.length);
	for (let i = 0; i < DIAGONAL_DIRECTIONS.length; i++) {
		const dir = DIAGONAL_DIRECTIONS[(start + i) % DIAGONAL_DIRECTIONS.length];
		if (callback(dir)) return true;
	}
	return false;
}

function measureLiquidHeight(x, startY, z, type) {
	let height = 0;
	let y = startY;
	while (y >= 0 && grid[x][y][z] === type) {
		height++;
		y--;
	}
	return height;
}

function moveVoxel(fromX, fromY, fromZ, toX, toY, toZ) {
	const fromEntry = indexAt[fromX][fromY][fromZ];
	const toEntry = indexAt[toX][toY][toZ];

	const fromType = grid[fromX][fromY][fromZ];
	const toType = grid[toX][toY][toZ];

	grid[toX][toY][toZ] = fromType;
	grid[fromX][fromY][fromZ] = toType;

	const fromGroup = groups[fromEntry.type][fromEntry.shadeIndex];
	fromGroup.slotCoords[fromEntry.slot] = { x: toX, y: toY, z: toZ };
	indexAt[toX][toY][toZ] = fromEntry;
	animatingEntries.add(fromEntry);

	if (toEntry) {
		const toGroup = groups[toEntry.type][toEntry.shadeIndex];
		toGroup.slotCoords[toEntry.slot] = { x: fromX, y: fromY, z: fromZ };
		indexAt[fromX][fromY][fromZ] = toEntry;
		animatingEntries.add(toEntry);
	} else {
		indexAt[fromX][fromY][fromZ] = null;
	}

	// on remet a jour les ensembles actifs pour les DEUX cases (ce qu'il y a desormais a
	// l'origine et a la destination a pu changer de nature — vide, ou contenu echange)
	trackCell(toX, toY, toZ, fromType);
	trackCell(fromX, fromY, fromZ, toType);
}

// tente de faire descendre un liquide bloque par le MEME liquide juste en dessous, en poussant
// ce dernier sur le cote (dans une case vide adjacente) pour lui liberer la place — permet a
// l'eau de se "tasser" verticalement plutot que de rester bloquee des qu'il y a deja de l'eau
// juste en dessous, meme s'il reste de la place ailleurs pour que ca s'arrange
function tryDisplaceDown(x, y, z, type) {
	const belowY = y - 1;
	if (grid[x][belowY][z] !== type) return false; // ne s'applique que si bloque par le meme liquide

	return forEachDirectionRandomStart(({ dx, dz }) => {
		const nx = x + dx, nz = z + dz;
		if (nx < 0 || nx >= SIZE_X || nz < 0 || nz >= SIZE_Z) return false;
		if (grid[nx][belowY][nz] !== "empty") return false;

		// on pousse le liquide bloquant sur le cote, puis on fait descendre l'autre a sa place
		moveVoxel(x, belowY, z, nx, belowY, nz);
		movedThisTick.add(cellKey(nx, belowY, nz));
		moveVoxel(x, y, z, x, belowY, z);
		movedThisTick.add(cellKey(x, belowY, z));
		return true;
	});
}

const movedThisTick = new Set();

// seaux reutilises d'un tick a l'autre (pas recrees), un par hauteur possible — evite a la
// fois le cout d'un tri generaliste (O(n log n)) ET la reallocation de tableaux a chaque tick
const yBuckets = Array.from({ length: SIZE_Y }, () => []);

function updatePhysics() {
	movedThisTick.clear();

	// on ne regarde QUE les cases actuellement actives (occupees par un type qui peut tomber),
	// pas toute la grille. Tri par hauteur croissante (pour garder le meme comportement qu'avant :
	// une case qui vient de descendre ne doit pas etre retraitee dans le meme tick) fait par SEAUX
	// plutot que par un tri generaliste — l'intervalle de Y est petit et connu (SIZE_Y), donc
	// bien plus rapide qu'un tri par comparaison pour de grands ensembles actifs
	for (let y = 0; y < SIZE_Y; y++) yBuckets[y].length = 0;
	for (const key of activeFalling) {
		const [x, y, z] = decodeCellKey(key);
		yBuckets[y].push(x, z); // x et z a plat (pas de sous-tableau/objet), moins d'allocations
	}

	for (let y = 0; y < SIZE_Y; y++) {
		const bucket = yBuckets[y];
		for (let i = 0; i < bucket.length; i += 2) {
			const x = bucket[i], z = bucket[i + 1];
			const key = cellKey(x, y, z);
			if (movedThisTick.has(key)) continue;

		const type = grid[x][y][z];
		if (!CAN_FALL.has(type)) continue; // case devenue vide/differente plus tot dans ce tick

		if (y === 0) continue; // deja au sol, rien a faire

		if (canMoveInto(type, grid[x][y - 1][z])) {
			moveVoxel(x, y, z, x, y - 1, z);
			movedThisTick.add(cellKey(x, y - 1, z));
			continue;
		}

		let moved = false;
		if (CAN_DIAGONAL.has(type)) {
			moved = forEachDirectionRandomStart(({ dx, dz }) => {
				const nx = x + dx, nz = z + dz;
				if (nx < 0 || nx >= SIZE_X || nz < 0 || nz >= SIZE_Z) return false;
				if (canMoveInto(type, grid[nx][y - 1][nz])) {
					moveVoxel(x, y, z, nx, y - 1, nz);
					movedThisTick.add(cellKey(nx, y - 1, nz));
					return true;
				}
				return false;
			});
		}
		if (moved) continue;

		// avant de s'etaler sur le cote, un liquide tente d'abord de se tasser verticalement
		// en repoussant le meme liquide juste en dessous, si de la place existe pour ca
		if (CAN_LATERAL.has(type) && tryDisplaceDown(x, y, z, type)) continue;

		if (!CAN_LATERAL.has(type)) continue;

		// un seul passage pour construire les candidats ET leur poids (au lieu de plusieurs
		// tableaux intermediaires via map/filter/reduce)
		const candidates = [];
		let totalWeight = 0;
		for (const { dx, dz } of DIAGONAL_DIRECTIONS) {
			const nx = x + dx, nz = z + dz;
			if (nx < 0 || nx >= SIZE_X || nz < 0 || nz >= SIZE_Z) continue;
			const height = measureLiquidHeight(nx, y, nz, type);
			const weight = 1 / (height + 1);
			candidates.push({ dx, dz, weight });
			totalWeight += weight;
		}

		if (candidates.length === 0) continue;

		let pick = Math.random() * totalWeight;
		let chosen = candidates[0];
		for (const c of candidates) {
			pick -= c.weight;
			if (pick <= 0) { chosen = c; break; }
		}

		const flowRate = ELEMENTS[type].flowRate;
		let step = 0;
		let cx = x, cz = z;
		while (step < flowRate) {
			const nx = cx + chosen.dx, nz = cz + chosen.dz;
			if (nx < 0 || nx >= SIZE_X || nz < 0 || nz >= SIZE_Z) break;
			if (grid[nx][y][nz] !== "empty") break;
			cx = nx; cz = nz;
			step++;
		}

		if (step > 0) {
			moveVoxel(x, y, z, cx, y, cz);
			movedThisTick.add(cellKey(cx, y, cz));
		}
		}
	}
}

const scratchTarget = new THREE.Vector3(); // reutilise a chaque frame, evite une allocation par voxel anime

function updateMoveAnimation(deltaMs) {
	if (animatingEntries.size === 0) return;

	const speed = 1000 / physicsInterval;
	const step = speed * (deltaMs / 1000) * VOXEL;
	const dirtyGroups = new Set();

	for (const entry of animatingEntries) {
		const group = groups[entry.type][entry.shadeIndex];
		const { x, y, z } = group.slotCoords[entry.slot];
		scratchTarget.set(worldX(x), worldY(y), worldZ(z));
		const current = group.currentVisualPos[entry.slot];
		const distance = current.distanceTo(scratchTarget);

		if (distance <= step) {
			current.copy(scratchTarget);
			animatingEntries.delete(entry);
		} else {
			current.lerp(scratchTarget, step / distance);
		}

		writeMatrixAt(group.mesh, entry.slot, current);
		dirtyGroups.add(group);
	}

	for (const group of dirtyGroups) group.mesh.instanceMatrix.needsUpdate = true;
}

// --- FPS + boucle ---

const fpsDisplay = document.createElement("div");
fpsDisplay.style.cssText = "position:absolute;top:8px;left:8px;color:#0f0;font-family:monospace;font-size:14px;z-index:10;pointer-events:none;";
gameContainer.appendChild(fpsDisplay);

let frameCounter = 0;
let fpsWindowStart = performance.now();
let displayedFps = 0;

function updateFpsDisplay(now) {
	frameCounter++;
	if (now - fpsWindowStart >= 1000) {
		displayedFps = frameCounter;
		frameCounter = 0;
		fpsWindowStart = now;
	}
	let totalVoxels = 0;
	for (const type of Object.keys(groups)) {
		for (const g of groups[type]) totalVoxels += g.mesh.count;
	}
	fpsDisplay.textContent = `${displayedFps} fps — ${totalVoxels} voxels`;
}

function loop(now) {
	const deltaMs = now - lastFrameTime;
	physicsAccumulator += deltaMs;
	lastFrameTime = now;

	processHeldKeys(deltaMs);

	while (physicsAccumulator >= physicsInterval) {
		applyTransformations();
		updatePhysics();
		physicsAccumulator -= physicsInterval;
	}

	// les surlignements (Erase, apercu de Drag) suivent le relief REEL, qui peut changer meme
	// sans bouger le curseur (un voxel qui tombe, un tas qui s'effondre...) : il faut donc les
	// rafraichir a chaque frame, pas seulement quand le curseur bouge
	if (tapMode === "destroy") {
		updateEraseHighlights();
	} else if (tapMode === "drag" && !heldVoxels) {
		updateDragPreviewHighlights();
	}

	// le cube et la boule tenue suivent une position VISUELLE lissee (rattrape la position
	// logique en douceur), donc a repositionner chaque frame — meme quand le curseur logique
	// ne bouge plus, la position visuelle peut encore etre en train de rattraper sa cible
	updateVisualCursorPosition(deltaMs);
	updateBuildCursor();
	updateHeldVisual();

	updateMoveAnimation(deltaMs);
	renderer.render(scene, camera);
	updateFpsDisplay(now);
	requestAnimationFrame(loop);
}

let lastFrameTime = performance.now();
let physicsAccumulator = 0;
const physicsInterval = 90; // accelere par rapport a avant (120ms), rendu possible par l'optimisation ci-dessus

loop(lastFrameTime);
