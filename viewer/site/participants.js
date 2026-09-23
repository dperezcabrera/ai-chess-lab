const card = document.getElementById('card');
const counter = document.getElementById('counter');
const dots = document.getElementById('dots');
const prev = document.getElementById('prev');
const next = document.getElementById('next');

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child !== null && child !== undefined && child !== false && child !== '') node.append(child);
  return node;
}

const logoKey = (id) => (id.startsWith('llm:') ? id.slice(4).split('/')[0] : id);
const KIND = { llm: 'LLM', system_one: 'System One', human: 'Human', engine: 'Chess engine' };
const DASH = '-';

function released(value) {
  if (!value) return DASH;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  return date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', ...(day ? { day: 'numeric' } : {}), timeZone: 'UTC' });
}

const perMillion = (v) => (v === null || v === undefined ? DASH : v === 0 ? '$0' : v < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);
const context = (n) => (!n ? DASH : n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M tokens` : `${Math.round(n / 1000)}k tokens`);

// Where a price sits among all players, on a log scale: 0 the cheapest, 1 the dearest.
function scaleOf(values) {
  const logs = values.filter((v) => v > 0).map(Math.log10);
  const lo = Math.min(...logs), hi = Math.max(...logs);
  return (v) => (v === null || v === undefined ? null : v <= 0 ? 0 : hi > lo ? (Math.log10(v) - lo) / (hi - lo) : 0.5);
}

// Green for the cheapest, white in the middle, red for the dearest.
function colourAt(t) {
  const mix = (a, b, f) => a.map((x, i) => Math.round(x + (b[i] - x) * f));
  const green = [47, 158, 91], white = [255, 255, 255], red = [208, 59, 59];
  const rgb = t < 0.5 ? mix(green, white, t / 0.5) : mix(white, red, (t - 0.5) / 0.5);
  return `rgb(${rgb.join(' ')})`;
}

function priceRow(label, value, position) {
  const width = position === null ? 0 : 8 + position * 92;
  return el('div', { class: 'price' },
    el('span', { class: 'price-label' }, label),
    el('div', { class: 'bar', role: 'meter', 'aria-label': `${label} price`, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': Math.round(width) },
      el('span', { style: `width:${width}%;background:${position === null ? 'transparent' : colourAt(position)}` })),
    el('span', { class: 'price-value' }, value === null || value === undefined ? DASH : `${perMillion(value)} / 1M`));
}

function yesNo(value, yes, no) {
  return value === null || value === undefined ? null : el('li', { class: `tag${value ? ' on' : ''}` }, value ? yes : no);
}

function render(player, index, total, scales, direction, first) {
  const logo = player.kind === 'human'
    ? el('span', { class: 'logo-fallback', 'aria-hidden': 'true' }, 'H')
    : el('img', { class: 'logo', src: `logos/${logoKey(player.id)}.png`, alt: '', width: 64, height: 64, onerror: (e) => e.target.replaceWith(el('span', { class: 'logo-fallback', 'aria-hidden': 'true' }, player.name[0])) });
  const frontier = player.frontier && el('li', { class: `tag${player.frontier === 'frontier' ? ' on' : ''}`, title: player.frontier_note || '' }, player.frontier === 'frontier' ? 'Frontier' : player.frontier === 'former frontier' ? 'Former frontier' : 'Not frontier');
  card.replaceChildren(...[
    el('div', { class: 'who' }, logo, el('div', {}, el('h1', {}, player.name), el('div', { class: 'maker' }, [player.company, player.country].filter(Boolean).join(' · ') || DASH))),
    player.kind === 'engine'
      ? el('ul', { class: 'tags' }, el('li', { class: 'tag on' }, KIND.engine), el('li', { class: 'tag on' }, 'Open source'), el('li', { class: 'tag on' }, 'Judge'))
      : el('ul', { class: 'tags' }, el('li', { class: 'tag on' }, KIND[player.kind] || player.kind), yesNo(player.reasoning, 'Reasoning', 'No reasoning'), yesNo(player.open_weights, 'Open weights', 'Closed weights'), frontier),
    player.kind === 'engine'
      ? el('dl', { class: 'facts' },
        el('div', {}, el('dt', {}, 'Released'), el('dd', {}, released(player.released))),
        el('div', {}, el('dt', {}, 'First version'), el('dd', {}, released(player.first_released))),
        el('div', {}, el('dt', {}, 'License'), el('dd', {}, player.license || DASH)))
      : player.kind === 'human'
      ? el('dl', { class: 'facts' }, el('div', {}, el('dt', {}, 'Rating'), el('dd', {}, player.rating ? `${player.rating.value} on ${player.rating.site}` : DASH)))
      : el('dl', { class: 'facts' },
        el('div', {}, el('dt', {}, 'Released'), el('dd', {}, released(player.released))),
        el('div', {}, el('dt', {}, 'Parameters'), el('dd', {}, player.parameters || DASH)),
        el('div', {}, el('dt', {}, 'Context'), el('dd', {}, context(player.context_tokens)))),
    el('p', { class: 'description' }, player.description || ''),
    player.frontier_note && el('p', { class: 'note' }, player.frontier_note),
    !['engine', 'human'].includes(player.kind) && el('div', { class: 'prices' },
      priceRow('Input', player.price_input_per_mtok, scales.input(player.price_input_per_mtok)),
      player.kind !== 'system_one' && priceRow('Output', player.price_output_per_mtok, scales.output(player.price_output_per_mtok)),
      el('div', { class: 'scale', 'aria-hidden': 'true' }, el('span', {}, 'cheapest'), el('span', {}, 'dearest'))),
  ].filter(Boolean));
  card.classList.remove('enter');
  card.style.setProperty('--from', `${direction < 0 ? -16 : 16}px`);
  void card.offsetWidth;
  card.classList.add('enter');
  counter.textContent = `${index + first} / ${total - 1 + first}`;
  prev.disabled = index === 0;
  next.disabled = index === total - 1;
  [...dots.querySelectorAll('button')].forEach((b, i) => b.setAttribute('aria-current', String(i === index)));
  document.title = `${player.name}: AI chess battle players`;
}

async function main() {
  let players;
  try {
    const response = await fetch('data/participants.json');
    if (!response.ok) throw new Error(response.status);
    players = (await response.json()).participants;
  } catch (error) {
    card.replaceChildren(el('p', { class: 'muted' }, `Could not load the players: ${error.message}`));
    return;
  }
  const scales = {
    input: scaleOf(players.map((p) => p.price_input_per_mtok)),
    output: scaleOf(players.map((p) => p.price_output_per_mtok)),
  };
  let index = 0;
  const first = players[0]?.kind === 'engine' ? 0 : 1; // the judge is card 0, the players count from 1
  const go = (target, direction = 1) => {
    index = Math.max(0, Math.min(players.length - 1, target));
    history.replaceState(null, '', `#${index + first}`);
    render(players[index], index, players.length, scales, direction, first);
  };
  dots.replaceChildren(...players.map((p, i) => el('li', {}, el('button', { type: 'button', 'aria-label': p.name, title: p.name, onclick: () => go(i, i < index ? -1 : 1) }))));
  prev.addEventListener('click', () => go(index - 1, -1));
  next.addEventListener('click', () => go(index + 1, 1));
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(index + 1, 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1, -1); }
  });
  const wanted = decodeURIComponent(location.hash.slice(1));
  const byId = players.findIndex((p) => p.id === wanted);
  go(byId >= 0 ? byId : wanted === '' ? 0 : Math.max(0, Number(wanted) - first || 0));
}

main();
