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

// The rainbow from green for the cheapest, through yellow and orange, to red for the dearest.
const colourAt = (t) => `hsl(${Math.round(130 * (1 - t))} 78% 48%)`;

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

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let running = [];
let stampTimer = null;

// Buzzwords pile up at odd angles, then clear for the punchline. Every loop draws other phrases in other places,
// and the loops go on until the slide is left.
function renderIntro(intro) {
  const step = 700;
  const hold = 5500;
  const count = Math.min(intro.per_loop || intro.phrases.length, intro.phrases.length);
  const cycle = count * step + hold;
  const clear = (cycle - hold + 200) / cycle;
  const layer = el('div', { class: 'intro', 'aria-label': `${intro.phrases.slice(0, count).join(', ')}. ${intro.punchline}` });
  const punchline = el('p', { class: 'punchline' }, intro.punchline);
  card.replaceChildren(layer);
  const loop = () => {
    const picked = [...intro.phrases].sort(() => Math.random() - 0.5).slice(0, count);
    const tilts = picked.map(() => (Math.random() * 16 - 8).toFixed(1));
    const phrases = picked.map((text, i) => el('span', {
      class: 'buzz',
      style: `left:${4 + Math.random() * 60}%;top:${5 + (i / count) * 80 + Math.random() * 3}%;transform:rotate(${tilts[i]}deg);font-size:${(0.9 + Math.random() * 1.1).toFixed(2)}rem`,
    }, text));
    layer.replaceChildren(...phrases, punchline);
    const width = layer.clientWidth;
    for (const node of phrases) node.style.left = `${Math.max(8, Math.min(node.offsetLeft, width - node.offsetWidth - 16))}px`;
    if (reducedMotion) return;
    running = phrases.map((node, i) => {
      const at = (i * step) / cycle;
      const turn = (scale) => `rotate(${tilts[i]}deg) scale(${scale})`;
      return node.animate([
        { offset: 0, opacity: 0, transform: turn(0.6) },
        { offset: at, opacity: 0, transform: turn(0.6) },
        { offset: Math.min(at + 0.03, clear - 0.01), opacity: 1, transform: turn(1) },
        { offset: clear, opacity: 1, transform: turn(1) },
        { offset: Math.min(clear + 0.03, 1), opacity: 0, transform: turn(1.4) },
        { offset: 1, opacity: 0, transform: turn(1.4) },
      ].map((frame) => ({ ...frame, easing: 'ease-out' })), { duration: cycle });
    });
    const last = punchline.animate([
      { offset: 0, opacity: 0, transform: 'scale(0.9)' },
      { offset: clear + 0.03, opacity: 0, transform: 'scale(0.9)' },
      { offset: clear + 0.07, opacity: 1, transform: 'scale(1)' },
      { offset: 0.97, opacity: 1, transform: 'scale(1)' },
      { offset: 1, opacity: 0, transform: 'scale(1)' },
    ], { duration: cycle });
    running.push(last);
    last.onfinish = () => { if (layer.isConnected) loop(); };
  };
  loop();
}

function renderCover(cover) {
  const lines = cover.lines || [cover.description];
  card.replaceChildren(
    el('img', { class: 'cover-full', src: cover.image, srcset: `${cover.image.replace('.webp', '-600.webp')} 600w, ${cover.image} 1200w, ${cover.image.replace('.webp', '-1536.webp')} 1536w`, sizes: '100vw', alt: cover.image_alt || '', width: 1536, height: 1024, fetchpriority: 'high' }),
    el('h1', { class: 'visually-hidden' }, cover.name),
    el('p', { class: 'cover-lines' }, lines.map((line, i) => el('span', { style: `animation-delay:${400 + i * 450}ms` }, line))));
}

