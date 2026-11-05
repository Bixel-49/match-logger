// Stockage local sur le telephone (localStorage). Rien n'est envoye sur internet.

const KEYS = {
  players: 'ml.players',
  formations: 'ml.formations',
  matches: 'ml.matches',
  draft: 'ml.draft',
};

export const DEFAULT_FORMATIONS = {
  '4-4-2': ['G', 'D1', 'D2', 'D3', 'D4', 'M1', 'M2', 'M3', 'M4', 'A1', 'A2'],
  '4-3-3': ['G', 'D1', 'D2', 'D3', 'D4', 'M1', 'M2', 'M3', 'A1', 'A2', 'A3'],
  '4-2-3-1': ['G', 'D1', 'D2', 'D3', 'D4', 'MD1', 'MD2', 'M1', 'M2', 'M3', 'A1'],
  '4-1-4-1': ['G', 'D1', 'D2', 'D3', 'D4', 'MD1', 'M1', 'M2', 'M3', 'M4', 'A1'],
};

export const POSITIONS = { G: 'Gardiens', D: 'Défenseurs', M: 'Milieux', A: 'Attaquants' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

// Laisse remonter l'erreur (stockage plein) pour que l'interface la signale
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// --- Joueurs et formations (equivalent de config.json) ---

export function getPlayers() {
  return read(KEYS.players, []);
}

export function setPlayers(players) {
  write(KEYS.players, players);
}

export function getFormations() {
  return read(KEYS.formations, DEFAULT_FORMATIONS);
}

export function applyConfig(config) {
  if (!config || !Array.isArray(config.players)) throw new Error('Fichier de configuration invalide : liste "players" absente');
  const players = config.players
    .filter((p) => p && typeof p.name === 'string' && p.name.trim())
    .map((p) => ({ name: p.name.trim(), position: String(p.position || '').toUpperCase() }));
  setPlayers(players);
  if (config.formations && typeof config.formations === 'object') write(KEYS.formations, config.formations);
  return players.length;
}

// Mise a jour depuis un fichier recu d'un autre telephone : ajoute les joueurs et
// compositions absents, met a jour ceux qui ont change. Rien n'est supprime.
export function mergeConfig(config) {
  let addedPlayers = 0;
  let updatedPlayers = 0;
  let changedFormations = 0;
  if (Array.isArray(config?.players)) {
    const players = getPlayers();
    const byName = new Map(players.map((p) => [p.name.toLowerCase(), p]));
    for (const p of config.players) {
      const name = typeof p?.name === 'string' ? p.name.trim() : '';
      if (!name) continue;
      const position = String(p.position || '').toUpperCase();
      const existing = byName.get(name.toLowerCase());
      if (!existing) {
        const added = { name, position };
        players.push(added);
        byName.set(name.toLowerCase(), added);
        addedPlayers++;
      } else if (position && existing.position !== position) {
        existing.position = position;
        updatedPlayers++;
      }
    }
    if (addedPlayers + updatedPlayers) setPlayers(players);
  }
  if (config?.formations && typeof config.formations === 'object' && !Array.isArray(config.formations)) {
    const formations = { ...getFormations() };
    for (const [name, positions] of Object.entries(config.formations)) {
      if (!Array.isArray(positions)) continue;
      const next = positions.map(String);
      if (JSON.stringify(formations[name]) === JSON.stringify(next)) continue;
      formations[name] = next;
      changedFormations++;
    }
    if (changedFormations) write(KEYS.formations, formations);
  }
  return { addedPlayers, updatedPlayers, changedFormations };
}

export function exportConfig() {
  return { formations: getFormations(), players: getPlayers() };
}

// --- Matchs ---

export function getMatches() {
  return read(KEYS.matches, []);
}

export function getMatch(id) {
  return getMatches().find((m) => m.id === id) || null;
}

export function saveMatch(record) {
  const matches = getMatches();
  const index = matches.findIndex((m) => m.id === record.id);
  const saved = { ...record, updatedAt: new Date().toISOString() };
  if (index >= 0) matches[index] = saved;
  else matches.push(saved);
  write(KEYS.matches, matches);
  return saved;
}

export function saveMatches(records) {
  write(KEYS.matches, records);
}

export function deleteMatch(id) {
  write(KEYS.matches, getMatches().filter((m) => m.id !== id));
}

export function teamsInUse() {
  return [...new Set(getMatches().map((m) => m.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
}

// --- Brouillon du match en cours (survit a la fermeture de l'app) ---

export function getDraft() {
  return read(KEYS.draft, null);
}

export function setDraft(draft) {
  try {
    write(KEYS.draft, draft);
  } catch {
    // brouillon non critique
  }
}

export function clearAll() {
  for (const key of Object.values(KEYS)) localStorage.removeItem(key);
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // non supporte
  }
}
