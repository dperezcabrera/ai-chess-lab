import { Chessground } from './vendor/chessground/chessground.min.js';

const app = document.getElementById('app');
const crumbs = document.getElementById('crumbs');
const tooltip = document.getElementById('tooltip');
const SVG = 'http://www.w3.org/2000/svg';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cache = new Map();
const JUDGEMENT = {
  best: { mark: '!', label: 'Best move' },
  inaccuracy: { mark: '?!', label: 'Inaccuracy' },
  mistake: { mark: '?', label: 'Mistake' },
  blunder: { mark: '??', label: 'Blunder' },
};
const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9 };
let cleanup = () => {};

const load = (url) => {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${url}: ${r.status}`)))));
  return cache.get(url);
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : String(child));
  return node;
}

function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) if (value !== undefined && value !== null) node.setAttribute(key, value);
  for (const child of children.flat()) if (child) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}

const DASH = '-';
const known = (values) => { const k = values.filter((v) => v !== null && v !== undefined); return k.length ? k.reduce((a, b) => a + b, 0) : null; };
const money = (v) => (v === null || v === undefined ? DASH : v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : v < 10 ? `$${v.toFixed(2)}` : `$${v.toFixed(1)}`);
const secs = (s) => {
  if (s === null || s === undefined) return DASH;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}m`;
};
const tokens = (n) => (n === null || n === undefined ? DASH : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n ?? ''));
const half = (p) => (p % 1 ? `${Math.floor(p) || ''}½` : String(p));
const winChances = (cp) => 2 / (1 + Math.exp(-0.00368208 * Math.max(-1000, Math.min(1000, cp)))) - 1;
const evalText = (e) => (!e ? '' : e.mate !== null && e.mate !== undefined ? (e.mate === 0 ? '#' : `#${e.mate}`) : `${e.cp > 0 ? '+' : ''}${(e.cp / 100).toFixed(1)}`);

function showTip(event, text) {
  tooltip.textContent = text;
  tooltip.hidden = false;
  const x = Math.min(event.clientX + 14, innerWidth - tooltip.offsetWidth - 8);
  const y = Math.min(event.clientY + 14, innerHeight - tooltip.offsetHeight - 8);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
}
const hideTip = () => (tooltip.hidden = true);
const tip = (node, text) => {
  node.addEventListener('pointermove', (e) => showTip(e, typeof text === 'function' ? text() : text));
  node.addEventListener('pointerleave', hideTip);
  return node;
};

function logo(player) {
  if (player?.logo) return el('img', { class: 'logo', src: player.logo, alt: '', width: 22, height: 22, loading: 'lazy' });
  return el('span', { class: 'logo-fallback', 'aria-hidden': 'true' }, (player?.name || '?').slice(0, 1).toUpperCase());
}
const playerTag = (player) => el('span', { class: 'player' }, logo(player), el('span', { class: 'player-name', title: player?.upstream || player?.name }, player?.name || 'bye'));

const ICONS = {
  first: 'M6 5h2v14H6zM18 5v14l-9-7z',
  prev: 'M16 5v14l-10-7z',
  next: 'M8 5v14l10-7z',
  last: 'M16 5h2v14h-2zM6 5v14l9-7z',
  play: 'M8 5v14l11-7z',
  pause: 'M7 5h4v14H7zM13 5h4v14h-4z',
  flip: 'M7 4 3 8l4 4V9h10V7H7zM17 12v3H7v2h10v3l4-4z',
  download: 'M11 4h2v8l3-3 1.4 1.4L12 15.8l-5.4-5.4L8 9l3 3zM5 18h14v2H5z',
  engine: 'M12 2a3 3 0 0 1 3 3v1h2a2 2 0 0 1 2 2v2h-2v2h2v2h-2v2h2v2a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-2h2v-2H5v-2h2v-2H5V8a2 2 0 0 1 2-2h2V5a3 3 0 0 1 3-3zm-2 8v6h4v-6z',
};
const icon = (name) => {
  const node = svg('svg', { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }, svg('path', { d: ICONS[name] }));
  return node;
};
const iconButton = (name, label, onclick) => el('button', { class: 'icon-button', type: 'button', 'aria-label': label, title: label, onclick }, icon(name));

function setCrumbs(items) {
  crumbs.replaceChildren(...items.map(([text, href]) => el('li', {}, href ? el('a', { href }, text) : text)));
}

/* ---------- Charts ---------- */

function scatter(rows, { x, y, xLog, xLabel, yLabel, fmtX, fmtY, href }) {
  const W = 560, H = 340, L = 50, R = 20, T = 16, B = 40;
  const points = rows.filter((r) => x(r) !== null && x(r) !== undefined && y(r) !== null && y(r) !== undefined && (!xLog || x(r) > 0));
  const xs = points.map(x), ys = points.map(y);
  const tx = xLog ? Math.log10 : (v) => v;
  let [x0, x1] = [Math.min(...xs.map(tx)), Math.max(...xs.map(tx))];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const px = (x1 - x0) * 0.08 || 1, py = (y1 - y0) * 0.1 || 1;
  x0 -= px; x1 += px; y0 -= py; y1 += py;
  const sx = (v) => L + ((tx(v) - x0) / (x1 - x0)) * (W - L - R);
  const sy = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `${yLabel} against ${xLabel}` });
  const ticksX = xLog ? Array.from({ length: Math.floor(x1) - Math.ceil(x0) + 1 }, (_, i) => 10 ** (Math.ceil(x0) + i)) : niceTicks(x0, x1);
  for (const t of ticksX) {
    root.append(svg('line', { class: 'gridline', x1: sx(t), x2: sx(t), y1: T, y2: H - B }), svg('text', { x: sx(t), y: H - B + 16, 'text-anchor': 'middle' }, fmtX(t)));
  }
  for (const t of niceTicks(y0, y1)) {
    root.append(svg('line', { class: 'gridline', x1: L, x2: W - R, y1: sy(t), y2: sy(t) }), svg('text', { x: L - 6, y: sy(t) + 4, 'text-anchor': 'end' }, fmtY(t)));
  }
  root.append(svg('text', { x: (L + W - R) / 2, y: H - 6, 'text-anchor': 'middle' }, xLabel), svg('text', { x: 12, y: (T + H - B) / 2, 'text-anchor': 'middle', transform: `rotate(-90 12 ${(T + H - B) / 2})` }, yLabel));
  const placed = [];
  for (const r of points) {
    const cx = sx(x(r)), cy = sy(y(r));
    const box = [cx + 15, cy - 8, cx + 15 + r.name.length * 6.2, cy + 6];
    const free = box[2] < W && !placed.some((o) => box[0] < o[2] && o[0] < box[2] && box[1] < o[3] && o[1] < box[3]);
    if (free) placed.push(box);
    const g = svg('a', { href: href?.(r), 'aria-label': `${r.name}: ${fmtY(y(r))}, ${fmtX(x(r))}` });
    const clip = `c-${Math.random().toString(36).slice(2)}`;
    g.append(svg('defs', {}, svg('clipPath', { id: clip }, svg('circle', { cx, cy, r: 11 }))));
    g.append(svg('circle', { cx, cy, r: 12, fill: 'var(--surface)', stroke: 'var(--accent)', 'stroke-width': 1.5 }));
    if (r.logo) g.append(svg('image', { href: r.logo, x: cx - 11, y: cy - 11, width: 22, height: 22, 'clip-path': `url(#${clip})` }));
    else g.append(svg('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', class: 'label' }, r.name[0]));
    if (free) g.append(svg('text', { x: cx + 15, y: cy + 4, class: 'label' }, r.name));
    tip(g, `${r.name}\n${yLabel}: ${fmtY(y(r))}\n${xLabel}: ${fmtX(x(r))}`);
    root.append(g);
  }
  return root;
}

