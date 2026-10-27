import * as store from './store.js';
import {
  COMPETITIONS,
  STAR_IDS,
  SUB_IDS,
  isStar,
  isSub,
  countAssists,
  playerEntries,
  playerNamesIn,
  matchSummary,
  startersOf,
  fullReport,
  playerStats,
  clubReport,
  tablesToCsv,
  verifyMatch,
  verifyAll,
  resultFromScore,
} from './stats.js';
import { createZip, readZip } from './zip.js';

// ---------------------------------------------------------------------------
// Utilitaires DOM
// ---------------------------------------------------------------------------

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && !['list', 'form'].includes(key)) el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) el.append(child instanceof Node ? child : String(child));
  return el;
}

const normalize = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const safeFileName = (name) => name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function field(label, control, extraClass = '') {
  return h('label', { class: `field ${extraClass}` }, h('span', { class: 'field-label' }, label), control);
}

function selectInput(options, value, onchange) {
  return h(
    'select',
    { class: 'input', onchange: (e) => onchange(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
  );
}

function toast(message) {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

// Feuilles modales en bas d'ecran. Le bouton retour d'Android les ferme.
const sheets = [];

window.addEventListener('popstate', () => {
  const top = sheets.pop();
  if (!top) return;
  top.el.remove();
  if (!sheets.length) document.body.classList.remove('no-scroll');
  top.resolve?.();
});

function openSheet(title, build) {
  const entry = { el: null, resolve: null };
  const close = () =>
    new Promise((resolve) => {
      if (!sheets.includes(entry)) return resolve();
      entry.resolve = resolve;
      history.back();
    });
  const { body, actions = [] } = build(close);
  const sheet = h(
    'div',
    { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Fermer', onclick: close }, '✕')),
    h('div', { class: 'sheet-body' }, body),
    actions.length ? h('div', { class: 'sheet-actions' }, actions) : null,
  );
  entry.el = h('div', { class: 'sheet-backdrop', onclick: (e) => e.target === entry.el && close() }, sheet);
  document.body.append(entry.el);
  document.body.classList.add('no-scroll');
  sheets.push(entry);
  history.pushState({ sheet: sheets.length }, '');
  return close;
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function canShareFile(file) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

// Boutons "Telecharger" + "Partager" (si le telephone le permet)
function exportButtons(filename, makeBlob) {
  const download = h('button', { class: 'btn', onclick: () => downloadBlob(filename, makeBlob()) }, '⬇️ Télécharger');
  const probe = new File([''], filename, { type: 'text/plain' });
  if (!canShareFile(probe)) return [download];
  const share = h(
    'button',
    {
      class: 'btn',
      onclick: async () => {
        const file = new File([makeBlob()], filename, { type: 'text/plain' });
        try {
          await navigator.share({ files: [file], title: filename });
        } catch (e) {
          if (e.name !== 'AbortError') downloadBlob(filename, makeBlob());
        }
      },
    },
    '📤 Partager',
  );
  return [download, share];
}

function persistOrWarn(action) {
  try {
    action();
    return true;
  } catch (e) {
    alert(`Impossible d'enregistrer sur le téléphone (stockage plein ?).\n${e.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Etat de l'application
// ---------------------------------------------------------------------------

function emptyMatch() {
  // Memes cles que l'application Python
  return { date: '', opponent: '', location: '', formation: '', players: {}, events: {}, score: '', comments: '', result: '' };
}

function newEditor() {
  const last = store.getMatches().at(-1);
  return { id: null, name: '', team: last?.team || '', competition: last?.competition || 'championnat', data: emptyMatch(), dirty: false };
}

const state = {
  view: 'match',
  editor: store.getDraft() || newEditor(),
  statsFilter: { team: '', competition: '' },
  statsExcluded: new Set(),
  statsTab: 'report',
  statsPlayer: '',
  listFilter: { team: '', competition: '', q: '' },
};

function touchEditor() {
  state.editor.dirty = true;
  store.setDraft(state.editor);
}

function defaultMatchName(d) {
  return safeFileName([d.date, d.opponent].filter(Boolean).join(' '));
}

function competitionOptions(withAll = false) {
  const opts = Object.entries(COMPETITIONS);
  return withAll ? [['', 'Toutes compétitions'], ...opts] : opts;
}

function teamOptions(withAll = false) {
  const teams = store.teamsInUse().map((t) => [t, t]);
  return withAll ? [['', 'Toutes équipes'], ...teams] : teams;
}

function sortedRecords(records) {
  return [...records].sort(
    (a, b) =>
      (a.team || '').localeCompare(b.team || '', 'fr') ||
      (a.competition || '').localeCompare(b.competition || '', 'fr') ||
      a.name.localeCompare(b.name, 'fr', { numeric: true }),
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

const VIEWS = {
  match: { label: 'Match', icon: '⚽', render: renderMatchView },
  matches: { label: 'Matchs', icon: '📁', render: renderMatchesView },
  stats: { label: 'Stats', icon: '📊', render: renderStatsView },
  club: { label: 'Club', icon: '🏆', render: renderClubView },
  settings: { label: 'Réglages', icon: '⚙️', render: renderSettingsView },
};

function go(view) {
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

function render() {
  const main = document.getElementById('view');
  main.replaceChildren(VIEWS[state.view].render());
  for (const btn of document.querySelectorAll('.tabbar button')) {
    if (btn.dataset.view === state.view) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
}

function rerenderKeepScroll() {
  const y = window.scrollY;
  render();
  window.scrollTo(0, y);
}

function buildTabbar() {
  const bar = document.getElementById('tabbar');
  bar.replaceChildren(
    ...Object.entries(VIEWS).map(([key, v]) =>
      h('button', { 'data-view': key, onclick: () => go(key) }, h('span', { class: 'tab-icon', 'aria-hidden': 'true' }, v.icon), h('span', {}, v.label)),
    ),
  );
}

// ---------------------------------------------------------------------------
// Vue "Match" : saisie d'un match
// ---------------------------------------------------------------------------

function formationLines(positions) {
  const lines = [[], [], [], [], []];
  let md = false;
  for (const pos of positions) {
    if (pos === 'G') lines[0].push(pos);
    else if (pos.startsWith('D')) lines[1].push(pos);
    else if (pos.startsWith('MD')) {
      md = true;
      lines[2].push(pos);
    } else if (pos.startsWith('M')) lines[md ? 3 : 2].push(pos);
    else if (pos.startsWith('A')) lines[md ? 4 : 3].push(pos);
  }
  return lines.filter((l) => l.length);
}

function shortName(name) {
  const parts = name.trim().split(/\s+/);
  const label = parts.length > 1 ? `${parts[0][0]}. ${parts.slice(1).join(' ')}` : name;
  return label.length > 12 ? `${label.slice(0, 11)}…` : label;
}

function cardList(p) {
  return [
    ...Array(Math.max(0, Number(p.yellow_cards) || 0)).fill('yellow'),
    ...Array(Math.max(0, Number(p.white_cards) || 0)).fill('white'),
    ...(p.red_card ? ['red'] : []),
  ];
}

function pitchPlayer(d, posId, x, y) {
  const p = d.players[posId] || {};
  const goals = (p.goals || []).length;
  const assists = p.name ? countAssists(d.players, p.name) : 0;
  const cards = cardList(p);
  const open = () => openPlayerSheet(posId);
  const g = s('g', {
    class: `pitch-player${p.name ? ' filled' : ''}`,
    transform: `translate(${x} ${y})`,
    tabindex: '0',
    role: 'button',
    'aria-label': `${posId} : ${p.name || 'vide'}`,
    onclick: open,
    onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && open(),
  });
  g.append(
    s('rect', { class: 'hit', x: -10, y: -7, width: 20, height: 22 }),
    s('circle', { class: 'dot', r: 5.5 }),
    s('text', { class: 'pos', y: 0.2, 'dominant-baseline': 'middle' }, posId),
    s('text', { class: 'name', y: 9.8 }, p.name ? shortName(p.name) : ''),
  );
  if (goals) g.append(s('text', { class: 'badge', x: 6, y: -4.5 }, goals > 1 ? `⚽${goals}` : '⚽'));
  if (assists) g.append(s('text', { class: 'badge', x: -6, y: -4.5, 'text-anchor': 'end' }, assists > 1 ? `🔗${assists}` : '🔗'));
  const w = 2.2;
  const gap = 0.9;
  const start = -(cards.length * (w + gap) - gap) / 2;
  cards.forEach((c, i) => g.append(s('rect', { class: `card card-${c}`, x: start + i * (w + gap), y: 11.6, width: w, height: 3, rx: 0.3 })));
  return g;
}

function renderPitch(d, positions) {
  const lines = formationLines(positions);
  const svg = s('svg', { class: 'pitch', viewBox: '0 0 100 130', role: 'group', 'aria-label': 'Terrain' });
  svg.append(
    s('rect', { class: 'pitch-line', x: 2, y: 2, width: 96, height: 126, rx: 1.5 }),
    s('line', { class: 'pitch-line', x1: 2, y1: 65, x2: 98, y2: 65 }),
    s('circle', { class: 'pitch-line', cx: 50, cy: 65, r: 9 }),
    s('rect', { class: 'pitch-line', x: 24, y: 2, width: 52, height: 16 }),
    s('rect', { class: 'pitch-line', x: 38, y: 2, width: 24, height: 6 }),
    s('rect', { class: 'pitch-line', x: 24, y: 112, width: 52, height: 16 }),
    s('rect', { class: 'pitch-line', x: 38, y: 122, width: 24, height: 6 }),
  );
  const n = lines.length;
  // Gardien en bas, attaque vers le haut
  lines.forEach((line, i) => {
    const y = n === 1 ? 65 : 115 - i * (100 / (n - 1));
    line.forEach((posId, j) => svg.append(pitchPlayer(d, posId, (100 * (j + 1)) / (line.length + 1), y)));
  });
  return svg;
}

function badgesText(d, posId) {
  const p = d.players[posId] || {};
  const parts = [];
  const goals = (p.goals || []).length;
  const assists = p.name && !isStar(posId) ? countAssists(d.players, p.name) : 0;
  if (goals) parts.push(`⚽${goals > 1 ? goals : ''}`);
  if (assists) parts.push(`🔗${assists > 1 ? assists : ''}`);
  for (const c of cardList(p)) parts.push({ yellow: '🟨', white: '⬜', red: '🟥' }[c]);
  return parts.join(' ');
}

function benchChip(d, posId, label, extraClass = '') {
  const p = d.players[posId] || {};
  return h(
    'button',
    { class: `chip-player ${extraClass}${p.name ? ' filled' : ''}`, onclick: () => openPlayerSheet(posId) },
    h('span', { class: 'chip-pos' }, label),
    h('span', { class: 'chip-name' }, p.name || 'Choisir…'),
    h('span', { class: 'chip-badges' }, badgesText(d, posId)),
  );
}

function sortedPlayersFor(posId) {
  const players = store.getPlayers();
  const all = players.map((p) => p.name);
  if (isSub(posId) || isStar(posId)) return all;
  // "MD1" -> milieux. (Dans la version Python, la comparaison minuscules/majuscules empechait ce tri.)
  const key = posId[0];
  const first = players.filter((p) => p.position === key).map((p) => p.name);
  return [...first, ...all.filter((n) => !first.includes(n))];
}

function assistSelect(value, onchange) {
  const names = store.getPlayers().map((p) => p.name);
  if (value && !names.includes(value)) names.unshift(value);
  return selectInput([['', 'Sans passeur'], ...names.map((n) => [n, n])], value, onchange);
}

function stepper(label, value, onchange) {
  const out = h('output', {}, value);
  const set = (v) => {
    value = Math.max(0, v);
    out.textContent = value;
    onchange(value);
  };
  return h(
    'div',
    { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h(
      'div',
      { class: 'stepper' },
      h('button', { class: 'icon-btn', 'aria-label': `${label} : retirer`, onclick: () => set(value - 1) }, '−'),
      out,
      h('button', { class: 'icon-btn', 'aria-label': `${label} : ajouter`, onclick: () => set(value + 1) }, '+'),
    ),
  );
}

function openPlayerSheet(posId) {
  const d = state.editor.data;
  const star = isStar(posId);
  const current = d.players[posId] || {};
  const draft = {
    name: current.name || '',
    yellow: Number(current.yellow_cards) || 0,
    white: Number(current.white_cards) || 0,
    red: Boolean(current.red_card),
    playtime: current.playtime ?? 90,
    goals: (current.goals || []).map((g) => g?.assist || ''),
  };
  let options = sortedPlayersFor(posId);
  if (draft.name && !options.includes(draft.name)) options = [draft.name, ...options];
  const usedAt = new Map();
  for (const [id, p] of Object.entries(d.players)) {
    if (id !== posId && !isStar(id) && p?.name) usedAt.set(p.name, id);
  }

  const title = star
    ? `${STAR_IDS.indexOf(posId) + 1}${posId === 'STAR1' ? 're' : 'e'} étoile`
    : isSub(posId)
      ? `Remplaçant ${SUB_IDS.indexOf(posId) + 1}`
      : `Poste ${posId}`;

  openSheet(title, (close) => {
    const search = h('input', { type: 'search', class: 'input', placeholder: 'Rechercher un joueur…', oninput: () => renderList() });
    const list = h('div', { class: 'pick-list', role: 'listbox', 'aria-label': 'Joueurs' });
    const renderList = () => {
      const q = normalize(search.value);
      const items = options
        .filter((n) => !q || normalize(n).includes(q))
        .map((n) =>
          h(
            'button',
            {
              class: `pick${n === draft.name ? ' selected' : ''}`,
              role: 'option',
              'aria-selected': String(n === draft.name),
              onclick: () => {
                draft.name = n === draft.name ? '' : n;
                renderList();
              },
            },
            h('span', {}, n),
            !star && usedAt.has(n) ? h('span', { class: 'tag' }, `déjà en ${usedAt.get(n)}`) : null,
          ),
        );
      list.replaceChildren(...(items.length ? items : [h('p', { class: 'muted pad' }, 'Aucun joueur trouvé')]));
    };
    renderList();
    if (!options.length) {
      list.replaceChildren(h('p', { class: 'muted pad' }, 'Aucun joueur. Ajoute-les dans Réglages.'));
    }

    const body = [search, list];

    if (!star) {
      const playtime = h('input', {
        type: 'number',
        class: 'input',
        inputmode: 'numeric',
        min: 0,
        max: 150,
        value: draft.playtime,
        oninput: (e) => (draft.playtime = parseInt(e.target.value, 10) || 0),
      });
      const red = h('input', { type: 'checkbox', checked: draft.red, onchange: (e) => (draft.red = e.target.checked) });
      body.push(
        h(
          'div',
          { class: 'grid2' },
          stepper('Cartons jaunes', draft.yellow, (v) => (draft.yellow = v)),
          stepper('Cartons blancs', draft.white, (v) => (draft.white = v)),
          h('label', { class: 'field toggle' }, red, h('span', {}, 'Carton rouge')),
          field('Temps de jeu (min)', playtime),
        ),
      );

      const goalsBox = h('div', { class: 'goals' });
      const renderGoals = () => {
        goalsBox.replaceChildren(
          ...draft.goals.map((assist, i) =>
            h(
              'div',
              { class: 'goal-row' },
              h('span', { class: 'goal-num' }, `⚽ ${i + 1}`),
              assistSelect(assist, (v) => (draft.goals[i] = v)),
              h(
                'button',
                {
                  class: 'icon-btn',
                  'aria-label': `Supprimer le but ${i + 1}`,
                  onclick: () => {
                    draft.goals.splice(i, 1);
                    renderGoals();
                  },
                },
                '✕',
              ),
            ),
          ),
          h(
            'button',
            {
              class: 'btn small',
              onclick: () => {
                draft.goals.push('');
                renderGoals();
              },
            },
            '+ Ajouter un but',
          ),
        );
      };
      renderGoals();
      body.push(h('h3', { class: 'sub-title' }, 'Buts marqués (choisir le passeur)'), goalsBox);
    }

    const save = () => {
      if (!draft.name && !draft.goals.length) {
        delete d.players[posId];
      } else if (star) {
        d.players[posId] = { name: draft.name };
      } else {
        d.players[posId] = {
          name: draft.name,
          yellow_cards: draft.yellow,
          white_cards: draft.white,
          red_card: draft.red,
          playtime: draft.playtime,
          goals: draft.goals.map((assist) => ({ assist })),
        };
      }
      touchEditor();
      rerenderKeepScroll();
      close();
    };

    const clear = () => {
      delete d.players[posId];
      touchEditor();
      rerenderKeepScroll();
      close();
    };

    return {
      body,
      actions: [
        current.name || current.goals?.length ? h('button', { class: 'btn ghost', onclick: clear }, 'Vider') : null,
        h('button', { class: 'btn primary', onclick: save }, 'Valider'),
      ].filter(Boolean),
    };
  });
}

function startNewMatch() {
  if (state.editor.dirty && !confirm('Le match en cours n’est pas enregistré. Commencer un nouveau match quand même ?')) return;
  state.editor = newEditor();
  store.setDraft(state.editor);
  go('match');
}

function openInEditor(record) {
  if (state.editor.dirty && state.editor.id !== record.id && !confirm('Le match en cours n’est pas enregistré. L’abandonner ?')) return;
  state.editor = {
    id: record.id,
    name: record.name,
    team: record.team || '',
    competition: record.competition || 'autre',
    data: { ...emptyMatch(), ...structuredClone(record.data) },
    dirty: false,
  };
  store.setDraft(state.editor);
  go('match');
}

function saveEditor() {
  const ed = state.editor;
  const name = safeFileName(ed.name) || defaultMatchName(ed.data) || `match-${new Date().toISOString().slice(0, 10)}`;
  const matches = store.getMatches();
  const conflict = matches.find((m) => m.id !== ed.id && m.name === name && (m.team || '') === ed.team && m.competition === ed.competition);
  if (conflict && !confirm(`Un match « ${name} » existe déjà pour cette équipe et cette compétition. Le remplacer ?`)) return;

  const record = { id: conflict?.id || ed.id || store.uid(), name, team: ed.team.trim(), competition: ed.competition, data: ed.data };
  const ok = persistOrWarn(() => {
    if (conflict && ed.id) store.deleteMatch(ed.id);
    store.saveMatch(record);
  });
  if (!ok) return;

  Object.assign(ed, { id: record.id, name, dirty: false });
  store.setDraft(ed);
  store.requestPersistence();
  render();

  const warnings = verifyMatch(ed.data);
  if (!warnings.length) {
    toast('Match enregistré ✅');
    return;
  }
  openSheet('Match enregistré', (close) => ({
    body: [
      h('p', {}, 'Le match est enregistré, mais certains points sont à vérifier :'),
      h('ul', { class: 'warnings' }, warnings.map((w) => h('li', {}, w))),
    ],
    actions: [h('button', { class: 'btn primary', onclick: close }, 'OK')],
  }));
}

function exportEditor() {
  const ed = state.editor;
  const name = safeFileName(ed.name) || defaultMatchName(ed.data) || 'match';
  openSheet('Exporter le match', () => ({
    body: [
      h('p', {}, `Fichier « ${name}.json », lisible par l’application Python sur PC.`),
      h('div', { class: 'row' }, exportButtons(`${name}.json`, () => new Blob([JSON.stringify(ed.data, null, 2)], { type: 'application/json' }))),
    ],
  }));
}

function renderMatchView() {
  const ed = state.editor;
  const d = ed.data;
  const formations = store.getFormations();
  const bind = (key) => (e) => {
    d[key] = e.target.value;
    touchEditor();
  };

  const resultSelect = selectInput(
    [
      ['', '—'],
      ['Gagne', 'Gagné'],
      ['Nul', 'Nul'],
      ['Perdu', 'Perdu'],
    ],
    d.result,
    (v) => {
      d.result = v;
      touchEditor();
    },
  );
  const autoResult = () => {
    const r = resultFromScore(d.score, d.location);
    if (r) {
      d.result = r;
      resultSelect.value = r;
    }
  };

  const teams = store.teamsInUse();
  const nameInput = h('input', {
    class: 'input',
    value: ed.name,
    placeholder: defaultMatchName(d) || 'ex : 2026-10-25 Saint-Jean',
    oninput: (e) => {
      ed.name = e.target.value;
      touchEditor();
    },
  });
  const refreshNamePlaceholder = () => (nameInput.placeholder = defaultMatchName(d) || 'ex : 2026-10-25 Saint-Jean');

  const infos = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title' }, 'Infos du match'),
    h(
      'div',
      { class: 'grid2' },
      field('Date', h('input', { class: 'input', value: d.date, placeholder: 'jj/mm/aaaa', oninput: (e) => (bind('date')(e), refreshNamePlaceholder()) })),
      field('Adversaire', h('input', { class: 'input', value: d.opponent, oninput: (e) => (bind('opponent')(e), refreshNamePlaceholder()) })),
      field(
        'Lieu',
        selectInput(
          [
            ['', '—'],
            ['Domicile', 'Domicile'],
            ['Exterieur', 'Extérieur'],
          ],
          d.location,
          (v) => {
            d.location = v;
            autoResult();
            touchEditor();
          },
        ),
      ),
      field(
        'Composition',
        selectInput([['', '—'], ...Object.keys(formations).map((f) => [f, f])], d.formation, (v) => {
          d.formation = v;
          touchEditor();
          rerenderKeepScroll();
        }),
      ),
      field(
        'Score final',
        h('input', {
          class: 'input',
          value: d.score,
          placeholder: 'ex : 3-1',
          inputmode: 'numeric',
          oninput: (e) => {
            d.score = e.target.value;
            autoResult();
            touchEditor();
          },
        }),
      ),
      field('Résultat', resultSelect),
      field(
        'Équipe',
        h('input', {
          class: 'input',
          value: ed.team,
          list: 'team-list',
          placeholder: 'ex : Seniors A',
          oninput: (e) => {
            ed.team = e.target.value;
            touchEditor();
          },
        }),
      ),
      field(
        'Compétition',
        selectInput(competitionOptions(), ed.competition, (v) => {
          ed.competition = v;
          touchEditor();
        }),
      ),
    ),
    h('datalist', { id: 'team-list' }, teams.map((t) => h('option', { value: t }))),
    field('Commentaires', h('textarea', { class: 'input', rows: 3, value: d.comments, oninput: bind('comments') })),
    field('Nom du fichier', nameInput),
  );

  const positions = formations[d.formation];
  const pitchCard = h(
    'section',
    { class: 'card pitch-card' },
    h('h2', { class: 'card-title' }, 'Terrain', d.formation ? h('span', { class: 'muted' }, ` · ${d.formation}`) : null),
    positions ? renderPitch(d, positions) : h('p', { class: 'muted pad' }, 'Choisis une composition pour afficher le terrain.'),
    positions ? h('p', { class: 'hint' }, 'Touche un poste pour choisir le joueur, ses buts et ses cartons.') : null,
  );

  const bench = h(
    'section',
    { class: 'card' },
    h('h2', { class: 'card-title' }, 'Remplaçants'),
    h('div', { class: 'chips' }, SUB_IDS.map((id, i) => benchChip(d, id, `R${i + 1}`))),
    h('h2', { class: 'card-title' }, '⭐ Meilleurs joueurs'),
    h('div', { class: 'chips' }, STAR_IDS.map((id, i) => benchChip(d, id, `${i + 1}`, 'star'))),
  );

  const actions = h(
    'div',
    { class: 'action-bar' },
    h('button', { class: 'btn', onclick: exportEditor }, '⬇️ Exporter'),
    h('button', { class: 'btn primary grow', onclick: saveEditor }, ed.id ? '💾 Enregistrer les modifications' : '💾 Enregistrer le match'),
  );

  const head = h(
    'div',
    { class: 'view-head' },
    h(
      'div',
      {},
      h('h1', {}, ed.id ? ed.name : 'Nouveau match'),
      ed.dirty ? h('span', { class: 'pill warn' }, 'Non enregistré') : ed.id ? h('span', { class: 'pill ok' }, 'Enregistré') : null,
    ),
    h('button', { class: 'btn small', onclick: startNewMatch }, '+ Nouveau'),
  );

  const notice = store.getPlayers().length
    ? null
    : h(
        'div',
        { class: 'notice' },
        h('p', {}, 'Aucun joueur enregistré sur ce téléphone. Importe ton fichier config.json ou ajoute les joueurs à la main.'),
        h('button', { class: 'btn small', onclick: () => go('settings') }, 'Aller aux réglages'),
      );

  return h('div', { class: 'stack' }, head, notice, infos, pitchCard, bench, actions);
}

// ---------------------------------------------------------------------------
// Details d'un match (lecture seule)
// ---------------------------------------------------------------------------

function renderMatchDetails(record) {
  const d = record.data;
  const summary = matchSummary(d);
  const info = [
    ['Date', d.date],
    ['Adversaire', d.opponent],
    ['Lieu', d.location === 'Exterieur' ? 'Extérieur' : d.location],
    ['Composition', d.formation],
    ['Score', d.score],
    ['Résultat', { Gagne: 'Gagné' }[d.result] || d.result],
    ['Équipe', record.team],
    ['Compétition', COMPETITIONS[record.competition]],
  ];
  const playerRows = summary.lineup.map(([posId, p]) => {
    const cards = cardList(p)
      .map((c) => ({ yellow: '🟨', white: '⬜', red: '🟥' })[c])
      .join('');
    const goals = (p.goals || []).length;
    return h(
      'tr',
      {},
      h('td', { class: 'muted' }, posId),
      h('td', {}, p.name || 'N/A'),
      h('td', { class: 'num' }, `${p.playtime ?? 90}′`),
      h('td', {}, `${goals ? '⚽'.repeat(goals) : ''}${cards}`),
    );
  });

  return h(
    'div',
    { class: 'stack' },
    h('dl', { class: 'kv' }, info.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v || '—')])),
    d.comments ? h('blockquote', { class: 'comment' }, d.comments) : null,
    h('h3', { class: 'sub-title' }, 'Buts'),
    summary.goals.length
      ? h(
          'ul',
          { class: 'plain' },
          summary.goals.map((g) => h('li', {}, g.assist ? `⚽ ${g.scorer} — passe de ${g.assist}` : `⚽ ${g.scorer} (sans passeur)`)),
        )
      : h('p', { class: 'muted' }, 'Aucun but enregistré'),
    h('h3', { class: 'sub-title' }, 'Étoiles'),
    summary.stars.length
      ? h(
          'ul',
          { class: 'plain' },
          summary.stars.map((st) => h('li', {}, `⭐ ${st.rank}${st.rank === 1 ? 're' : 'e'} : ${st.name}`)),
        )
      : h('p', { class: 'muted' }, 'Aucune étoile'),
    h('h3', { class: 'sub-title' }, 'Joueurs'),
    h('table', { class: 'table' }, h('tbody', {}, playerRows)),
  );
}

function openMatchDetails(record) {
  openSheet(record.name, (close) => ({
    body: renderMatchDetails(record),
    actions: [
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            await close();
            openInEditor(record);
          },
        },
        '✏️ Modifier',
      ),
    ],
  }));
}

// ---------------------------------------------------------------------------
// Vue "Matchs" : liste, import / export, verification
// ---------------------------------------------------------------------------

function resultPill(result) {
  const map = { Gagne: ['ok', 'V'], Nul: ['neutral', 'N'], Perdu: ['bad', 'D'] };
  const [cls, label] = map[result] || ['neutral', '?'];
  return h('span', { class: `result ${cls}`, title: result || 'Résultat non renseigné' }, label);
}

function openMatchActions(record) {
  openSheet(record.name, (close) => ({
    body: [
      h('p', { class: 'muted' }, [record.team || 'Sans équipe', COMPETITIONS[record.competition]].join(' · ')),
      h(
        'div',
        { class: 'menu' },
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              await close();
              openMatchDetails(record);
            },
          },
          '📄 Voir le détail',
        ),
        h(
          'button',
          {
            class: 'btn',
            onclick: async () => {
              await close();
              openInEditor(record);
            },
          },
          '✏️ Modifier',
        ),
        ...exportButtons(`${record.name}.json`, () => new Blob([JSON.stringify(record.data, null, 2)], { type: 'application/json' })),
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              if (!confirm(`Supprimer définitivement « ${record.name} » de ce téléphone ?`)) return;
              store.deleteMatch(record.id);
              if (state.editor.id === record.id) {
                state.editor.id = null;
                state.editor.dirty = true;
                store.setDraft(state.editor);
              }
              await close();
              render();
              toast('Match supprimé');
            },
          },
          '🗑️ Supprimer',
        ),
      ),
    ],
  }));
}

const competitionFromFolder = (folder) =>
  /champ/i.test(folder) ? 'championnat' : /coup/i.test(folder) ? 'coupe' : /^(autre|amica)/i.test(folder) ? 'autre' : '';

// Retrouve equipe et competition depuis l'arborescence A/<equipe>/<Championnat|Coupe>/match.json
function locateFromPath(path) {
  const folders = path.split('/').filter(Boolean).slice(0, -1);
  for (let i = folders.length - 1; i >= 0; i--) {
    const competition = competitionFromFolder(folders[i]);
    if (competition) return { team: i > 0 ? folders[i - 1] : '', competition };
  }
  return { team: folders.length >= 2 ? folders[folders.length - 1] : '', competition: '' };
}

async function importFiles(fileList, defaults) {
  const sources = [];
  const errors = [];
  for (const file of fileList) {
    const path = file.webkitRelativePath || file.name;
    try {
      if (/\.zip$/i.test(file.name)) {
        for (const entry of await readZip(file)) if (/\.json$/i.test(entry.path)) sources.push(entry);
      } else if (/\.json$/i.test(file.name)) {
        sources.push({ path, content: await file.text() });
      }
    } catch (e) {
      errors.push(`${file.name} : ${e.message}`);
    }
  }

  const matches = store.getMatches();
  let added = 0;
  let replaced = 0;
  for (const { path, content } of sources) {
    const fileName = path.split('/').pop();
    if (/^config/i.test(fileName)) continue;
    let data;
    try {
      data = JSON.parse(content.replace(/^﻿/, ''));
    } catch (e) {
      errors.push(`${path} : JSON invalide`);
      continue;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !('players' in data || 'date' in data)) {
      errors.push(`${path} : ce n’est pas un fichier de match`);
      continue;
    }
    const located = defaults.useFolders ? locateFromPath(path) : { team: '', competition: '' };
    const record = {
      name: fileName.replace(/\.json$/i, ''),
      team: located.team || defaults.team,
      competition: located.competition || defaults.competition,
      data,
    };
    const existing = matches.find((m) => m.name === record.name && (m.team || '') === record.team && m.competition === record.competition);
    if (existing) {
      Object.assign(existing, record, { updatedAt: new Date().toISOString() });
      replaced++;
    } else {
      matches.push({ id: store.uid(), ...record, updatedAt: new Date().toISOString() });
      added++;
    }
  }

  if (added + replaced) {
    if (!persistOrWarn(() => store.saveMatches(matches))) return null;
    store.requestPersistence();
  }
  return { added, replaced, errors };
}

function openImportSheet() {
  openSheet('Importer des matchs', (close) => {
    const defaults = { team: store.teamsInUse()[0] || '', competition: 'championnat', useFolders: true };
    const status = h('div', { 'aria-live': 'polite' });

    const run = async (files) => {
      if (!files?.length) return;
      status.replaceChildren(h('p', { class: 'muted' }, 'Import en cours…'));
      const result = await importFiles(files, defaults);
      if (!result) return;
      const { added, replaced, errors } = result;
      status.replaceChildren(
        h('p', {}, `Ajoutés : ${added} · Remplacés (déjà présents) : ${replaced}`),
        errors.length ? h('ul', { class: 'warnings' }, errors.map((e) => h('li', {}, e))) : null,
      );
      render();
      if (!errors.length) {
        await close();
        toast(`${added + replaced} match(s) importé(s)`);
      }
    };

    const fileInput = h('input', { type: 'file', accept: '.json,.zip,application/json,application/zip', multiple: true, hidden: true, onchange: (e) => run(e.target.files) });
    const dirInput = h('input', { type: 'file', webkitdirectory: true, multiple: true, hidden: true, onchange: (e) => run(e.target.files) });

    return {
      body: [
        h(
          'p',
          {},
          'Fichiers .json de l’application PC, ou un .zip du dossier des matchs. Les dossiers « Équipe / Championnat | Coupe » sont reconnus automatiquement.',
        ),
        h(
          'label',
          { class: 'field toggle' },
          h('input', { type: 'checkbox', checked: true, onchange: (e) => (defaults.useFolders = e.target.checked) }),
          h('span', {}, 'Déduire équipe et compétition des dossiers'),
        ),
        h('p', { class: 'muted' }, 'Sinon, ou si les dossiers ne l’indiquent pas :'),
        h(
          'div',
          { class: 'grid2' },
          field('Équipe', h('input', { class: 'input', value: defaults.team, list: 'import-teams', oninput: (e) => (defaults.team = e.target.value.trim()) })),
          field(
            'Compétition',
            selectInput(competitionOptions(), defaults.competition, (v) => (defaults.competition = v)),
          ),
        ),
        h('datalist', { id: 'import-teams' }, store.teamsInUse().map((t) => h('option', { value: t }))),
        fileInput,
        dirInput,
        status,
      ],
      actions: [
        h('button', { class: 'btn', onclick: () => dirInput.click() }, '📂 Un dossier'),
        h('button', { class: 'btn primary', onclick: () => fileInput.click() }, '📄 Fichiers / ZIP'),
      ],
    };
  });
}

function buildArchive(records) {
  const used = new Set();
  const files = sortedRecords(records).map((r) => {
    const folder = `A/${safeFileName(r.team || 'Sans équipe')}/${COMPETITIONS[r.competition] || 'Autre'}`;
    let path = `${folder}/${safeFileName(r.name) || 'match'}.json`;
    for (let i = 2; used.has(path); i++) path = `${folder}/${safeFileName(r.name)} (${i}).json`;
    used.add(path);
    return { path, content: JSON.stringify(r.data, null, 2) };
  });
  return createZip(files);
}

function openExportAllSheet() {
  const records = store.getMatches();
  const filename = `matchs-${new Date().toISOString().slice(0, 10)}.zip`;
  openSheet('Exporter tous les matchs', () => ({
    body: [
      h(
        'p',
        {},
        `${plural(records.length, 'match')} dans un fichier ZIP, rangés en A/Équipe/Championnat|Coupe/. `,
        'Décompressé dans le dossier du programme Python, il fonctionne aussi sur PC (rapport club compris).',
      ),
      h('p', { class: 'muted' }, 'C’est aussi ta sauvegarde : les matchs ne sont stockés que sur ce téléphone.'),
      h('div', { class: 'row' }, exportButtons(filename, () => buildArchive(records))),
    ],
  }));
}

function openVerifySheet() {
  const { total, results } = verifyAll(sortedRecords(store.getMatches()));
  openSheet('Vérification des matchs', (close) => ({
    body: [
      h('p', {}, `${plural(total, 'match')} vérifié${total > 1 ? 's' : ''} · ${plural(results.length, 'match')} avec des remarques`),
      results.length
        ? results.map(({ record, warnings }) =>
            h(
              'div',
              { class: 'verify-item' },
              h(
                'button',
                {
                  class: 'link',
                  onclick: async () => {
                    await close();
                    openInEditor(record);
                  },
                },
                `${record.team ? `${record.team} / ` : ''}${record.name}`,
                record.data.date ? h('span', { class: 'muted' }, ` · ${record.data.date}`) : null,
              ),
              h('ul', { class: 'warnings' }, warnings.map((w) => h('li', {}, w))),
            ),
          )
        : h('p', { class: 'ok-text' }, '✅ Aucun problème détecté. Tous les matchs sont cohérents.'),
    ],
  }));
}

function renderMatchesView() {
  const all = store.getMatches();
  const f = state.listFilter;
  const q = normalize(f.q);
  const records = sortedRecords(all).filter(
    (r) =>
      (!f.team || r.team === f.team) &&
      (!f.competition || r.competition === f.competition) &&
      (!q || normalize(`${r.name} ${r.data.opponent || ''} ${r.data.date || ''}`).includes(q)),
  );

  const list = records.length
    ? h(
        'ul',
        { class: 'match-list' },
        records.map((r) =>
          h(
            'li',
            {},
            h(
              'button',
              { class: 'match-item', onclick: () => openMatchActions(r) },
              resultPill(r.data.result),
              h(
                'span',
                { class: 'match-main' },
                h('span', { class: 'match-name' }, r.name),
                h('span', { class: 'muted' }, [r.team || 'Sans équipe', COMPETITIONS[r.competition], r.data.opponent && `vs ${r.data.opponent}`].filter(Boolean).join(' · ')),
              ),
              h('span', { class: 'match-score' }, r.data.score || ''),
            ),
          ),
        ),
      )
    : h('p', { class: 'muted pad' }, all.length ? 'Aucun match ne correspond aux filtres.' : 'Aucun match pour l’instant. Saisis un match ou importe ceux du PC.');

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Matchs'), h('span', { class: 'muted' }, plural(all.length, 'match'))),
    h(
      'div',
      { class: 'row wrap' },
      h('button', { class: 'btn', onclick: openImportSheet }, '📥 Importer'),
      h('button', { class: 'btn', onclick: openExportAllSheet, disabled: !all.length }, '📦 Tout exporter'),
      h('button', { class: 'btn', onclick: openVerifySheet, disabled: !all.length }, '🔍 Vérifier'),
    ),
    h(
      'div',
      { class: 'filters' },
      h('input', {
        type: 'search',
        class: 'input',
        placeholder: 'Rechercher (nom, adversaire, date)…',
        value: f.q,
        oninput: (e) => {
          f.q = e.target.value;
          const pos = e.target.selectionStart;
          rerenderKeepScroll();
          const input = document.querySelector('.filters input[type=search]');
          input.focus();
          input.setSelectionRange(pos, pos);
        },
      }),
      h(
        'div',
        { class: 'grid2' },
        selectInput(teamOptions(true), f.team, (v) => {
          f.team = v;
          rerenderKeepScroll();
        }),
        selectInput(competitionOptions(true), f.competition, (v) => {
          f.competition = v;
          rerenderKeepScroll();
        }),
      ),
    ),
    list,
  );
}

// ---------------------------------------------------------------------------
// Vue "Stats" : statistiques cumulees sur une selection de matchs
// ---------------------------------------------------------------------------

function statsCandidates() {
  const { team, competition } = state.statsFilter;
  return sortedRecords(store.getMatches()).filter((r) => (!team || r.team === team) && (!competition || r.competition === competition));
}

function statsRecords() {
  return statsCandidates().filter((r) => !state.statsExcluded.has(r.id));
}

function openSelectionSheet() {
  const candidates = statsCandidates();
  const excluded = new Set(state.statsExcluded);
  openSheet('Matchs inclus', (close) => {
    const boxes = candidates.map((r) =>
      h(
        'label',
        { class: 'check-row' },
        h('input', {
          type: 'checkbox',
          checked: !excluded.has(r.id),
          onchange: (e) => (e.target.checked ? excluded.delete(r.id) : excluded.add(r.id)),
        }),
        h('span', {}, r.name, h('span', { class: 'muted' }, ` · ${r.team || 'Sans équipe'}`)),
      ),
    );
    const setAll = (checked) => {
      boxes.forEach((label, i) => {
        label.querySelector('input').checked = checked;
        if (checked) excluded.delete(candidates[i].id);
        else excluded.add(candidates[i].id);
      });
    };
    return {
      body: [
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => setAll(true) }, 'Tout cocher'), h('button', { class: 'btn small', onclick: () => setAll(false) }, 'Tout décocher')),
        boxes.length ? h('div', { class: 'check-list' }, boxes) : h('p', { class: 'muted' }, 'Aucun match pour ces filtres.'),
      ],
      actions: [
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              state.statsExcluded = excluded;
              await close();
              rerenderKeepScroll();
            },
          },
          'Valider',
        ),
      ],
    };
  });
}

function renderSections(sections) {
  return sections.map((sec) =>
    h(
      'section',
      { class: 'report-section' },
      h('h3', {}, sec.title),
      sec.rows.length
        ? h(
            sec.ranked ? 'ol' : 'ul',
            { class: 'ranking' },
            sec.rows.map((row) =>
              row.text
                ? h('li', {}, row.text)
                : h(
                    'li',
                    {},
                    h('span', { class: 'rank-label' }, row.label),
                    row.value ? h('span', { class: 'rank-value' }, row.value) : null,
                    row.items ? h('ul', { class: 'sub-list' }, row.items.map((i) => h('li', {}, i))) : null,
                  ),
            ),
          )
        : h('p', { class: 'muted' }, sec.empty || 'Aucune donnée'),
    ),
  );
}

function renderPlayerStats(records, name) {
  const st = playerStats(records, name);
  const counterList = (counter, fmt) =>
    counter.size ? h('ul', { class: 'ranking' }, counter.mostCommon().map(([who, n]) => h('li', {}, h('span', { class: 'rank-label' }, who), h('span', { class: 'rank-value' }, fmt(n))))) : null;
  const matchLinks = (items, unit) =>
    items.length
      ? h(
          'ul',
          { class: 'plain' },
          items.map(({ record, count }) =>
            h('li', {}, h('button', { class: 'link', onclick: () => openMatchDetails(record) }, record.name), h('span', { class: 'muted' }, ` · ${plural(count, unit)}`)),
          ),
        )
      : h('p', { class: 'muted' }, 'Aucun');
  const totalAssists = [...st.assistsTo.values()].reduce((a, b) => a + b, 0);

  return h(
    'div',
    { class: 'stack' },
    h(
      'div',
      { class: 'tiles' },
      [
        ['Buts', st.totalGoals],
        ['Passes D.', totalAssists],
        ['Titulaire', st.starter],
        ['Remplaçant', st.sub],
        ['Pts étoiles', st.starPoints],
        ['Cartons', `${st.yellow}🟨 ${st.white}⬜ ${st.red}🟥`],
      ].map(([label, value]) => h('div', { class: 'tile' }, h('span', { class: 'tile-value' }, value), h('span', { class: 'tile-label' }, label))),
    ),
    st.starPoints ? h('p', { class: 'muted' }, `Étoiles : ${[1, 2, 3].map((r) => `${st.starRanks.get(r) || 0}× ${r}${r === 1 ? 're' : 'e'}`).join(', ')} (1re = 3 pts, 2e = 2, 3e = 1)`) : null,
    h('section', { class: 'report-section' }, h('h3', {}, 'Buts selon le passeur'), counterList(st.goalsByAssist, (n) => plural(n, 'but')) || h('p', { class: 'muted' }, 'Aucun but avec passeur')),
    h('section', { class: 'report-section' }, h('h3', {}, 'Passes décisives données à'), counterList(st.assistsTo, (n) => plural(n, 'passe')) || h('p', { class: 'muted' }, 'Aucune passe décisive')),
    h('section', { class: 'report-section' }, h('h3', {}, `⚽ Matchs avec buts (${st.matchesWithGoals.length})`), matchLinks(st.matchesWithGoals, 'but')),
    h('section', { class: 'report-section' }, h('h3', {}, `🔗 Matchs avec passes décisives (${st.matchesWithAssists.length})`), matchLinks(st.matchesWithAssists, 'passe')),
  );
}

function renderStartersList(records) {
  return records.map((r) => {
    const starters = startersOf(r.data);
    return h(
      'section',
      { class: 'report-section' },
      h('h3', {}, h('button', { class: 'link', onclick: () => openMatchDetails(r) }, r.name)),
      starters.length ? h('p', {}, starters.join(' · ')) : h('p', { class: 'muted' }, 'Aucun titulaire détecté'),
    );
  });
}

function renderStatsView() {
  const all = store.getMatches();
  if (!all.length) {
    return h('div', { class: 'stack' }, h('div', { class: 'view-head' }, h('h1', {}, 'Statistiques')), h('p', { class: 'muted pad' }, 'Aucun match enregistré.'));
  }
  const f = state.statsFilter;
  const candidates = statsCandidates();
  const records = statsRecords();
  const tabs = [
    ['report', 'Rapport'],
    ['player', 'Joueur'],
    ['starters', 'Titulaires'],
  ];

  let content;
  if (!records.length) {
    content = h('p', { class: 'muted pad' }, 'Aucun match sélectionné.');
  } else if (state.statsTab === 'report') {
    const sections = fullReport(records);
    content = sections.length ? renderSections(sections) : h('p', { class: 'muted pad' }, 'Aucune donnée exploitable trouvée.');
  } else if (state.statsTab === 'player') {
    const names = playerNamesIn(records);
    if (!names.includes(state.statsPlayer)) state.statsPlayer = '';
    content = [
      field(
        'Joueur',
        selectInput([['', 'Choisir un joueur…'], ...names.map((n) => [n, n])], state.statsPlayer, (v) => {
          state.statsPlayer = v;
          rerenderKeepScroll();
        }),
      ),
      state.statsPlayer ? renderPlayerStats(records, state.statsPlayer) : null,
    ];
  } else {
    content = renderStartersList(records);
  }

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Statistiques')),
    h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'grid2' },
        selectInput(teamOptions(true), f.team, (v) => {
          f.team = v;
          rerenderKeepScroll();
        }),
        selectInput(competitionOptions(true), f.competition, (v) => {
          f.competition = v;
          rerenderKeepScroll();
        }),
      ),
      h(
        'div',
        { class: 'row between' },
        h('span', {}, `${records.length} / ${plural(candidates.length, 'match')} inclus`),
        h('button', { class: 'btn small', onclick: openSelectionSheet, disabled: !candidates.length }, 'Choisir les matchs'),
      ),
    ),
    h(
      'div',
      { class: 'segmented', role: 'tablist' },
      tabs.map(([key, label]) =>
        h(
          'button',
          {
            role: 'tab',
            'aria-selected': String(state.statsTab === key),
            onclick: () => {
              state.statsTab = key;
              rerenderKeepScroll();
            },
          },
          label,
        ),
      ),
    ),
    h('div', { class: 'stack' }, content),
  );
}

// ---------------------------------------------------------------------------
// Vue "Club" : rapport complet par equipe et competition
// ---------------------------------------------------------------------------

function renderClubView() {
  const records = store.getMatches();
  if (!records.length) {
    return h('div', { class: 'stack' }, h('div', { class: 'view-head' }, h('h1', {}, 'Rapport club')), h('p', { class: 'muted pad' }, 'Aucun match enregistré.'));
  }
  const report = clubReport(records);
  const countLabel = (mc) => `Championnat : ${plural(mc.championnat, 'match')} · Coupe : ${plural(mc.coupe, 'match')}`;

  const block = (title, part, open = false) =>
    h(
      'details',
      { class: 'card collapsible', open },
      h('summary', {}, h('span', { class: 'card-title' }, title), h('span', { class: 'muted small' }, countLabel(part.matchCount))),
      renderSections(part.sections),
    );

  const tables = report.tables.map((t) =>
    h(
      'section',
      { class: 'report-section' },
      h('h3', {}, t.title),
      t.rows.length
        ? h(
            'table',
            { class: 'table' },
            h('thead', {}, h('tr', {}, t.header.map((c, i) => h('th', { class: i ? 'num' : '' }, c)))),
            h('tbody', {}, t.rows.map((r) => h('tr', {}, r.map((c, i) => h('td', { class: i ? 'num' : '' }, c))))),
          )
        : h('p', { class: 'muted' }, 'Aucune donnée'),
    ),
  );

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Rapport club')),
    block('Toutes équipes', report.total, true),
    report.teams.map((t) => block(t.name, t)),
    h(
      'details',
      { class: 'card collapsible' },
      h('summary', {}, h('span', { class: 'card-title' }, 'Tableaux Championnat / Coupe'), h('span', { class: 'muted small' }, 'Export CSV possible')),
      h(
        'div',
        { class: 'row' },
        exportButtons(`rapport-club-${new Date().toISOString().slice(0, 10)}.csv`, () => new Blob(['﻿' + tablesToCsv(report.tables)], { type: 'text/csv' })),
      ),
      tables,
    ),
  );
}

// ---------------------------------------------------------------------------
// Vue "Reglages" : joueurs, configuration, sauvegarde
// ---------------------------------------------------------------------------

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  if (state.view === 'settings') rerenderKeepScroll();
});

function renderSettingsView() {
  const players = store.getPlayers();
  const formations = store.getFormations();

  const configInput = h('input', {
    type: 'file',
    accept: '.json,application/json',
    hidden: true,
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const count = store.applyConfig(JSON.parse((await file.text()).replace(/^﻿/, '')));
        toast(`${count} joueur(s) importé(s)`);
        store.requestPersistence();
        rerenderKeepScroll();
      } catch (err) {
        alert(`Erreur lors du chargement de la configuration :\n${err.message}`);
      }
    },
  });

  const newPlayer = { name: '', position: 'M' };
  const addPlayer = () => {
    const name = newPlayer.name.trim();
    if (!name) return;
    if (players.some((p) => p.name === name)) {
      alert(`${name} est déjà dans la liste.`);
      return;
    }
    if (persistOrWarn(() => store.setPlayers([...players, { name, position: newPlayer.position }]))) rerenderKeepScroll();
  };

  const groups = Object.entries({ ...store.POSITIONS, '': 'Autres' }).map(([pos, label]) => {
    const inGroup = players.filter((p) => (pos ? p.position === pos : !store.POSITIONS[p.position]));
    if (!inGroup.length) return null;
    return h(
      'div',
      { class: 'player-group' },
      h('h3', { class: 'sub-title' }, `${label} (${inGroup.length})`),
      h(
        'ul',
        { class: 'player-list' },
        inGroup.map((p) =>
          h(
            'li',
            {},
            h('span', {}, p.name),
            selectInput(
              Object.entries(store.POSITIONS).map(([k]) => [k, k]),
              p.position,
              (v) => {
                store.setPlayers(players.map((x) => (x === p ? { ...x, position: v } : x)));
                rerenderKeepScroll();
              },
            ),
            h(
              'button',
              {
                class: 'icon-btn',
                'aria-label': `Retirer ${p.name}`,
                onclick: () => {
                  if (!confirm(`Retirer ${p.name} de la liste ? (Les matchs déjà saisis ne changent pas.)`)) return;
                  store.setPlayers(players.filter((x) => x !== p));
                  rerenderKeepScroll();
                },
              },
              '✕',
            ),
          ),
        ),
      ),
    );
  });

  return h(
    'div',
    { class: 'stack' },
    h('div', { class: 'view-head' }, h('h1', {}, 'Réglages')),
    installPrompt
      ? h(
          'div',
          { class: 'notice' },
          h('p', {}, 'Installe l’application sur l’écran d’accueil pour l’ouvrir en plein écran, même hors connexion.'),
          h(
            'button',
            {
              class: 'btn primary small',
              onclick: async () => {
                installPrompt.prompt();
                await installPrompt.userChoice;
                installPrompt = null;
                rerenderKeepScroll();
              },
            },
            'Installer',
          ),
        )
      : null,
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title' }, 'Configuration (config.json)'),
      h('p', { class: 'muted' }, `${plural(players.length, 'joueur')} · ${plural(Object.keys(formations).length, 'composition')}. Ces données restent sur ce téléphone.`),
      configInput,
      h(
        'div',
        { class: 'row wrap' },
        h('button', { class: 'btn', onclick: () => configInput.click() }, '📥 Importer config.json'),
        exportButtons('config.json', () => new Blob([JSON.stringify(store.exportConfig(), null, 2)], { type: 'application/json' })),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title' }, 'Joueurs'),
      h(
        'div',
        { class: 'add-player' },
        h('input', {
          class: 'input',
          placeholder: 'Prénom Nom',
          oninput: (e) => (newPlayer.name = e.target.value),
          onkeydown: (e) => e.key === 'Enter' && addPlayer(),
        }),
        selectInput(
          Object.entries(store.POSITIONS).map(([k, label]) => [k, label]),
          newPlayer.position,
          (v) => (newPlayer.position = v),
        ),
        h('button', { class: 'btn primary', onclick: addPlayer }, 'Ajouter'),
      ),
      groups,
      players.length ? null : h('p', { class: 'muted' }, 'Aucun joueur.'),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', { class: 'card-title' }, 'Sauvegarde'),
      h('p', { class: 'muted' }, 'Les matchs sont stockés uniquement sur ce téléphone. Exporte-les régulièrement (onglet Matchs → Tout exporter) : effacer les données de Chrome les supprimerait.'),
      h(
        'button',
        {
          class: 'btn danger',
          onclick: () => {
            if (!confirm('Effacer TOUS les matchs, joueurs et réglages de ce téléphone ?')) return;
            if (!confirm('Vraiment ? Cette action est définitive.')) return;
            store.clearAll();
            state.editor = newEditor();
            render();
            toast('Données effacées');
          },
        },
        '🗑️ Tout effacer',
      ),
    ),
    h('p', { class: 'muted small center' }, 'Match Logger · version mobile'),
  );
}

// ---------------------------------------------------------------------------
// Demarrage
// ---------------------------------------------------------------------------

buildTabbar();
render();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Exposes pour le debogage dans la console
window.matchLogger = { store, state, playerEntries };
