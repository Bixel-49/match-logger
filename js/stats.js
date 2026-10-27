// Calculs des statistiques, portés depuis statistics.py (sans interface).
// Un "record" = { id, name, team, competition, updatedAt, data } où data est le JSON du match
// au même format que l'application Python.

export const STAR_IDS = ['STAR1', 'STAR2', 'STAR3'];
export const STAR_POINTS = { STAR1: 3, STAR2: 2, STAR3: 1 };
export const SUB_IDS = ['R0', 'R1', 'R2', 'R3', 'R4'];
export const COMPETITIONS = { championnat: 'Championnat', coupe: 'Coupe', autre: 'Autre' };
export const CSC = 'CSC';

export const isSub = (posId) => posId.startsWith('R');
export const isStar = (posId) => posId.startsWith('STAR');
export const isStarter = (posId) => !isSub(posId) && !isStar(posId);

export class Counter extends Map {
  add(key, n = 1) {
    this.set(key, (this.get(key) || 0) + n);
    return this;
  }
  // Equivalent de Counter.most_common : tri decroissant, stable pour les egalites
  mostCommon(limit) {
    const sorted = [...this.entries()].sort((a, b) => b[1] - a[1]);
    return limit == null ? sorted : sorted.slice(0, limit);
  }
}

// Les joueurs d'un match peuvent etre un dict (format normal) ou une liste (anciens fichiers)
export function playerEntries(players) {
  if (Array.isArray(players)) return players.map((p, i) => [String(i), p]);
  if (players && typeof players === 'object') return Object.entries(players);
  return [];
}

const LINE_ORDER = { G: 0, D: 1, MD: 2, M: 3, A: 4 };

export function positionSortKey(posId) {
  if (isSub(posId)) return [2, 0, parseInt(posId.slice(1), 10) || 0];
  if (isStar(posId)) return [3, 0, parseInt(posId.slice(4), 10) || 0];
  const m = /^([A-Z]+)(\d*)$/.exec(posId) || [];
  return [1, LINE_ORDER[m[1]] ?? 9, parseInt(m[2], 10) || 0];
}

export function comparePositions(a, b) {
  const ka = positionSortKey(a);
  const kb = positionSortKey(b);
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
  return 0;
}

export function parseScore(score) {
  if (typeof score !== 'string') return null;
  const value = score.trim();
  for (const sep of ['-', ':', '–', '—']) {
    if (!value.includes(sep)) continue;
    const parts = value.split(sep).map((p) => p.trim());
    if (parts.length !== 2) continue;
    if (!/^[+-]?\d+$/.test(parts[0]) || !/^[+-]?\d+$/.test(parts[1])) return null;
    return [parseInt(parts[0], 10), parseInt(parts[1], 10)];
  }
  return null;
}

// Resultat deduit du score et du lieu ("Domicile" = notre score en premier)
export function resultFromScore(score, location) {
  const parsed = parseScore(score);
  if (!parsed || !['Domicile', 'Exterieur'].includes(location)) return '';
  const [ours, theirs] = location === 'Domicile' ? parsed : [parsed[1], parsed[0]];
  if (ours > theirs) return 'Gagne';
  if (ours < theirs) return 'Perdu';
  return 'Nul';
}

export function countAssists(players, playerName) {
  let count = 0;
  for (const [, p] of playerEntries(players)) {
    for (const g of p?.goals || []) if (g?.assist === playerName) count++;
  }
  return count;
}

export function playerNamesIn(records) {
  const names = new Set();
  for (const r of records) {
    for (const [, p] of playerEntries(r.data.players)) if (p?.name) names.add(p.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, 'fr'));
}

// --- Details d'un match ---------------------------------------------------

export function matchSummary(data) {
  const entries = playerEntries(data.players);
  const goals = [];
  const stars = [];
  for (const [posId, p] of entries) {
    if (!p || typeof p !== 'object') continue;
    const name = p.name || 'N/A';
    const starIndex = STAR_IDS.indexOf(posId);
    if (starIndex >= 0) stars.push({ rank: starIndex + 1, name });
    for (const g of p.goals || []) goals.push({ scorer: name, assist: g?.assist || '' });
  }
  stars.sort((a, b) => a.rank - b.rank);
  const lineup = entries
    .filter(([posId, p]) => !isStar(posId) && p && typeof p === 'object')
    .sort((a, b) => comparePositions(a[0], b[0]));
  return { goals, stars, lineup };
}

