import { compile, Machine, Diagnostic } from './core.js';
const $ = (id) => document.getElementById(id);
const examples = {
  arithmetic:
    'let price = 24;\nlet quantity = 3;\nlet postage = 2 + 3 * 2;\n\nlet total = price * quantity + postage;\nprint total;\nprint total / quantity;',
  state:
    'let balance = 100;\nlet deposit = 25 + 5;\nbalance = balance + deposit;\nprint balance;\n\nbalance = balance - 18;\nprint balance;',
  failure:
    'let numerator = 12;\nprint numerator;\n\nlet denominator = 3 - 3;\nprint numerator / denominator;\nprint 99;',
};
let report = null,
  machine = null,
  page = 0,
  revision = 0;
const pageSize = 80;
function notice(message, error = false) {
  $('notice').textContent = message;
  $('notice').className = error ? 'error' : '';
}
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function invalidate() {
  revision++;
  report = null;
  machine = null;
  page = 0;
  render();
  notice('Source changed. Compile to build a fresh instruction stream.');
}
function focusSource(location) {
  $('source').focus({ preventScroll: true });
  $('source').setSelectionRange(location.offset, location.offset + Math.max(1, location.length));
}
function compileProgram() {
  revision++;
  page = 0;
  try {
    report = compile($('source').value, { optimize: $('optimize').checked });
    machine = new Machine(report.code);
    render();
    notice(
      report.code.length
        ? 'Compiled. Step through each operation or run to the end.'
        : 'Empty program compiled; there are no instructions to execute.',
    );
    return true;
  } catch (error) {
    report = null;
    machine = null;
    render();
    notice(
      `${error instanceof Diagnostic ? `Line ${error.line}, column ${error.column}: ` : ''}${error.message}`,
      true,
    );
    if (error instanceof Diagnostic) focusSource(error);
    return false;
  }
}
function move(action) {
  if (!machine) return;
  machine[action]();
  page = Math.floor(Math.min(machine.pc, Math.max(0, machine.code.length - 1)) / pageSize);
  render();
  if (machine.error) {
    notice(
      `Runtime error · line ${machine.error.line}, column ${machine.error.column}: ${machine.error.message}`,
      true,
    );
    focusSource(machine.error);
  } else
    notice(
      machine.halted
        ? 'Execution complete. Step back to inspect how the result was produced.'
        : `Next: instruction ${machine.pc}.`,
    );
}
function codeRows() {
  const body = $('code-list');
  body.replaceChildren();
  if (!report || !report.code.length) {
    const tr = document.createElement('tr'),
      td = document.createElement('td');
    td.colSpan = 3;
    td.className = 'empty';
    td.textContent = report ? 'No executable instructions.' : 'No compiled instructions.';
    tr.append(td);
    body.append(tr);
    return;
  }
  const from = page * pageSize,
    to = Math.min(from + pageSize, report.code.length);
  for (let index = from; index < to; index++) {
    const i = report.code[index],
      tr = document.createElement('tr');
    if (index === machine.pc) {
      tr.className = 'current';
      tr.setAttribute('aria-current', 'step');
    }
    const pc = document.createElement('td');
    pc.textContent = String(index).padStart(3, '0');
    const op = document.createElement('td');
    op.textContent = i.op + (i.arg === undefined ? '' : '  ' + i.arg);
    const source = document.createElement('td'),
      button = document.createElement('button');
    button.type = 'button';
    button.className = 'source-link';
    button.textContent = `${i.line}:${i.column}`;
    button.setAttribute(
      'aria-label',
      `Select source at line ${i.line}, column ${i.column} for instruction ${index}`,
    );
    button.addEventListener('click', () => focusSource(i));
    source.append(button);
    tr.append(pc, op, source);
    body.append(tr);
  }
  body.querySelector('.current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('page-range').textContent = `${from + 1}–${to} of ${report.code.length}`;
  $('previous').disabled = page === 0;
  $('next').disabled = to === report.code.length;
}
function render() {
  lineNumbers();
  const state = machine?.snapshot();
  $('run').disabled = $('step').disabled = !machine || machine.halted;
  $('back').disabled = !machine || !machine.history.length;
  $('reset').disabled = !machine;
  $('export').disabled = !report;
  $('phase').textContent = !machine
    ? 'AWAITING SOURCE'
    : state.error
      ? 'RUNTIME ERROR'
      : state.halted
        ? 'COMPLETE'
        : machine.pc === 0
          ? 'READY'
          : 'STEPPING';
  $('metrics').textContent = report
    ? `${report.summary.instructions} instructions · ${report.summary.saved} removed by folding · ${report.summary.statements} statements`
    : 'Compile to inspect the instruction stream.';
  $('pages').hidden = !report || report.code.length <= pageSize;
  codeRows();
  const stack = $('stack');
  stack.replaceChildren();
  if (!state?.stack.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.textContent = 'Empty';
    stack.append(empty);
  } else
    for (const value of state.stack) {
      const chip = document.createElement('span');
      chip.className = 'value';
      chip.textContent = String(value);
      stack.append(chip);
    }
  $('output').textContent = state?.output.length ? state.output.join('\n') : 'Nothing printed yet.';
  const variables = $('variables');
  variables.replaceChildren();
  for (const [key, value] of Object.entries(state?.variables || {})) {
    const dt = document.createElement('dt'),
      dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = String(value);
    variables.append(dt, dd);
  }
  $('token-count').textContent = report ? report.summary.tokens : '—';
  $('fold-count').textContent = report ? report.changes.length : '—';
  $('tokens').textContent = report
    ? report.tokens
        .slice(0, 200)
        .map(
          (t) =>
            `${String(t.line).padStart(3)}:${String(t.column).padEnd(3)} ${t.type.padEnd(8)} ${t.text}`,
        )
        .join('\n') +
      (report.tokens.length > 200 ? '\n… first 200 tokens; export includes all tokens.' : '')
    : 'Compile a program first.';
  $('ast').textContent = report
    ? JSON.stringify(report.ast, (key, value) => (key === 'token' ? undefined : value), 2)
    : 'Compile a program first.';
  $('folds').textContent = report
    ? report.changes
        .map((c) => `Line ${c.line}:${c.column} · ${c.operator} → ${c.value}`)
        .join('\n') ||
      (report.optimized ? 'No constant expressions to fold.' : 'Constant folding is disabled.')
    : 'Compile a program first.';
}
$('compile').addEventListener('click', compileProgram);
for (const [id, action] of [
  ['run', 'run'],
  ['step', 'step'],
  ['back', 'back'],
  ['reset', 'reset'],
])
  $(id).addEventListener('click', () => move(action));
$('source').addEventListener('input', invalidate);
$('optimize').addEventListener('change', invalidate);
$('examples').addEventListener('change', () => {
  $('source').value = examples[$('examples').value];
  invalidate();
  notice('Example loaded. Compile it when you are ready.');
});
$('previous').addEventListener('click', () => {
  page = Math.max(0, page - 1);
  codeRows();
});
$('next').addEventListener('click', () => {
  page = Math.min(Math.ceil(report.code.length / pageSize) - 1, page + 1);
  codeRows();
});
$('save-source').addEventListener('click', () =>
  download('program.atelier', $('source').value, 'text/plain;charset=utf-8'),
);
$('export').addEventListener('click', () => {
  if (report)
    download(
      'compiler-report.json',
      JSON.stringify({ ...report, execution: machine.snapshot() }, null, 2),
      'application/json',
    );
});
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  $('file').value = '';
  if (!file) return;
  const version = ++revision;
  try {
    if (file.size > 128000) throw Error('Choose a UTF-8 file no larger than 128 KB.');
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > 128000) throw Error('Choose a file no larger than 128 KB.');
    let source;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw Error('This file is not valid UTF-8.');
    }
    if (source.length > 32000) throw Error('Program exceeds 32,000 characters.');
    if (version !== revision) return;
    $('source').value = source;
    invalidate();
    notice(`Loaded ${file.name}. Compile to inspect it.`);
  } catch (error) {
    if (version === revision) notice(error.message, true);
  }
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    if (compileProgram()) move('run');
  }
});
$('source').value = examples.arithmetic;
render();

function lineNumbers() {
  const source = $('source');
  $('line-numbers').textContent = Array.from(
    { length: source.value.split('\n').length },
    (_, i) => i + 1,
  ).join('\n');
  $('line-numbers').scrollTop = source.scrollTop;
}
$('source').addEventListener('scroll', () => {
  $('line-numbers').scrollTop = $('source').scrollTop;
});
for (const name of ['artifacts', 'guide']) {
  $(name + '-open').addEventListener('click', () => $(name + '-panel').showModal());
  $(name + '-close').addEventListener('click', () => $(name + '-panel').close());
}