function niceTicks(a, b, count = 5) {
  const span = b - a;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || mag * 10;
  const ticks = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

function bars(rows, { value, fmt, label, colour, note }) {
  const shown = rows.filter((r) => value(r) !== null && value(r) !== undefined).sort((a, b) => value(b) - value(a));
  const W = 440, rowH = 22, L = 140, R = 60, H = shown.length * rowH + 8;
  const max = Math.max(...shown.map(value), 1e-9);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': label });
  shown.forEach((r, i) => {
    const y = 4 + i * rowH;
    const w = (value(r) / max) * (W - L - R);
    const g = svg('g', {});
    if (r.logo) g.append(svg('image', { href: r.logo, x: 2, y: y + 2, width: 16, height: 16 }));
    g.append(svg('text', { x: 22, y: y + 15, class: 'label' }, r.name.length > 20 ? `${r.name.slice(0, 19)}…` : r.name));
    g.append(svg('rect', { x: L, y: y + 3, width: Math.max(1, w), height: rowH - 8, rx: 3, fill: colour?.(r) || 'var(--accent)' }));
    g.append(svg('text', { x: L + w + 6, y: y + 15 }, fmt(value(r))));
    tip(g, `${r.name}: ${fmt(value(r))}${note ? `\n${note(r)}` : ''}`);
    root.append(g);
  });
  return root;
}

/* ---------- Tournament list ---------- */

async function renderList() {
  const list = await load('data/tournaments.json');
  if (list.length === 1) {
    location.replace(`#/t/${list[0].id}`);
    return;
  }
  setCrumbs([]);
  document.title = 'AI chess battle: tournaments';
  app.replaceChildren(
    el('h1', {}, 'Tournaments'),
    el('div', { class: 'tlist' }, list.map((t) => el('a', { class: 'card', href: `#/t/${t.id}` },
      el('h2', {}, t.title),
      el('p', { class: 'muted' }, `${new Date(t.started_at * 1000).toLocaleDateString()} · ${t.games} games · leader ${t.leader}`)))),
  );
}

/* ---------- Game cards ---------- */

function lazyBoards() {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const node = entry.target;
      observer.unobserve(node);
      Chessground(node.appendChild(el('div')), { fen: node.dataset.fen, orientation: node.dataset.orientation || 'white', lastMove: node.dataset.last ? node.dataset.last.split(',') : undefined, viewOnly: true, coordinates: false, animation: { enabled: false }, drawable: { enabled: false } });
    }
  }, { rootMargin: '200px' });
  return { observe: (node) => observer.observe(node), disconnect: () => observer.disconnect() };
}

const scoreFor = (g, colour) => (!g.result ? null : g.result === '1/2-1/2' ? 'd' : (g.result === '1-0') === (colour === 'white') ? 'w' : 'l');
const SCORE_TEXT = { w: '1', d: '½', l: '0' };

function gameCard(g, players, gameHref, observe, perspective) {
  const mine = perspective && (g.white === perspective ? 'white' : g.black === perspective ? 'black' : null);
  const bottom = mine || 'white';
  const top = bottom === 'white' ? 'black' : 'white';
  const side = (colour) => {
    const s = g.sides[colour];
    const score = scoreFor(g, colour);
    return el('div', { class: 'side' }, playerTag(players[g[colour]]), el('span', { class: 'muted num', title: 'accuracy' }, s.accuracy !== null ? `${Math.round(s.accuracy)}%` : ''), el('span', { class: 'score' }, score ? SCORE_TEXT[score] : ''));
  };
  const boardNode = el('div', { class: 'mini-board', 'data-fen': g.fen, 'data-orientation': bottom, 'data-last': g.last ? g.last.join(',') : '' });
  observe(boardNode);
  const blunders = mine ? g.sides[mine].blunders : g.sides.white.blunders + g.sides.black.blunders;
  const outcome = mine && scoreFor(g, mine);
  const cost = mine ? g.sides[mine].cost_usd : known([g.sides.white.cost_usd, g.sides.black.cost_usd]);
  return el('a', { class: `game-card${outcome ? ` outcome-${outcome}` : ''}`, href: gameHref(g.file), 'aria-label': `Round ${g.round}, board ${g.board}: ${players[g.white].name} against ${players[g.black].name}, ${g.result}` },
    mine && el('div', { class: 'meta' }, el('strong', {}, `Round ${g.round}`), el('span', {}, `${mine === 'white' ? 'White' : 'Black'}${outcome ? ` · ${{ w: 'won', d: 'drew', l: 'lost' }[outcome]}` : ''}`)),
    side(top), boardNode, side(bottom),
    el('div', { class: 'meta' }, el('span', {}, `${mine ? '' : `R${g.round} · B${g.board} · `}${g.termination}`), el('span', {}, `${Math.ceil(g.plies / 2)} moves`)),
    el('div', { class: 'meta' }, el('span', {}, blunders ? el('span', { class: 'j-blunder' }, `${blunders} blunder${blunders > 1 ? 's' : ''}`) : ''), el('span', {}, mine ? `${secs(g.sides[mine].seconds)} · ${money(cost)}` : money(cost))));
}

const playerHref = (id, pid) => `#/t/${id}/p/${encodeURIComponent(pid)}`;

/* ---------- Player ---------- */