export function startersOf(data) {
  return playerEntries(data.players)
    .filter(([posId, p]) => isStarter(posId) && p?.name)
    .sort((a, b) => comparePositions(a[0], b[0]))
    .map(([, p]) => p.name);
}

// --- Rapport complet (fenetre "Statistiques cumulees") ---------------------

const rankRows = (counter, unit, { skip = [], minCount = 1 } = {}) =>
  counter
    .mostCommon()
    .filter(([name, count]) => !skip.includes(name) && count >= minCount)
    .map(([label, count]) => ({ label, value: `${count} ${unit}${count > 1 ? 's' : ''}` }));

export function fullReport(records) {
  const goals = new Counter();
  const assists = new Counter();
  const yellow = new Counter();
  const white = new Counter();
  const red = new Counter();
  const formationWins = new Counter();
  const assistLinks = new Map();
  const starterWins = new Counter();
  const allWins = new Counter();
  const stars = new Counter();
  const lineupWins = new Map(); // cle = noms tries des titulaires

  for (const { data } of records) {
    const entries = playerEntries(data.players);

    if (data.result === 'Gagne') {
      formationWins.add(data.formation || '');
      // Un joueur ne compte qu'une victoire par match, meme s'il est aussi etoile
      const everyone = new Set(entries.filter(([posId, p]) => !isStar(posId) && p?.name).map(([, p]) => p.name));
      for (const name of everyone) allWins.add(name);
      const starters = startersOf(data);
      for (const name of new Set(starters)) starterWins.add(name);
      if (starters.length) {
        const key = [...new Set(starters)].sort((a, b) => a.localeCompare(b, 'fr')).join('\n');
        lineupWins.set(key, (lineupWins.get(key) || 0) + 1);
      }
    }

    for (const [posId, p] of entries) {
      const name = p?.name;
      if (!name) continue;
      yellow.add(name, Number(p.yellow_cards) || 0);
      white.add(name, Number(p.white_cards) || 0);
      if (p.red_card) red.add(name);
      if (posId in STAR_POINTS) stars.add(name, STAR_POINTS[posId]);
      for (const g of p.goals || []) {
        goals.add(name);
        if (g?.assist) {
          assists.add(g.assist);
          if (!assistLinks.has(name)) assistLinks.set(name, new Counter());
          assistLinks.get(name).add(g.assist);
        }
      }
    }
  }

  if (!goals.size && !stars.size) return [];

  const sections = [
    { title: 'Buts par joueur', ranked: true, rows: rankRows(goals, 'but') },
    { title: 'Passes décisives par joueur', ranked: true, rows: rankRows(assists, 'passe', { skip: [CSC] }) },
    { title: 'Étoiles (1re = 3 pts, 2e = 2 pts, 3e = 1 pt)', ranked: true, rows: rankRows(stars, 'pt') },
    { title: 'Cartons jaunes', rows: rankRows(yellow, 'jaune') },
    { title: 'Cartons blancs', rows: rankRows(white, 'blanc') },
    { title: 'Cartons rouges', rows: rankRows(red, 'rouge') },
  ];

  if (formationWins.size) {
    const [formation, wins] = formationWins.mostCommon(1)[0];
    sections.push({
      title: 'Composition avec le plus de victoires',
      rows: [{ label: formation || '(non renseignée)', value: `${wins} victoire${wins > 1 ? 's' : ''}` }],
    });
  }

  const links = [];
  for (const [scorer, counter] of assistLinks) {
    const [passer, count] = counter.mostCommon(1)[0];
    if (passer !== CSC) links.push({ text: `${scorer} a été servi ${count} fois par ${passer}` });
  }
  sections.push({ title: 'Meilleurs passeurs associés', rows: links });

  sections.push({
    title: '11 titulaires avec le plus de victoires',
    ranked: true,
    rows: rankRows(starterWins, 'victoire').slice(0, 11),
  });

  const topLineups = [...lineupWins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  sections.push({
    title: 'Top 3 des onze titulaires les plus victorieux',
    rows: topLineups.map(([key, wins], i) => ({ label: `#${i + 1} — ${wins} victoire${wins > 1 ? 's' : ''}`, items: key.split('\n') })),
  });

  sections.push({
    title: 'Victoires, tous joueurs (remplaçants compris)',
    ranked: true,
    rows: rankRows(allWins, 'victoire'),
  });

  return sections;
}

// --- Statistiques d'un joueur ---------------------------------------------

export function playerStats(records, playerName) {
  const s = {
    totalGoals: 0,
    goalsByAssist: new Counter(),
    assistsTo: new Counter(),
    yellow: 0,
    white: 0,
    red: 0,
    starter: 0,
    sub: 0,
    starPoints: 0,
    starRanks: new Counter(),
    matchesWithGoals: [],
    matchesWithAssists: [],
  };

  for (const record of records) {
    const entries = playerEntries(record.data.players);
    let goalsInMatch = 0;
    let assistsInMatch = 0;

    for (const [posId, p] of entries) {
      if (p?.name !== playerName) continue;
      s.yellow += Number(p.yellow_cards) || 0;
      s.white += Number(p.white_cards) || 0;
      if (p.red_card) s.red++;
      if (isSub(posId)) s.sub++;
      else if (isStarter(posId)) s.starter++;
      if (posId in STAR_POINTS) {
        s.starPoints += STAR_POINTS[posId];
        s.starRanks.add(STAR_IDS.indexOf(posId) + 1);
      }
      for (const g of p.goals || []) {
        s.totalGoals++;
        goalsInMatch++;
        const assist = g?.assist || 'Sans passeur';
        if (assist !== CSC) s.goalsByAssist.add(assist);
      }
    }

    for (const [, p] of entries) {
      for (const g of p?.goals || []) {
        if (g?.assist === playerName) {
          assistsInMatch++;
          s.assistsTo.add(p.name || 'N/A');
        }
      }
    }

    if (goalsInMatch) s.matchesWithGoals.push({ record, count: goalsInMatch });
    if (assistsInMatch) s.matchesWithAssists.push({ record, count: assistsInMatch });
  }

  const byName = (a, b) => a.record.name.localeCompare(b.record.name, 'fr');
  s.matchesWithGoals.sort(byName);
  s.matchesWithAssists.sort(byName);
  return s;
}

// --- Rapport club (par equipe et par competition) -------------------------

const SCOPES = ['championnat', 'coupe', 'cumule'];

function emptyBuckets() {
  const make = () => Object.fromEntries(SCOPES.map((k) => [k, new Counter()]));
  return {
    goals: make(),
    assists: make(),
    stars: make(),
    yellow: make(),
    red: make(),
    matchCount: { championnat: 0, coupe: 0 },
  };
}

function clubSections(b) {
  const scopeLabel = { championnat: 'Championnat', coupe: 'Coupe', cumule: 'Cumulé' };
  const sections = [];
  const add = (kind, title, unit, scopes, empty) => {
    for (const scope of scopes) {
      sections.push({
        title: `${title} — ${scopeLabel[scope]}`,
        ranked: true,
        rows: rankRows(b[kind][scope], unit),
        empty: `${empty} (${scopeLabel[scope].toLowerCase()})`,
      });
    }
  };
  add('goals', 'Buteurs', 'buts', SCOPES, 'Aucun buteur');
  add('assists', 'Passeurs', 'passe', SCOPES, 'Aucun passeur');
  add('stars', 'Étoiles', 'pt', SCOPES, 'Aucune étoile');
  add('yellow', 'Cartons jaunes', 'jaune', ['cumule'], 'Aucun carton jaune');
  add('red', 'Cartons rouges', 'rouge', ['cumule'], 'Aucun carton rouge');
  return sections;
}

export function clubReport(records) {
  const teams = new Map();
  const total = emptyBuckets();

  for (const record of records) {
    const teamName = record.team || 'Sans équipe';
    if (!teams.has(teamName)) teams.set(teamName, emptyBuckets());
    const team = teams.get(teamName);
    const competition = record.competition === 'championnat' || record.competition === 'coupe' ? record.competition : null;
    const scopes = competition ? [competition, 'cumule'] : ['cumule'];
    const bump = (kind, name, n = 1) => {
      for (const scope of scopes) {
        team[kind][scope].add(name, n);
        total[kind][scope].add(name, n);
      }
    };

    if (competition) {
      team.matchCount[competition]++;
      total.matchCount[competition]++;
    }

    for (const [posId, p] of playerEntries(record.data.players)) {
      if (!p || typeof p !== 'object' || !p.name) continue;
      bump('yellow', p.name, Number(p.yellow_cards) || 0);
      bump('red', p.name, p.red_card ? 1 : 0);
      if (posId in STAR_POINTS) bump('stars', p.name, STAR_POINTS[posId]);
      for (const g of p.goals || []) {
        if (!g || typeof g !== 'object' || p.name === CSC) continue;
        bump('goals', p.name);
        if (g.assist && g.assist !== CSC) bump('assists', g.assist);
      }
    }
  }

  // Tableaux "Joueur;Championnat;Coupe" tries sur le cumul
  const table = (kind, title, { skipZero = false } = {}) => {
    const names = new Set([...total[kind].championnat.keys(), ...total[kind].coupe.keys()]);
    const rows = [...names]
      .filter((n) => n !== CSC)
      .sort((a, b) => (total[kind].cumule.get(b) || 0) - (total[kind].cumule.get(a) || 0))
      .map((n) => [n, total[kind].championnat.get(n) || 0, total[kind].coupe.get(n) || 0])
      .filter((row) => !skipZero || row[1] + row[2] > 0);
    return { title, header: ['Joueur', 'Championnat', 'Coupe'], rows };
  };

  return {
    teams: [...teams.entries()]
      .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase(), 'fr'))
      .map(([name, b]) => ({ name, matchCount: b.matchCount, sections: clubSections(b) })),
    total: { matchCount: total.matchCount, sections: clubSections(total) },
    tables: [
      table('goals', 'Buteurs'),
      table('assists', 'Passeurs'),
      table('stars', 'Étoiles'),
      table('yellow', 'Cartons jaunes', { skipZero: true }),
      table('red', 'Cartons rouges', { skipZero: true }),
    ],
  };
}