function render(player, index, number, total, scales, direction) {
  clearTimeout(stampTimer);
  running.forEach((animation) => animation.cancel());
  running = [];
  card.classList.toggle('card-intro', player.kind === 'intro');
  card.classList.toggle('card-cover', player.kind === 'cover');
  document.body.classList.toggle('on-cover', player.kind === 'cover');
  if (player.kind === 'intro') {
    renderIntro(player);
    return finish(player, index, number, total, direction);
  }
  if (player.kind === 'cover') {
    renderCover(player);
    return finish(player, index, number, total, direction);
  }
  if (player.kind === 'rules') {
    card.replaceChildren(
      el('div', { class: 'who' }, el('span', { class: 'logo-fallback', 'aria-hidden': 'true' }, '§'), el('div', { class: 'who-text' }, el('h1', {}, player.name), el('div', { class: 'maker' }, 'How the games are played'))),
      el('p', { class: 'description' }, player.description),
      el('ol', { class: 'rules' }, player.rules.map((rule) => el('li', {}, rule))));
    if (player.stamp) stampTimer = setTimeout(() => card.append(el('p', { class: 'who-cares', 'aria-hidden': 'true' }, player.stamp)), 3000);
    return finish(player, index, number, total, direction);
  }
  const logo = player.kind === 'human'
    ? el('span', { class: 'logo-fallback', 'aria-hidden': 'true' }, 'H')
    : el('img', { class: 'logo', src: `logos/${logoKey(player.id)}.png`, alt: '', width: 64, height: 64, onerror: (e) => e.target.replaceWith(el('span', { class: 'logo-fallback', 'aria-hidden': 'true' }, player.name[0])) });
  const frontier = player.frontier === 'frontier' && el('li', { class: 'tag on', title: player.frontier_note || '' }, 'Frontier');
  card.replaceChildren(...[
    el('div', { class: 'who' }, logo, el('div', { class: 'who-text' }, el('div', { class: 'title-row' }, el('h1', {}, player.name), player.role && el('span', { class: 'role' }, player.role)), el('div', { class: 'maker' }, [player.company, player.country].filter(Boolean).join(' · ') || DASH))),
    player.kind === 'engine'
      ? el('ul', { class: 'tags' }, el('li', { class: 'tag on' }, KIND.engine), el('li', { class: 'tag on' }, 'Open source'))
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
    player.metric && el('div', { class: 'metric' }, el('p', {}, el('strong', {}, `${player.metric.name}:`), ` ${player.metric.summary}`), el('p', {}, player.metric.text)),
    player.frontier_note && el('p', { class: 'note' }, player.frontier_note),
    !['engine', 'human'].includes(player.kind) && el('div', { class: 'prices' },
      priceRow('Input', player.price_input_per_mtok, scales.input(player.price_input_per_mtok)),
      player.kind !== 'system_one' && priceRow('Output', player.price_output_per_mtok, scales.output(player.price_output_per_mtok)),
      el('div', { class: 'scale', 'aria-hidden': 'true' }, el('span', {}, 'cheapest'), el('span', {}, 'dearest'))),
  ].filter(Boolean));
  finish(player, index, number, total, direction);
}

function finish(player, index, number, total, direction) {
  card.classList.remove('enter');
  card.style.setProperty('--from', `${direction < 0 ? -16 : 16}px`);
  void card.offsetWidth;
  card.classList.add('enter');
  counter.textContent = number ? `${number} / ${total}` : '';
  prev.disabled = index === 0;
  next.disabled = index === cards - 1;
  [...dots.querySelectorAll('button')].forEach((b, i) => b.setAttribute('aria-current', String(i === index)));
  document.title = `${player.name}: AI chess battle players`;
}

let cards = 0;
if (new URLSearchParams(location.search).has('present')) document.body.classList.add('presenting');

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
  cards = players.length;
  const scales = {
    input: scaleOf(players.map((p) => p.price_input_per_mtok)),
    output: scaleOf(players.map((p) => p.price_output_per_mtok)),
  };
  let seen = 0;
  const numbers = players.map((p) => (['intro', 'cover', 'rules', 'engine'].includes(p.kind) ? null : ++seen));
  let index = 0;
  const go = (target, direction = 1) => {
    index = Math.max(0, Math.min(cards - 1, target));
    history.replaceState(null, '', `#${numbers[index] ?? encodeURIComponent(players[index].id)}`);
    render(players[index], index, numbers[index], seen, scales, direction);
  };
  dots.replaceChildren(...players.map((p, i) => el('li', {}, el('button', { type: 'button', 'aria-label': p.name, title: p.name, onclick: () => go(i, i < index ? -1 : 1) }))));
  prev.addEventListener('click', () => go(index - 1, -1));
  next.addEventListener('click', () => go(index + 1, 1));
  addEventListener('keydown', (e) => {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); go(index + 1, 1); }
    if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); go(index - 1, -1); }
  });
  const wanted = decodeURIComponent(location.hash.slice(1));
  const byId = players.findIndex((p) => p.id === wanted);
  const byNumber = numbers.indexOf(Number(wanted));
  go(byId >= 0 ? byId : wanted && byNumber >= 0 ? byNumber : 0);
}

main();