function progression(t, pid, rounds) {
  const W = 1000, H = 220, L = 36, R = 20, T = 14, B = 30;
  const n = t.rounds.length;
  let total = 0;
  const points = [{ round: 0, total: 0 }];
  for (const round of t.rounds) {
    const g = round.games.find((x) => x.white === pid || x.black === pid);
    const s = g ? scoreFor(g, g.white === pid ? 'white' : 'black') : round.bye === pid ? 'w' : null;
    total += s === 'w' ? 1 : s === 'd' ? 0.5 : 0;
    points.push({ round: round.number, total, s, bye: !g && round.bye === pid, g });
  }
  const sx = (r) => L + (r / Math.max(1, n)) * (W - L - R);
  const sy = (v) => T + (1 - v / Math.max(1, n)) * (H - T - B);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Points after each round' });
  for (let v = 0; v <= n; v += Math.max(1, Math.ceil(n / 5))) root.append(svg('line', { class: 'gridline', x1: L, x2: W - R, y1: sy(v), y2: sy(v) }), svg('text', { x: L - 6, y: sy(v) + 4, 'text-anchor': 'end' }, v));
  root.append(svg('polyline', { points: points.map((p) => `${sx(p.round)},${sy(p.round)}`).join(' '), fill: 'none', stroke: 'var(--grid)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
  root.append(svg('polyline', { points: points.map((p) => `${sx(p.round)},${sy(p.total)}`).join(' '), fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.5 }));
  for (const p of points.slice(1)) {
    const colour = { w: 'var(--win)', d: 'var(--draw)', l: 'var(--loss)' }[p.s] || 'var(--border)';
    const dot = svg('a', { href: p.g ? rounds.href(p.g.file) : undefined }, svg('circle', { cx: sx(p.round), cy: sy(p.total), r: 7, fill: colour, stroke: 'var(--surface)', 'stroke-width': 2 }));
    tip(dot, `Round ${p.round}: ${p.bye ? 'bye' : p.g ? `${{ w: 'won', d: 'drew', l: 'lost' }[p.s] || 'playing'} against ${rounds.opponent(p.g)}` : 'did not play'}\n${half(p.total)} points`);
    root.append(dot, svg('text', { x: sx(p.round), y: H - 10, 'text-anchor': 'middle' }, `R${p.round}`));
  }
  return root;
}

async function renderPlayer(id, pid) {
  const t = await load(`data/${id}/tournament.json`);
  const players = Object.fromEntries(Object.entries(t.players).map(([key, p]) => [key, { id: key, ...p }]));
  const row = t.standings.find((r) => r.id === pid);
  if (!row) throw new Error(`no player ${pid} in this tournament`);
  const gameHref = (file) => `#/t/${id}/g/${file.replace('games/', '').replace('.json', '')}`;
  const opponent = (g) => players[g.white === pid ? g.black : g.white].name;
  document.title = `${row.name}: ${t.title}`;
  setCrumbs([[t.title, `#/t/${id}`], [row.name]]);
  const picker = el('label', { class: 'field' }, 'Player', el('select', { onchange: (e) => (location.hash = playerHref(id, e.target.value)) }, t.standings.map((r) => el('option', { value: r.id, selected: r.id === pid }, `${r.rank}. ${r.name}`))));
  const i = t.standings.indexOf(row);
  const step = (other, label, icon_) => other ? el('a', { class: 'btn', href: playerHref(id, other.id), 'aria-label': `${label}: ${other.name}` }, icon(icon_), other.name) : '';
  const info = players[pid];
  const stats = [
    [`${row.rank} of ${t.standings.length}`, 'place'],
    [half(row.points), `points from ${row.games} games`],
    [`${row.wins} / ${row.draws} / ${row.losses}`, 'won / drawn / lost'],
    row.accuracy !== null && [`${row.accuracy}%`, `accuracy, ${row.acpl} average centipawn loss`],
    row.accuracy !== null && [`${row.blunders} / ${row.mistakes} / ${row.inaccuracies}`, 'blunders / mistakes / inaccuracies'],
    [row.seconds_per_move !== null ? `${row.seconds_per_move}s` : '', 'thinking per move'],
    [money(row.cost_usd), `${tokens(known([row.input_tokens, row.output_tokens]))} tokens`],
  ].filter(Boolean);
  const boards = lazyBoards();
  const cards = [];
  for (const round of t.rounds) {
    const g = round.games.find((x) => x.white === pid || x.black === pid);
    if (g) cards.push(gameCard({ ...g, round: round.number }, players, gameHref, boards.observe, pid));
    else cards.push(el('div', { class: 'game-card empty-round' }, el('div', { class: 'meta' }, el('strong', {}, `Round ${round.number}`)), el('p', { class: 'muted' }, round.bye === pid ? 'Bye: one point without playing.' : 'Did not play this round.')));
  }
  app.replaceChildren(
    el('div', { class: 'game-head' },
      el('h1', {}, logo(info), `${row.name}`, info.upstream && info.upstream.toLowerCase() !== row.name.toLowerCase() ? el('span', { class: 'muted', style: 'font-size:0.9rem;font-weight:400' }, info.upstream) : ''),
      el('div', { class: 'filters', style: 'margin:0' }, step(t.standings[i - 1], 'Player above', 'prev'), picker, step(t.standings[i + 1], 'Player below', 'next'))),
    el('div', { class: 'hero' }, stats.map(([v, l]) => el('div', { class: 'stat' }, el('div', { class: 'stat-value' }, v), el('div', { class: 'stat-label' }, l)))),
    el('section', {}, el('div', { class: 'card' }, el('h3', {}, 'Points after each round'), progression(t, pid, { href: gameHref, opponent }))),
    el('section', {}, el('h2', {}, 'Games, round by round'), el('div', { class: 'games-grid' }, cards)));
  cleanup = boards.disconnect;
}

/* ---------- Series: highlights, teaser, ranks, rounds ---------- */

const gameLink = (id, file, ply) => `#/t/${id}/g/${file.replace('games/', '').replace('.json', '')}${ply !== undefined ? `/${ply}` : ''}`;
const roundHref = (id, n) => `#/t/${id}/r/${n}`;
const TRIANGLE = { up: 'M12 6l7 10H5z', down: 'M12 18L5 8h14z' };

function rankDelta(t, pid, round) {
  const ranks = t.ranks?.[pid];
  if (!ranks || round < 2) return '';
  const change = ranks[round - 2] - ranks[round - 1];
  if (!change) return el('span', { class: 'delta muted', title: 'same place as the round before' }, '=');
  const up = change > 0;
  return el('span', { class: `delta ${up ? 'up' : 'down'}`, title: `${up ? 'up' : 'down'} ${Math.abs(change)} since round ${round - 1}` },
    svg('svg', { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': 'true' }, svg('path', { d: TRIANGLE[up ? 'up' : 'down'] })), Math.abs(change));
}

function highlightCards(t, id, round, players, observe) {
  const h = round.highlights || {};
  const name = (pid) => players[pid]?.name || pid;
  const rankBefore = (pid) => t.ranks?.[pid]?.[round.number - 2];
  const items = [
    h.blunder && ['Blunder of the round', h.blunder.loss >= 1000 ? 'Game-losing' : `${(h.blunder.loss / 100).toFixed(1)} pawns`, `${name(h.blunder.player)} played ${h.blunder.san}${h.blunder.best ? `. Stockfish wanted ${h.blunder.best}` : ''}.`, h.blunder, 'blunder'],
    h.upset && ['Upset', `${h.upset.gap} place${h.upset.gap > 1 ? 's' : ''}`, `${name(h.upset.winner)}, ranked ${rankBefore(h.upset.winner)}, beat ${name(h.upset.loser)}, ranked ${rankBefore(h.upset.loser)}.`, h.upset, 'win'],
    h.best_game && ['Best-played game', `${Math.min(...h.best_game.accuracy)}%`, `${name(h.best_game.white)} ${h.best_game.accuracy[0]}% against ${name(h.best_game.black)} ${h.best_game.accuracy[1]}%, ${h.best_game.result}.`, h.best_game, 'best'],
    h.quickest_win && ['Quickest win', `${h.quickest_win.moves} moves`, `${name(h.quickest_win.result === '1-0' ? h.quickest_win.white : h.quickest_win.black)} beat ${name(h.quickest_win.result === '1-0' ? h.quickest_win.black : h.quickest_win.white)}.`, h.quickest_win, 'win'],
    h.longest_think && ['Longest thought', secs(h.longest_think.seconds), `${name(h.longest_think.player)} before playing ${h.longest_think.san}.`, h.longest_think, 'accent'],
    h.dearest_move && ['Most expensive move', money(h.dearest_move.cost_usd), `${name(h.dearest_move.player)} on ${h.dearest_move.san}, ${tokens(h.dearest_move.output_tokens)} tokens written.`, h.dearest_move, 'accent'],
  ].filter(Boolean);
  if (!items.length) return el('p', { class: 'muted' }, 'Nothing stood out in this round yet.');
  return el('div', { class: 'highlights' }, items.map(([label, figure, text, m, tone]) => {
    const board = el('div', { class: 'mini-board', 'data-fen': m.fen, 'data-last': m.last ? m.last.join(',') : '' });
    observe(board);
    return el('a', { class: `highlight tone-${tone}`, href: gameLink(id, m.file, m.ply) },
      el('div', { class: 'highlight-text' }, el('div', { class: 'highlight-label' }, label), el('div', { class: 'highlight-figure' }, figure), el('p', {}, text)), board);
  }));
}

function teaser(t, players) {
  if (!t.next) return '';
  return el('section', { id: 'next' }, el('h2', {}, `Coming next: round ${t.next.number}`),
    el('div', { class: 'teaser-grid' }, t.next.pairings.map((pair) => el('div', { class: 'teaser' },
      el('div', { class: 'teaser-side' }, logo(players[pair.white]), el('span', { class: 'player-name' }, players[pair.white].name), el('span', { class: 'muted' }, `${t.rounds.length ? 'No.' : 'Seed'} ${t.standings.find((r) => r.id === pair.white)?.rank}`)),
      el('div', { class: 'teaser-vs', 'aria-hidden': 'true' }, 'vs'),
      el('div', { class: 'teaser-side' }, logo(players[pair.black]), el('span', { class: 'player-name' }, players[pair.black].name), el('span', { class: 'muted' }, `${t.rounds.length ? 'No.' : 'Seed'} ${t.standings.find((r) => r.id === pair.black)?.rank}`))))),
    t.next.bye ? el('p', { class: 'muted' }, `Bye: ${players[t.next.bye].name}.`) : '');
}

function bumpChart(t, id) {
  const rounds = t.rounds.length;
  const count = t.standings.length;
  const W = 1000, H = 40 + count * 26, L = 40, R = 190, T = 20, B = 24;
  const sx = (r) => L + (rounds > 1 ? ((r - 1) / (rounds - 1)) * (W - L - R) : (W - L - R) / 2);
  const sy = (rank) => T + ((rank - 1) / Math.max(1, count - 1)) * (H - T - B);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart bump', role: 'img', 'aria-label': 'Place of every player after each round' });
  for (let r = 1; r <= rounds; r++) root.append(svg('line', { class: 'gridline', x1: sx(r), x2: sx(r), y1: T - 8, y2: H - B + 4 }), svg('text', { x: sx(r), y: H - 4, 'text-anchor': 'middle' }, `R${r}`));
  t.standings.forEach((row, index) => (row.hue = Math.round((index * 360) / count + 20) % 360));
  for (const row of [...t.standings].reverse()) {
    const ranks = t.ranks[row.id];
    const g = svg('a', { href: playerHref(id, row.id), class: 'bump-line', style: `color:hsl(${row.hue} 55% 52%)`, 'aria-label': `${row.name}: places ${ranks.join(', ')}` });
    g.append(svg('polyline', { points: ranks.map((rank, i) => `${sx(i + 1)},${sy(rank)}`).join(' '), fill: 'none', 'stroke-width': 3, 'stroke-linejoin': 'round' }));
    ranks.forEach((rank, i) => g.append(svg('circle', { cx: sx(i + 1), cy: sy(rank), r: 4.5 })));
    const y = sy(ranks[ranks.length - 1]);
    if (row.logo) g.append(svg('image', { href: row.logo, x: sx(rounds) + 12, y: y - 9, width: 18, height: 18 }));
    g.append(svg('text', { x: sx(rounds) + 36, y: y + 4, class: 'label' }, `${row.rank}. ${row.name}`));
    tip(g, `${row.name}\nplaces by round: ${ranks.join(', ')}`);
    root.append(g);
  }
  return root;
}

async function renderRound(id, number) {
  const t = await load(`data/${id}/tournament.json`);
  const players = Object.fromEntries(Object.entries(t.players).map(([key, p]) => [key, { id: key, ...p }]));
  const round = t.rounds.find((r) => r.number === number);
  if (!round) throw new Error(`round ${number} has not been released`);
  document.title = `Round ${number}: ${t.title}`;
  setCrumbs([[t.title, `#/t/${id}`], [`Round ${number}`]]);
  const boards = lazyBoards();
  const gameHref = (file) => gameLink(id, file);
  const nav = el('div', { class: 'filters', style: 'margin:0' },
    number > 1 ? el('a', { class: 'btn', href: roundHref(id, number - 1) }, icon('prev'), `Round ${number - 1}`) : '',
    number < t.rounds.length ? el('a', { class: 'btn', href: roundHref(id, number + 1) }, `Round ${number + 1}`, icon('next')) : '');
  const decisive = round.games.filter((g) => g.result === '1-0' || g.result === '0-1').length;
  app.replaceChildren(
    el('div', { class: 'game-head' }, el('h1', {}, `Round ${number}`, el('span', { class: 'muted', style: 'font-size:0.95rem;font-weight:400' }, `of ${t.rounds_total} · ${round.games.length} games · ${decisive} decisive`)), nav),
    el('section', {}, el('h2', {}, 'Highlights'), highlightCards(t, id, round, players, boards.observe)),
    el('section', {}, el('h2', {}, 'Results'), el('div', { class: 'games-grid' }, round.games.map((g) => gameCard({ ...g, round: number }, players, gameHref, boards.observe))),
      round.bye ? el('p', { class: 'muted' }, `Bye: ${players[round.bye].name}.`) : ''),
    number === t.rounds.length ? teaser(t, players) : '');
  cleanup = boards.disconnect;
}

/* ---------- Tournament ---------- */

const filters = { round: 'all', player: 'all', result: 'all', termination: 'all' };

// Before round 1 is out: who plays, the first pairings and the way to the players' cards.
function renderLineUp(t, id, players) {
  const chips = el('nav', { class: 'section-nav', 'aria-label': 'Rounds' }, el('span', { class: 'muted' }, 'Rounds:'),
    Array.from({ length: t.rounds_total }, (_, i) => el('span', { class: 'pill pill-locked', 'aria-disabled': 'true', title: 'not released yet' }, `R${i + 1}`)));
  const banner = el('section', { class: 'banner' },
    el('div', { class: 'banner-head' },
      el('div', {}, el('div', { class: 'highlight-label' }, 'Round 0'), el('h2', {}, `${t.standings.length} players, ${t.rounds_total} rounds, one board each`)),
      el('a', { class: 'btn', href: 'participants.html' }, 'Meet the players', icon('next'))),
    el('p', { class: 'muted', style: 'margin:0' }, 'Frontier and open LLMs, a System One model and one human play a Swiss chess tournament. Every model is shown the position and the list of legal moves, and answers with one. The games are released one round at a time.'));
  const lineUp = el('section', {}, el('h2', {}, 'The players'), el('div', { class: 'lineup' }, t.standings.map((row) =>
    el('a', { class: 'lineup-player', href: `participants.html#${encodeURIComponent(row.id)}` }, logo(players[row.id]), el('span', { class: 'player-name' }, row.name)))));
  app.replaceChildren(el('h1', {}, t.title), chips, banner, teaser(t, players), lineUp);
}

async function renderTournament(id) {
  const t = await load(`data/${id}/tournament.json`);
  const players = Object.fromEntries(Object.entries(t.players).map(([pid, p]) => [pid, { id: pid, ...p }]));
  const rows = t.standings;
  const hasEval = rows.some((r) => r.accuracy !== null);
  const gameHref = (file) => `#/t/${id}/g/${file.replace('games/', '').replace('.json', '')}`;
  document.title = `AI chess battle: ${t.title}`;
  setCrumbs([[t.title]]);
  if (!t.rounds.length) {
    renderLineUp(t, id, players);
    return;
  }
  const totals = t.totals;
  const hero = el('div', { class: 'hero' },
    [
      [`${t.rounds.length} of ${t.rounds_total}`, t.rounds.length < t.rounds_total ? 'rounds played so far' : 'rounds'],
      [totals.games, 'games'],
      [totals.moves.toLocaleString(), 'moves'],
      [`${totals.decisive} / ${totals.draws}`, 'decisive / draws'],
      [money(totals.cost_usd), 'spent on model calls'],
      [secs(totals.seconds), 'thinking, models only'],
      [tokens(totals.input_tokens + totals.output_tokens), 'tokens, models only'],
    ].map(([v, l]) => el('div', { class: 'stat' }, el('div', { class: 'stat-value' }, v), el('div', { class: 'stat-label' }, l))));

  const goPlayer = el('label', { class: 'field' }, 'See one player', el('select', { onchange: (e) => e.target.value && (location.hash = playerHref(id, e.target.value)) }, el('option', { value: '' }, 'Choose a player'), rows.map((r) => el('option', { value: r.id }, `${r.rank}. ${r.name}`))));
  const nav = el('nav', { class: 'section-nav', 'aria-label': 'Sections' }, goPlayer,
    [['standings', 'Standings'], ['charts', 'Charts'], ['crosstable', 'Crosstable'], ['games', 'Games']].map(([a, b]) => el('a', { class: 'pill', href: `#/t/${id}`, onclick: (e) => { e.preventDefault(); document.getElementById(a).scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' }); } }, b)));

  // Standings
  const maxPoints = Math.max(...rows.map((r) => r.games), 1);
  const cols = [
    ['#', 'num', (r) => r.rank],
    ['', 'center', (r) => rankDelta(t, r.id, t.rounds.length)],
    ['Player', '', (r) => el('a', { class: 'player-link', href: playerHref(id, r.id) }, playerTag(r))],
    ['Points', 'num', (r) => el('div', { class: 'points-cell' }, el('div', { class: 'points-bar', 'aria-hidden': 'true' }, el('span', { style: `width:${(r.points / maxPoints) * 100}%` })), el('strong', {}, half(r.points)))],
    ['W D L', 'center', (r) => el('span', { class: 'wdl', title: `${r.wins} won, ${r.draws} drawn, ${r.losses} lost`, 'aria-label': `${r.wins} won, ${r.draws} drawn, ${r.losses} lost` }, [...Array(r.wins)].map(() => el('span', { class: 'w' })), [...Array(r.draws)].map(() => el('span', { class: 'd' })), [...Array(r.losses)].map(() => el('span', { class: 'l' })))],
    ['BH C1', 'num', (r) => half(r.buchholz_cut1)],
    ['BH', 'num', (r) => half(r.buchholz)],
    ['SB', 'num', (r) => r.sonneborn_berger.toFixed(2)],
    ...(hasEval ? [
      ['Accuracy', 'num', (r) => (r.accuracy === null ? '' : `${r.accuracy}%`)],
      ['ACPL', 'num', (r) => r.acpl ?? ''],
      ['Best', 'num', (r) => (r.best_rate === null ? '' : `${Math.round(r.best_rate * 100)}%`)],
      ['?!', 'num', (r) => r.inaccuracies],
      ['?', 'num', (r) => r.mistakes],
      ['??', 'num', (r) => r.blunders],
    ] : []),
    ['Illegal', 'num', (r) => (r.id === 'human' ? DASH : r.illegal || '')],
    ['s / move', 'num', (r) => (r.seconds_per_move ?? DASH)],
    ['Tokens', 'num', (r) => tokens(known([r.input_tokens, r.output_tokens]))],
    ['Cost', 'num', (r) => money(r.cost_usd)],
  ];
  const standings = el('section', { id: 'standings' }, el('h2', {}, 'Standings'),
    el('div', { class: 'card table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, cols.map(([h, c]) => el('th', { class: c, scope: 'col' }, h)))),
      el('tbody', {}, rows.map((r) => el('tr', { class: filters.player === r.id ? 'selected' : '' }, cols.map(([, c, f]) => el('td', { class: c }, f(r)))))))),
    el('p', { class: 'muted' }, 'Ties are broken by Buchholz Cut 1, Buchholz, Sonneborn-Berger, then wins.', hasEval ? ` Accuracy, average centipawn loss and move judgements come from Stockfish at depth ${t.depth}.` : ''));

  // Charts
  const perPlayer = rows.filter((r) => r.id !== 'human');
  const logScale = (v) => (v >= 1 ? `$${v}` : `$${v}`);
  const charts = el('section', { id: 'charts' }, el('h2', {}, 'Charts'), el('div', { class: 'charts' },
    el('div', { class: 'card' }, el('h3', {}, 'Points against money spent'), scatter(perPlayer, { x: (r) => r.cost_usd, y: (r) => r.points, xLog: true, xLabel: 'Cost (log scale)', yLabel: 'Points', fmtX: logScale, fmtY: half, href: (r) => playerHref(id, r.id) })),
    hasEval && el('div', { class: 'card' }, el('h3', {}, 'Accuracy against thinking time'), scatter(rows, { x: (r) => r.seconds_per_move, y: (r) => r.accuracy, xLog: true, xLabel: 'Seconds per move (log scale)', yLabel: 'Accuracy %', fmtX: (v) => `${v}s`, fmtY: (v) => `${Math.round(v)}`, href: (r) => playerHref(id, r.id) })),
    hasEval && el('div', { class: 'card' }, el('h3', {}, 'Accuracy'), bars(rows, { value: (r) => r.accuracy, fmt: (v) => `${v}%`, label: 'Accuracy per player', note: (r) => `${r.blunders} blunders, ${r.mistakes} mistakes, ${r.inaccuracies} inaccuracies` })),
    hasEval && el('div', { class: 'card' }, el('h3', {}, 'Blunders per 100 moves'), bars(rows, { value: (r) => (r.moves ? (r.blunders / r.moves) * 100 : null), fmt: (v) => v.toFixed(1), label: 'Blunders per 100 moves', colour: () => 'var(--blunder)', note: (r) => `${r.blunders} in ${r.moves} moves` })),
    el('div', { class: 'card' }, el('h3', {}, 'Thinking time per move'), bars(rows, { value: (r) => r.seconds_per_move, fmt: (v) => `${v}s`, label: 'Seconds per move', colour: () => 'var(--series-white)' })),
    el('div', { class: 'card' }, el('h3', {}, 'Cost per point'), bars(perPlayer.filter((r) => r.points > 0 && r.cost_usd > 0), { value: (r) => r.cost_usd / r.points, fmt: money, label: 'Dollars per point', colour: () => 'var(--series-black)', note: (r) => `${money(r.cost_usd)} for ${half(r.points)} points` })),
  ));

  // Crosstable
  const allGames = t.rounds.flatMap((round) => round.games.map((g) => ({ ...g, round: round.number })));
  const byPair = new Map();
  for (const g of allGames) {
    for (const [me, other, colour] of [[g.white, g.black, 'white'], [g.black, g.white, 'black']]) {
      const key = `${me}|${other}`;
      if (!byPair.has(key)) byPair.set(key, []);
      byPair.get(key).push({ g, colour });
    }
  }
  const score = (g, colour) => (g.result === '1/2-1/2' ? 'd' : (g.result === '1-0') === (colour === 'white') ? 'w' : 'l');
  const cross = el('section', { id: 'crosstable' }, el('h2', {}, 'Crosstable'), el('div', { class: 'card table-wrap' }, el('table', { class: 'crosstable' },
    el('thead', {}, el('tr', {}, el('th', { class: 'rowhead', scope: 'col' }, 'Player'), rows.map((r) => el('th', { class: 'colhead', scope: 'col', title: r.name }, r.rank)))),
    el('tbody', {}, rows.map((me) => el('tr', {}, el('th', { class: 'rowhead', scope: 'row' }, el('span', { class: 'muted' }, `${me.rank}. `), el('a', { class: 'player-link', href: playerHref(id, me.id) }, playerTag(me))),
      rows.map((other) => {
        if (other.id === me.id) return el('td', {}, el('div', { class: 'xcell self' }));
        const met = byPair.get(`${me.id}|${other.id}`) || [];
        return el('td', {}, el('div', { class: 'xcell' }, met.map(({ g, colour }) => {
          const s = score(g, colour);
          const link = el('a', { class: s, href: gameHref(g.file), 'aria-label': `${me.name} against ${other.name}, round ${g.round}: ${g.result}` }, s === 'w' ? '1' : s === 'd' ? '½' : '0');
          return tip(link, `Round ${g.round}: ${me.name} (${colour}) against ${other.name}\n${g.result}, ${g.termination}, ${Math.ceil(g.plies / 2)} moves`);
        })));
      })))))));

  // Games
  const grid = el('div', { class: 'games-grid' });
  const select = (name, label, options) => el('label', { class: 'field' }, label, el('select', { onchange: (e) => { filters[name] = e.target.value; drawGames(); } }, options.map(([v, text]) => el('option', { value: v, selected: filters[name] === v }, text))));
  const terminations = [...new Set(allGames.map((g) => g.termination))];
  const gamesSection = el('section', { id: 'games' }, el('h2', {}, 'Games'),
    el('div', { class: 'filters' },
      select('round', 'Round', [['all', 'All rounds'], ...t.rounds.map((r) => [String(r.number), `Round ${r.number}`])]),
      select('player', 'Player', [['all', 'Everyone'], ...rows.map((r) => [r.id, r.name])]),
      select('result', 'Result', [['all', 'Any result'], ['decisive', 'Decisive'], ['1-0', 'White won'], ['0-1', 'Black won'], ['1/2-1/2', 'Draws']]),
      select('termination', 'Ended by', [['all', 'Anything'], ...terminations.map((x) => [x, x])])),
    grid);

  const boards = lazyBoards();
  const card = (g) => gameCard(g, players, gameHref, boards.observe);

  function drawGames() {
    const shown = allGames.filter((g) =>
      (filters.round === 'all' || String(g.round) === filters.round)
      && (filters.player === 'all' || g.white === filters.player || g.black === filters.player)
      && (filters.result === 'all' || (filters.result === 'decisive' ? g.result === '1-0' || g.result === '0-1' : g.result === filters.result))
      && (filters.termination === 'all' || g.termination === filters.termination));
    const children = [];
    let round = null;
    for (const g of shown) {
      if (g.round !== round) {
        round = g.round;
        const bye = t.rounds[round - 1].bye;
        children.push(el('h3', { class: 'round-title' }, `Round ${round}`, bye ? ` · bye: ${players[bye]?.name}` : ''));
      }
      children.push(card(g));
    }
    grid.replaceChildren(...(children.length ? children : [el('p', { class: 'state' }, 'No game matches these filters.')]));
  }
  drawGames();

  const latest = t.rounds[t.rounds.length - 1];
  const banner = latest && el('section', { class: 'banner' },
    el('div', { class: 'banner-head' },
      el('div', {}, el('div', { class: 'highlight-label' }, t.rounds.length < t.rounds_total ? 'Just released' : 'Final round'), el('h2', {}, `Round ${latest.number} of ${t.rounds_total}`)),
      el('a', { class: 'btn', href: roundHref(id, latest.number) }, 'Every game of this round', icon('next'))),
    highlightCards(t, id, latest, players, boards.observe)) || '';
  const roundChips = el('nav', { class: 'section-nav', 'aria-label': 'Rounds' }, el('a', { class: 'pill', href: 'participants.html' }, 'Meet the players'), el('span', { class: 'muted' }, 'Rounds:'), t.rounds.map((r) => el('a', { class: 'pill', href: roundHref(id, r.number) }, `R${r.number}`)),
    Array.from({ length: t.rounds_total - t.rounds.length }, (_, i) => el('span', { class: 'pill pill-locked', 'aria-disabled': 'true', title: 'not released yet' }, `R${t.rounds.length + i + 1}`)));
  const bump = t.ranks && t.rounds.length > 1 && el('section', { id: 'ranks' }, el('h2', {}, 'Place after each round'), el('div', { class: 'card' }, bumpChart(t, id))) || '';
  app.replaceChildren(el('h1', {}, t.title), el('p', { class: 'muted' }, `Started ${new Date(t.started_at * 1000).toLocaleString()}. `, el('a', { href: `data/${id}/tournament.pgn`, download: `${id}.pgn` }, 'Download every game in PGN')), roundChips, banner, teaser(t, players), hero, nav, standings, bump, charts, cross, gamesSection);
  cleanup = boards.disconnect;
}

/* ---------- Game ---------- */

function material(fen) {
  let diff = 0;
  for (const c of fen.split(' ')[0]) {
    const v = VALUES[c.toLowerCase()];
    if (v) diff += c === c.toUpperCase() ? v : -v;
  }
  return diff;
}

function evalGraph(game, onSeek) {
  const W = 800, H = 150, mid = H / 2;
  const n = game.plies.length;
  const x = (i) => (i / Math.max(1, n)) * W;
  const values = (game.evals || []).map((e) => winChances(e.cp));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart graph', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Advantage over the game: above the line White is better, below Black' });
  root.append(svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'var(--eval-black)' }));
  if (values.length) {
    const pts = values.map((v, i) => `${x(i)},${mid - v * mid}`).join(' ');
    root.append(svg('polygon', { points: `0,${H} ${pts} ${x(values.length - 1)},${H}`, fill: 'var(--eval-white)' }));
    root.append(svg('polyline', { points: pts, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
  }
  root.append(svg('line', { x1: 0, x2: W, y1: mid, y2: mid, stroke: 'var(--draw)', 'stroke-dasharray': '4 4', 'vector-effect': 'non-scaling-stroke' }));
  game.plies.forEach((p, i) => {
    if (!['mistake', 'blunder'].includes(p.judgement)) return;
    root.append(svg('circle', { cx: x(i + 1), cy: mid - (values[i + 1] ?? 0) * mid, r: 4, fill: `var(--${p.judgement})`, stroke: 'var(--surface)', 'stroke-width': 1 }));
  });
  const cursor = svg('line', { y1: 0, y2: H, stroke: 'var(--focus)', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
  root.append(cursor);
  const plyAt = (e) => Math.round(((e.clientX - root.getBoundingClientRect().left) / root.getBoundingClientRect().width) * n);
  root.addEventListener('click', (e) => onSeek(plyAt(e)));
  tip(root, () => '');
  root.addEventListener('pointermove', (e) => {
    const i = Math.max(0, Math.min(n, plyAt(e)));
    const p = game.plies[i - 1];
    showTip(e, i === 0 ? 'Start' : `${Math.ceil(i / 2)}${i % 2 ? '.' : '...'} ${p.san}  ${evalText(game.evals?.[i])}${p.judgement && p.judgement !== 'best' ? `\n${JUDGEMENT[p.judgement].label}` : ''}`);
  });
  return { root, move: (ply) => { cursor.setAttribute('x1', x(ply)); cursor.setAttribute('x2', x(ply)); } };
}

function timeGraph(game, onSeek) {
  const W = 800, H = 120, mid = H / 2;
  const n = game.plies.length;
  const bw = W / Math.max(1, n);
  const max = Math.sqrt(Math.max(...game.plies.map((p) => p.seconds), 1));
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart graph', preserveAspectRatio: 'none', role: 'img', 'aria-label': 'Thinking time per move: White above the line, Black below' });
  const rects = game.plies.map((p, i) => {
    const h = (Math.sqrt(p.seconds) / max) * (mid - 4);
    const white = p.colour === 'white';
    const fill = p.judgement && p.judgement !== 'best' ? `var(--${p.judgement})` : white ? 'var(--series-white)' : 'var(--series-black)';
    const r = svg('rect', { x: i * bw + bw * 0.1, width: bw * 0.8, y: white ? mid - h : mid, height: Math.max(0.5, h), fill, opacity: 0.85 });
    root.append(r);
    return r;
  });
  root.append(svg('line', { x1: 0, x2: W, y1: mid, y2: mid, stroke: 'var(--border)', 'vector-effect': 'non-scaling-stroke' }));
  const plyAt = (e) => Math.floor(((e.clientX - root.getBoundingClientRect().left) / root.getBoundingClientRect().width) * n) + 1;
  root.addEventListener('click', (e) => onSeek(plyAt(e)));
  root.addEventListener('pointermove', (e) => {
    const i = Math.max(1, Math.min(n, plyAt(e)));
    const p = game.plies[i - 1];
    showTip(e, `${Math.ceil(i / 2)}${i % 2 ? '.' : '...'} ${p.san}: ${secs(p.seconds)}${p.cost_usd ? `, ${money(p.cost_usd)}` : ''}`);
  });
  root.addEventListener('pointerleave', hideTip);
  return { root, move: (ply) => rects.forEach((r, i) => r.setAttribute('opacity', i === ply - 1 ? 1 : 0.55)) };
}

function createEngine() {
  let worker = null;
  let resolveLine = null;
  return {
    analyse(fen, depth, onInfo) {
      if (!worker) {
        worker = new Worker('vendor/stockfish/stockfish-19-lite-single.js');
        worker.postMessage('uci');
      }
      worker.postMessage('stop');
      return new Promise((resolve) => {
        resolveLine?.(null);
        resolveLine = resolve;
        const white = fen.split(' ')[1] === 'w';
        let last = null;
        worker.onmessage = (event) => {
          const line = String(event.data);
          const score = line.match(/ score (cp|mate) (-?\d+)/);
          const pv = line.match(/ pv (.+)$/);
          const d = line.match(/ depth (\d+)/);
          if (line.startsWith('info') && score && pv && !line.includes('bound')) {
            const value = Number(score[2]) * (white ? 1 : -1);
            last = score[1] === 'cp' ? { cp: value, mate: null } : { cp: value > 0 ? 1000 : -1000, mate: value };
            last.pv = pv[1].split(' ');
            last.depth = Number(d?.[1] || 0);
            onInfo(last);
          }
          if (line.startsWith('bestmove') && resolveLine === resolve) {
            resolveLine = null;
            resolve(last);
          }
        };
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go depth ${depth}`);
      });
    },
    stop() { worker?.terminate(); worker = null; },
  };
}

async function renderGame(id, name) {
  const [t, game] = await Promise.all([load(`data/${id}/tournament.json`), load(`data/${id}/games/${name}.json`)]);
  const players = Object.fromEntries(Object.entries(t.players).map(([pid, p]) => [pid, { id: pid, ...p }]));
  const white = players[game.white], black = players[game.black];
  const n = game.plies.length;
  const start = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  let ply = n;
  let orientation = game.black === 'human' ? 'black' : 'white';
  let playing = null;
  let engineOn = false;
  const engine = createEngine();
  document.title = `${white.name} vs ${black.name}, round ${game.round}`;
  setCrumbs([[t.title, `#/t/${id}`], [`Round ${game.round}, board ${game.board}`]]);

  const boardNode = el('div', { class: 'board' });
  const ground = Chessground(boardNode, { fen: game.fen, viewOnly: true, animation: { enabled: !reducedMotion, duration: 180 }, orientation, drawable: { enabled: true, visible: true } });
  const resize = new ResizeObserver(() => ground.redrawAll());
  resize.observe(boardNode);

  const evalFill = el('div', { class: 'evalbar-white' });
  const evalTop = el('div', { class: 'evalbar-label', style: 'top:4px;color:var(--eval-white)' });
  const evalBottom = el('div', { class: 'evalbar-label', style: 'bottom:4px;color:var(--eval-black)' });
  const evalBar = el('div', { class: 'evalbar', role: 'meter', 'aria-label': 'Advantage', 'aria-valuemin': -100, 'aria-valuemax': 100 }, evalFill, evalTop, evalBottom);

  const bar = () => {
    const stats = el('span', { class: 'pbar-stats' });
    const node = el('div', { class: 'pbar' }, el('span', {}), stats);
    return { node, stats };
  };
  const topBar = bar(), bottomBar = bar();

  const moveButtons = [];
  const moveList = el('ol', {});
  for (let i = 0; i < n; i += 2) {
    const cell = (index) => {
      const p = game.plies[index];
      if (!p) return el('span', {});
      const j = p.judgement && JUDGEMENT[p.judgement];
      const btn = el('button', { class: 'mv', type: 'button', onclick: () => go(index + 1) },
        el('span', {}, p.san, j ? el('span', { class: `mark j-${p.judgement}`, title: j.label }, j.mark) : '', p.illegal_answers.length ? el('span', { class: 'j-blunder', title: `${p.illegal_answers.length} illegal answer(s)` }, ' ×') : ''),
        el('span', { class: 't' }, secs(p.seconds)));
      moveButtons[index + 1] = btn;
      return btn;
    };
    moveList.append(el('li', {}, el('span', { class: 'mn' }, `${i / 2 + 1}.`), cell(i), cell(i + 1)));
  }
  const movesCard = el('div', { class: 'card moves' }, moveList);

  const detail = el('div', { class: 'card detail' });
  const engineLine = el('div', { class: 'engine-line muted' });
  const engineButton = el('button', { class: 'btn', type: 'button', 'aria-pressed': 'false', onclick: () => { engineOn = !engineOn; engineButton.setAttribute('aria-pressed', String(engineOn)); if (!engineOn) { engine.stop(); engineLine.textContent = ''; } draw(); } }, icon('engine'), 'Live Stockfish');
  const playButton = iconButton('play', 'Play through', () => toggle());

  const evalG = evalGraph(game, (i) => go(i));
  const timeG = timeGraph(game, (i) => go(i));

  function toggle(stop) {
    if (playing || stop) {
      clearInterval(playing);
      playing = null;
    } else {
      if (ply >= n) go(0);
      playing = setInterval(() => (ply >= n ? toggle(true) : go(ply + 1)), 900);
    }
    playButton.replaceChildren(icon(playing ? 'pause' : 'play'));
    playButton.setAttribute('aria-label', playing ? 'Pause' : 'Play through');
  }

  function go(target) {
    ply = Math.max(0, Math.min(n, target));
    draw();
  }

  function fillBar(b, colour, player) {
    const upTo = game.plies.slice(0, ply).filter((p) => p.colour === colour);
    const spent = known(upTo.map((p) => p.seconds));
    const cost = known(upTo.map((p) => p.cost_usd));
    const hidden = game[colour] === 'human';
    const fen = ply ? game.plies[ply - 1].fen : start;
    const diff = material(fen) * (colour === 'white' ? 1 : -1);
    const toMove = fen.split(' ')[1] === colour[0];
    b.node.classList.toggle('to-move', toMove && ply < n);
    b.node.firstChild.replaceWith(el('span', { class: 'player' }, logo(player), el('strong', { class: 'player-name' }, player.name), el('span', { class: 'muted' }, colour === 'white' ? '(White)' : '(Black)'), diff > 0 ? el('span', { class: 'muted' }, `+${diff}`) : ''));
    b.stats.replaceChildren(
      el('span', { title: 'thinking time so far' }, hidden ? DASH : secs(spent ?? 0)),
      el('span', { title: 'cost so far' }, hidden ? DASH : money(cost ?? 0)),
      el('span', { title: 'moves' }, `${upTo.length} moves`));
  }

  function detailFor(p) {
    if (!p) {
      return [el('div', { class: 'judgement-line' }, 'Start position'), el('p', { class: 'muted' }, `${white.name} against ${black.name}. ${game.result || 'Unfinished'} by ${game.termination}. Use the arrow keys to step through the moves.`)];
    }
    const mover = players[p.player] || { name: p.player };
    const j = p.judgement && JUDGEMENT[p.judgement];
    const head = el('div', { class: 'judgement-line' }, `${Math.ceil(p.ply / 2)}${p.colour === 'white' ? '.' : '...'} ${p.san} `, j ? el('span', { class: `j-${p.judgement}` }, j.label) : '');
    const items = [
      ['Played by', mover.name],
      ['Thinking time', secs(p.seconds)],
      p.eval && ['Evaluation after', evalText(p.eval)],
      p.best && p.best !== p.san && ['Stockfish preferred', p.best],
      p.loss !== undefined && ['Centipawns lost', p.loss],
      p.accuracy !== undefined && ['Move accuracy', `${p.accuracy}%`],
      p.player === 'human' && ['Tokens and cost', DASH],
      p.input_tokens && ['Tokens in / out', `${p.input_tokens.toLocaleString()} / ${(p.output_tokens || 0).toLocaleString()}`],
      p.cost_usd && ['Cost', money(p.cost_usd)],
      p.call?.reasoning_chars && ['Reasoning', `${p.call.reasoning_chars.toLocaleString()} characters`],
      p.call?.finish_reason && p.call.finish_reason !== 'stop' && ['Finish reason', p.call.finish_reason],
      p.call?.blanks && ['Empty replies retried', p.call.blanks],
      p.call?.truncated && ['Cut short and retried', p.call.truncated],
      p.forced && ['Forced', 'the only legal move'],
    ].filter(Boolean);
    const out = [head, el('dl', {}, items.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]))];
    if (p.top.length) {
      const total = Math.max(...p.top.map(([, v]) => v), 1e-9);
      out.push(el('h3', { style: 'margin-top:12px' }, `${mover.name}'s probabilities`), el('div', { class: 'probs' }, p.top.map(([san, v]) => el('div', { class: `prob${san === p.san ? ' chosen' : ''}` }, el('span', {}, san), el('div', { class: 'prob-bar' }, el('span', { style: `width:${(v / total) * 100}%` })), el('span', { class: 'num' }, `${Math.round(v * 100)}%`)))));
    }
    if (p.call?.reply) out.push(el('div', { class: 'reply', 'aria-label': 'Raw reply' }, p.call.reply));
    if (p.illegal_answers.length) {
      out.push(el('details', {}, el('summary', { class: 'j-blunder' }, `${p.illegal_answers.length} illegal answer${p.illegal_answers.length > 1 ? 's' : ''} before this move`), p.illegal_answers.map((a) => el('pre', {}, a))));
    }
    return out;
  }

  async function runEngine(fen) {
    if (!engineOn) return;
    engineLine.textContent = 'Stockfish is thinking';
    const shown = ply;
    const result = await engine.analyse(fen, 20, (info) => {
      if (shown !== ply) return;
      engineLine.textContent = `Stockfish depth ${info.depth}: ${evalText(info)}, line ${info.pv.slice(0, 6).join(' ')}`;
      ground.setAutoShapes([...baseShapes(), { orig: info.pv[0].slice(0, 2), dest: info.pv[0].slice(2, 4), brush: 'blue' }]);
    });
    if (result && shown === ply) engineLine.textContent = `Stockfish depth ${result.depth}: ${evalText(result)}, line ${result.pv.slice(0, 6).join(' ')}`;
  }

  function baseShapes() {
    const p = game.plies[ply - 1];
    if (!p?.best_uci || p.best_uci === p.uci || !['inaccuracy', 'mistake', 'blunder'].includes(p.judgement)) return [];
    return [{ orig: p.best_uci.slice(0, 2), dest: p.best_uci.slice(2, 4), brush: 'green' }];
  }

  function draw() {
    const p = game.plies[ply - 1];
    const fen = p ? p.fen : start;
    ground.set({ fen, orientation, lastMove: p ? [p.uci.slice(0, 2), p.uci.slice(2, 4)] : undefined, check: p?.check ? (fen.split(' ')[1] === 'w' ? 'white' : 'black') : false });
    ground.setAutoShapes(baseShapes());
    const e = game.evals?.[ply];
    const share = e ? 50 + 50 * winChances(e.cp) : 50;
    evalFill.style.height = `${share}%`;
    evalBar.setAttribute('aria-valuenow', Math.round(share * 2 - 100));
    evalBar.setAttribute('aria-valuetext', e ? evalText(e) : 'not evaluated');
    const text = e ? evalText(e) : '';
    const whiteBetter = (e?.cp ?? 0) >= 0;
    const flipped = orientation === 'black';
    evalBar.style.transform = flipped ? 'scaleY(-1)' : '';
    [evalTop, evalBottom].forEach((l) => (l.style.transform = flipped ? 'scaleY(-1)' : ''));
    evalTop.textContent = whiteBetter ? '' : text;
    evalBottom.textContent = whiteBetter ? text : '';
    const [topColour, bottomColour] = orientation === 'white' ? ['black', 'white'] : ['white', 'black'];
    fillBar(topBar, topColour, players[game[topColour]]);
    fillBar(bottomBar, bottomColour, players[game[bottomColour]]);
    moveButtons.forEach((b, i) => b && b.setAttribute('aria-current', String(i === ply)));
    const current = moveButtons[ply];
    if (current) {
      const box = movesCard.getBoundingClientRect(), r = current.getBoundingClientRect();
      if (r.top < box.top || r.bottom > box.bottom) movesCard.scrollTop += r.top - box.top - box.height / 2;
    } else if (ply === 0) movesCard.scrollTop = 0;
    detail.replaceChildren(...detailFor(p));
    evalG.move(ply);
    timeG.move(ply);
    history.replaceState(null, '', `#/t/${id}/g/${name}${ply === n ? '' : `/${ply}`}`);
    runEngine(fen);
  }

  const onKey = (e) => {
    if (e.target.closest('input, select, textarea')) return;
    const keys = { ArrowLeft: () => go(ply - 1), ArrowRight: () => go(ply + 1), Home: () => go(0), End: () => go(n), ' ': () => toggle(), f: () => { orientation = orientation === 'white' ? 'black' : 'white'; draw(); } };
    if (keys[e.key]) { e.preventDefault(); keys[e.key](); }
  };
  document.addEventListener('keydown', onKey);

  const pgnBlob = URL.createObjectURL(new Blob([game.pgn], { type: 'application/x-chess-pgn' }));
  const summary = ['white', 'black'].map((c) => {
    const s = game.plies.filter((p) => p.colour === c);
    const judged = s.filter((p) => p.accuracy !== undefined);
    const count = (k) => s.filter((p) => p.judgement === k).length;
    return { c, acc: judged.length ? (judged.reduce((a, p) => a + p.accuracy, 0) / judged.length).toFixed(1) : null, best: count('best'), inacc: count('inaccuracy'), mist: count('mistake'), blun: count('blunder'), time: known(s.map((p) => p.seconds)), cost: game[c] === 'human' ? null : known(s.map((p) => p.cost_usd)) ?? 0 };
  });
  const analysis = el('div', { class: 'card table-wrap' }, el('h3', {}, 'Analysis'), el('table', {},
    el('thead', {}, el('tr', {}, ['Player', 'Accuracy', 'Best', 'Inaccuracies', 'Mistakes', 'Blunders', 'Thinking', 'Cost'].map((h, i) => el('th', { class: i ? 'num' : '', scope: 'col' }, h)))),
    el('tbody', {}, summary.map((s) => el('tr', {}, el('td', {}, playerTag(players[game[s.c]])), el('td', { class: 'num' }, s.acc ? `${s.acc}%` : ''), el('td', { class: 'num j-best' }, s.best), el('td', { class: 'num j-inaccuracy' }, s.inacc), el('td', { class: 'num j-mistake' }, s.mist), el('td', { class: 'num j-blunder' }, s.blun), el('td', { class: 'num' }, secs(s.time)), el('td', { class: 'num' }, money(s.cost)))))));

  app.replaceChildren(
    el('div', { class: 'game-head' },
      el('h1', {}, playerTag(white), el('span', { class: 'result-badge' }, game.result || '*'), playerTag(black)),
      el('div', { class: 'controls' }, el('span', { class: 'badge' }, game.termination), el('a', { class: 'btn', href: pgnBlob, download: `${id}-r${game.round}-b${game.board}.pgn` }, icon('download'), 'PGN'))),
    el('div', { class: 'game-layout' },
      el('div', {},
        el('div', { class: 'board-stack' }, topBar.node, el('div', { class: 'board-row' }, evalBar, boardNode), bottomBar.node,
          el('div', { class: 'controls' }, iconButton('first', 'First move', () => go(0)), iconButton('prev', 'Previous move', () => go(ply - 1)), playButton, iconButton('next', 'Next move', () => go(ply + 1)), iconButton('last', 'Last move', () => go(n)), iconButton('flip', 'Flip board', () => { orientation = orientation === 'white' ? 'black' : 'white'; draw(); }), engineButton),
          engineLine)),
      el('div', { class: 'side-panel' }, movesCard, detail)),
    el('div', { class: 'graphs' },
      el('div', { class: 'card' }, el('h3', {}, 'Advantage'), game.evals ? evalG.root : el('p', { class: 'muted' }, 'This build has no engine evaluation.'),
        el('div', { class: 'legend' }, el('span', {}, el('i', { style: 'background:var(--eval-white)' }), 'White better'), el('span', {}, el('i', { style: 'background:var(--eval-black)' }), 'Black better'), el('span', {}, el('i', { style: 'background:var(--mistake)' }), 'Mistake'), el('span', {}, el('i', { style: 'background:var(--blunder)' }), 'Blunder'))),
      el('div', { class: 'card' }, el('h3', {}, 'Thinking time per move'), timeG.root,
        el('div', { class: 'legend' }, el('span', {}, el('i', { style: 'background:var(--series-white)' }), `${white.name} above`), el('span', {}, el('i', { style: 'background:var(--series-black)' }), `${black.name} below`), el('span', {}, 'Bar height grows with the square root of the time'))),
      analysis));
  const startPly = Number(location.hash.split('/')[5]);
  requestAnimationFrame(() => go(Number.isFinite(startPly) && location.hash.split('/').length > 5 ? startPly : n));
  cleanup = () => {
    document.removeEventListener('keydown', onKey);
    toggle(true);
    engine.stop();
    resize.disconnect();
    URL.revokeObjectURL(pgnBlob);
    ground.destroy();
  };
}

/* ---------- Router ---------- */

async function route() {
  cleanup();
  cleanup = () => {};
  hideTip();
  const [, kind, id, sub, name] = location.hash.replace(/^#/, '').split('/');
  try {
    if (kind === 't' && sub === 'g') await renderGame(id, name);
    else if (kind === 't' && sub === 'p') await renderPlayer(id, decodeURIComponent(name));
    else if (kind === 't' && sub === 'r') await renderRound(id, Number(name));
    else if (kind === 't') await renderTournament(id);
    else await renderList();
    if (sub !== 'g') scrollTo(0, 0);
  } catch (error) {
    app.replaceChildren(el('p', { class: 'state' }, `Could not load this page: ${error.message}`));
  }
}
let lastRoute = '';
addEventListener('hashchange', () => {
  const key = location.hash.split('/').slice(0, 5).join('/');
  if (key !== lastRoute) { lastRoute = key; route(); }
});
lastRoute = location.hash.split('/').slice(0, 5).join('/');
route();
