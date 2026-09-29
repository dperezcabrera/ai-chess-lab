const PAGE_SIZE = 8;
const dialog = document.getElementById('picker-dialog');
const title = document.getElementById('picker-title');
const search = document.getElementById('picker-search');
const list = document.getElementById('picker-list');
const pageText = document.getElementById('picker-page');
const prev = document.getElementById('picker-prev');
const next = document.getElementById('picker-next');
const footer = document.getElementById('picker-footer');
const count = document.getElementById('picker-count');
const done = document.getElementById('picker-done');
const addButton = document.getElementById('picker-add');
const addForm = document.getElementById('picker-new');
const upstream = document.getElementById('picker-upstream');
const addError = document.getElementById('picker-error');
const CHECK = 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z';

const text = (tag, className, value) => Object.assign(document.createElement(tag), { className, textContent: value });

function icon(path) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  shape.setAttribute('d', path);
  svg.append(shape);
  return svg;
}

let session = null;

function matches(model, query) {
  if (!query) return true;
  const haystack = `${model.name} ${model.upstream} ${model.subtitle}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

function draw() {
  const { models, picked, multiple } = session;
  const shown = models.filter((model) => matches(model, search.value.trim()));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  session.page = Math.min(session.page, pages - 1);
  const slice = shown.slice(session.page * PAGE_SIZE, (session.page + 1) * PAGE_SIZE);
  list.replaceChildren(...slice.map((model) => {
    const selected = picked.has(model.id);
    const row = Object.assign(document.createElement('button'), { type: 'button', className: `picker-row${selected ? ' picked' : ''}`, disabled: !model.ready });
    row.setAttribute(multiple ? 'aria-pressed' : 'aria-current', String(selected));
    const words = document.createElement('span');
    words.className = 'picker-words';
    words.append(text('span', 'picker-name', model.name), text('span', 'picker-sub', model.ready ? model.subtitle : model.note));
    row.append(session.logo(model), words, selected ? icon(CHECK) : '');
    row.addEventListener('click', () => choose(model.id));
    return row;
  }));
  if (!slice.length) list.append(text('li', 'picker-empty', 'No model matches.'));
  pageText.textContent = `${session.page + 1} / ${pages}`;
  prev.disabled = session.page === 0;
  next.disabled = session.page >= pages - 1;
  count.textContent = `${picked.size} selected`;
}

function choose(id) {
  if (!session.multiple) {
    finish([id]);
    return;
  }
  if (session.picked.has(id)) session.picked.delete(id);
  else session.picked.add(id);
  draw();
}

function finish(result) {
  const resolve = session?.resolve;
  session = null;
  dialog.close();
  resolve?.(result);
}

search.addEventListener('input', () => {
  session.page = 0;
  draw();
});
search.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const first = list.querySelector('.picker-row:not(:disabled)');
  if (first) first.click();
});
function showAdd(open) {
  addForm.hidden = !open;
  addButton.setAttribute('aria-expanded', String(open));
  addError.textContent = '';
  if (open) upstream.focus();
  else search.focus();
}

addButton.addEventListener('click', () => showAdd(addForm.hidden));
addForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  addError.textContent = '';
  try {
    const { models, id } = await session.add(upstream.value.trim());
    session.models = models;
    upstream.value = '';
    showAdd(false);
    search.value = '';
    session.page = Math.floor(models.findIndex((model) => model.id === id) / PAGE_SIZE);
    choose(id);
  } catch (error) {
    addError.textContent = error.message;
  }
});
prev.addEventListener('click', () => { session.page -= 1; draw(); });
next.addEventListener('click', () => { session.page += 1; draw(); });
done.addEventListener('click', () => finish([...session.picked]));
document.getElementById('picker-close').addEventListener('click', () => finish(null));
dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });

/** Opens the model picker over the current dialog. `models` carry id, name, upstream, subtitle, ready and note;
 * resolves to the chosen ids, or null when closed without choosing. With `add`, a + button takes an OpenRouter id:
 * `add(upstream)` resolves to the new `{ models, id }` and the model is chosen. */
export function pickModels({ heading, models, selected = [], multiple = false, logo, add = null }) {
  if (session) finish(null);
  return new Promise((resolve) => {
    session = { models, picked: new Set(selected), multiple, logo, add, page: 0, resolve };
    addButton.hidden = !add;
    addForm.hidden = true;
    addButton.setAttribute('aria-expanded', 'false');
    const first = models.findIndex((model) => selected.includes(model.id));
    session.page = !multiple && first >= 0 ? Math.floor(first / PAGE_SIZE) : 0;
    title.textContent = heading;
    search.value = '';
    footer.hidden = !multiple;
    draw();
    dialog.showModal();
    search.focus();
  });
}