export function tablesToCsv(tables) {
  const cell = (v) => {
    const s = String(v);
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return tables
    .map((t) => [`=== ${t.title.toUpperCase()} ===`, t.header.join(';'), ...t.rows.map((r) => r.map(cell).join(';'))].join('\n'))
    .join('\n\n');
}

// --- Verification des matchs ----------------------------------------------

const REQUIRED_FIELDS = ['date', 'opponent', 'location', 'formation', 'players', 'score', 'result'];

export function verifyMatch(data) {
  const warnings = [];
  const missing = REQUIRED_FIELDS.filter((f) => !(f in data));
  if (missing.length) warnings.push(`Champs manquants : ${missing.join(', ')}`);

  const location = data.location;
  if (location && !['Domicile', 'Exterieur'].includes(location)) warnings.push(`Lieu invalide : '${location}'`);

  const parsed = parseScore(data.score);
  if (!parsed) warnings.push(`Score final non valide : '${data.score ?? ''}'`);

  const players = data.players;
  let entries = [];
  if (!players || (typeof players === 'object' && !Object.keys(players).length)) {
    warnings.push('Aucune donnée de joueurs détectée');
  } else if (typeof players === 'object') {
    entries = playerEntries(players);
  } else {
    warnings.push('Format des joueurs non valide');
  }

  let totalGoals = 0;
  for (const [, p] of entries) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      warnings.push('Entrée joueur mal formée');
      continue;
    }
    const who = p.name || 'N/A';
    if (!p.name) warnings.push('Joueur sans nom détecté');
    const goals = p.goals;
    if (goals == null) continue;
    if (!Array.isArray(goals)) {
      warnings.push(`Format des buts invalide pour le joueur ${who}`);
      continue;
    }
    goals.forEach((g, i) => {
      if (!g || typeof g !== 'object') {
        warnings.push(`But #${i + 1} du joueur ${who} mal formé`);
        return;
      }
      totalGoals++;
      if (g.assist == null || (typeof g.assist === 'string' && !g.assist.trim())) {
        warnings.push(`But #${i + 1} du joueur ${who} sans passeur renseigné`);
      } else if (typeof g.assist !== 'string') {
        warnings.push(`But #${i + 1} du joueur ${who} avec passeur non valide`);
      }
    });
  }

  if (parsed) {
    const expected = location === 'Domicile' ? parsed[0] : location === 'Exterieur' ? parsed[1] : null;
    if (expected == null) {
      warnings.push("Impossible de comparer les buts au score : le lieu n'est pas 'Domicile' ou 'Exterieur'");
    } else if (totalGoals !== expected) {
      warnings.push(`Le nombre de buts enregistrés (${totalGoals}) ne correspond pas au score de l'équipe (${expected})`);
    }
  }

  if (players && typeof players === 'object' && !Array.isArray(players)) {
    for (const star of STAR_IDS) {
      const s = players[star];
      if (!s) warnings.push(`${star} manquant`);
      else if (typeof s !== 'object' || !s.name) warnings.push(`${star} mal renseigné`);
    }
  } else {
    warnings.push('Étoiles non renseignées avec le format attendu');
  }

  return warnings;
}

export function verifyAll(records) {
  const results = [];
  for (const record of records) {
    const warnings = verifyMatch(record.data);
    if (warnings.length) results.push({ record, warnings });
  }
  return { total: records.length, results };
}
