const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const money = value => new Intl.NumberFormat('en-IN', {style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);
const integer = value => new Intl.NumberFormat('en-IN').format(value);
const time = minute => `${String(Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
const escapeHTML = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const labels = {dp:'Dynamic programming',flow:'Minimum-cost flow',fcfs:'First come, first served',profit:'Highest profit',density:'Profit per minute',eft:'Earliest finish',search:'Branch and bound',subsets:'Subset enumeration'};
let station = null;
let activeRun = null;
let shownMethod = null;
let currentView = 'overview';
let page = 0;
let busy = false;
let toastTimer;
let labRevision = null;

async function api(path, options = {}) {
  const response = await fetch(path, {headers:{'Content-Type':'application/json'},...options});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    let message = data.detail || `Request failed (${response.status})`;
    if (Array.isArray(message)) message = message.map(item => `${item.loc.slice(1).join('.')}: ${item.msg}`).join('; ');
    if (response.status === 409) message += ' Refresh the page to load the latest state.';
    throw new Error(message);
  }
  return data;
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.remove('hidden');
  $('#toast').classList.toggle('error',error);
  toastTimer = setTimeout(() => $('#toast').classList.add('hidden'),error ? 9000 : 4200);
}

async function action(button, task) {
  if (busy) return;
  busy = true;
  const text = button?.textContent;
  const controls = $$('button,input,select');
  const disabledBefore = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  if (button) button.textContent = 'Working…';
  document.body.setAttribute('aria-busy','true');
  try { await task(); }
  catch (error) {
    const dialog = $$('dialog[open]').find(item => item.querySelector('.form-error'));
    if (dialog) dialog.querySelector('.form-error').textContent = error.message;
    else notify(error.message,true);
  } finally {
    controls.forEach((control,i) => { control.disabled = disabledBefore[i]; });
    if (button) button.textContent = text;
    busy = false;
    document.body.removeAttribute('aria-busy');
    configureMethods();
    renderRequestTable();
  }
}

function selectedResult() {
  if (!activeRun) return null;
  return activeRun.comparison.find(result => result.algorithm === shownMethod) || activeRun.selected;
}

function currentResult() {
  return activeRun && station && activeRun.revision === station.revision ? selectedResult() : null;
}

function setView(view, focus = false) {
  currentView = view;
  const metadata = {
    overview:['YOUR STATION, AT A GLANCE','A better day, by design.','Find the right sessions. Put every port to work.','Overview'],
    requests:['THE DEMAND BEHIND YOUR DAY','Every arrival is an opportunity.','Manage fixed-slot requests and the value they bring.','Requests'],
    lab:['DESIGN & ANALYSIS OF ALGORITHMS','A little theory. A lot of possibility.','Explore the decisions behind the schedule.','Algorithm lab'],
    history:['YOUR PREVIOUS DECISIONS','Good outcomes, remembered.','Revisit saved schedules and the demand behind them.','Run history']
  };
  $$('.view-panel').forEach(panel => panel.classList.toggle('hidden',panel.id !== `view-${view}`));
  $$('.console-nav button').forEach(button => {
    const selected = button.dataset.view === view;
    button.classList.toggle('active',selected);
    if (selected) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current');
  });
  const [eyebrow,title,subtitle,breadcrumb] = metadata[view];
  $('#page-eyebrow').textContent = eyebrow;
  $('#page-title').textContent = title;
  $('#page-subtitle').textContent = subtitle;
  $('#breadcrumb-current').textContent = breadcrumb;
  document.title = `Volt · ${breadcrumb}`;
  window.history.replaceState(null,'',`/console#${view}`);
  if (view === 'requests') renderRequestTable();
  if (view === 'history') loadHistory().catch(error => notify(error.message,true));
  if (focus) $('#workspace').focus({preventScroll:true});
}

function configureMethods() {
  if (!station) return;
  const select = $('#algorithm');
  [...select.options].forEach(option => {
    option.disabled = (option.value === 'dp' && station.settings.ports !== 1) ||
      (['search','subsets'].includes(option.value) && station.requests.length > 14);
  });
  if (select.selectedOptions[0]?.disabled) select.value = 'optimal';
}

function renderStation() {
  if (!station) return;
  $('#ports').value = station.settings.ports;
  $('#request-count').textContent = station.requests.length;
  const source = station.source.kind === 'synthetic' ? `Seed ${station.source.seed}` : station.source.kind === 'example' ? 'Report example' : 'Custom demand';
  $('#dataset-meta').textContent = `${integer(station.requests.length)} requests · ${source} · Revision ${station.revision}`;
  $('.synthetic-badge').textContent = station.source.kind === 'synthetic' ? 'Synthetic data' : station.source.kind === 'example' ? 'Illustrative example' : 'Custom data';
  $('#connection-state').textContent = 'Saved locally';
  configureMethods();
  renderResults();
  renderRequestTable();
}

function invalidate(nextState, message) {
  station = nextState;
  activeRun = null;
  shownMethod = null;
  page = 0;
  if (labRevision !== null) {
    $('#sensitivity-result').innerHTML = '<div class="empty-state"><h3>Your demand changed.</h3><p>Run the analysis again for the current revision.</p></div>';
    labRevision = null;
  }
  renderStation();
  if (message) notify(message);
}

function renderResults() {
  const result = selectedResult();
  const notice = $('#workspace-notice');
  const historical = activeRun && activeRun.revision !== station.revision;
  notice.classList.toggle('hidden',!!activeRun && !historical);
  notice.textContent = historical ? `Viewing saved revision ${activeRun.revision}. The current station is revision ${station.revision}. Optimize to return to the current day.` : 'Your demand is ready. Optimize the schedule to see what your station can earn.';
  if (!result) {
    ['profit','gain','served','utilization'].forEach(key => $(`#metric-${key}`).textContent = '—');
    $('#metric-profit-caption').textContent = 'Ready when you are';
    $('#metric-gain-caption').textContent = 'Compare the same demand';
    $('#metric-served-caption').textContent = 'Every selected session, assigned';
    $('#comparison-chart').innerHTML = '<p class="muted">Your comparison will appear after optimization.</p>';
    $('#schedule-method').innerHTML = '<option>No schedule yet</option>';
    $('#schedule-method').disabled = true;
    $('#export-schedule').disabled = true;
    $('#schedule-status').textContent = 'Ready to plan';
    $('#schedule-subtitle').textContent = 'One clear timeline. Every session in its place.';
    $('#schedule-runtime').textContent = '';
    $('#timeline').innerHTML = '<div class="empty-state"><span class="empty-icon">⌁</span><h3>Your next great schedule starts here.</h3><p>Run the optimizer to find the best use of your ports.</p></div>';
    renderTrace();
    return;
  }
  const baseline = activeRun.comparison.find(row => row.algorithm === 'fcfs').profit_inr;
  const gain = baseline ? (result.profit_inr / baseline - 1) * 100 : null;
  const delta = result.profit_inr - baseline;
  $('#metric-profit').textContent = money(result.profit_inr);
  $('#metric-profit-caption').textContent = result.exact ? 'Exact optimum for these fixed slots' : 'Heuristic schedule · compare with optimum';
  $('#metric-gain').textContent = gain === null ? '—' : `${gain >= 0 ? '+' : ''}${gain.toFixed(1)}%`;
  $('#metric-gain-caption').textContent = baseline ? `${money(Math.abs(delta))} ${delta >= 0 ? 'more' : 'less'} than first come, first served` : 'FCFS profit is zero; percentage undefined';
  $('#metric-gain-caption').classList.toggle('positive',delta >= 0);
  $('#metric-served').textContent = `${result.accepted} / ${activeRun.requests.length}`;
  $('#metric-served-caption').textContent = `${result.rejected} requests declined · ${result.ports} ports`;
  $('#metric-utilization').textContent = `${result.utilization.toFixed(1)}%`;
  $('#schedule-status').textContent = result.exact ? 'Exact optimum' : 'Greedy baseline';
  $('#schedule-subtitle').textContent = `${result.name} · ${result.accepted} sessions · ${result.ports} charging ports`;
  $('#schedule-validation').textContent = 'Verified · No overlaps · Every session meets its deadline';
  $('#schedule-runtime').textContent = `${result.runtime_ms.toFixed(2)} ms solver time`;
  $('#schedule-method').disabled = false;
  $('#export-schedule').disabled = false;
  const options = [...activeRun.comparison];
  if (!options.some(row => row.algorithm === activeRun.selected.algorithm)) options.unshift(activeRun.selected);
  $('#schedule-method').innerHTML = options.map(row => `<option value="${row.algorithm}">${escapeHTML(labels[row.algorithm])}${row.exact ? ' · Optimal' : ''}</option>`).join('');
  $('#schedule-method').value = result.algorithm;
  const optimum = activeRun.comparison[0].profit_inr;
  $('#comparison-chart').innerHTML = activeRun.comparison.map(row => {
    const share = optimum ? row.profit_inr / optimum * 100 : 100;
    return `<div class="comparison-row"><span class="comparison-name">${row.exact ? 'Optimal' : escapeHTML(labels[row.algorithm])}</span><div class="comparison-bar-track"><div class="comparison-bar" style="width:${share}%"></div></div><span class="comparison-value">${money(row.profit_inr)}<span class="comparison-share">${share.toFixed(1)}% of optimal</span></span></div>`;
  }).join('');
  $('#insight-title').textContent = delta > 0 ? 'Same ports. More possibility.' : 'Make the best of every booking.';
  $('#insight-text').textContent = `${activeRun.comparison[0].name} finds the exact profit maximum. ${result.name} selected ${result.accepted} sessions from ${activeRun.requests.length} requests in ${result.runtime_ms.toFixed(2)} ms.`;
  drawTimeline(result);
  renderTrace();
}

function drawTimeline(result) {
  if (!result.schedule.length) {
    $('#timeline').innerHTML = '<div class="empty-state"><span class="empty-icon">⌁</span><h3>No profitable sessions to schedule.</h3><p>Add requests or review station prices. The empty schedule earns ₹0.</p></div>';
    return;
  }
  const start = Math.min(360, Math.floor(Math.min(...activeRun.requests.map(r => r.arrival_min)) / 60) * 60);
  const end = 1440;
  const width = 1100, left = 78, right = 22, top = 35, rowHeight = 56;
  const height = top + result.ports * rowHeight + 15;
  const x = value => left + (value - start) / (end - start) * (width - left - right);
  let svg = `<svg class="timeline-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(result.name)} charging schedule; ${result.accepted} sessions across ${result.ports} ports"><title>Charging schedule. Select a session for its booking details.</title>`;
  [[480,660],[1020,1260]].forEach(([a,b]) => {
    const from = Math.max(start,a);
    if (from < b) svg += `<rect x="${x(from)}" y="${top-4}" width="${x(b)-x(from)}" height="${result.ports*rowHeight}" fill="#f8f7ef" opacity=".7"/>`;
  });
  for (let tick = start; tick <= end; tick += 120) {
    svg += `<text x="${x(tick)}" y="16" text-anchor="${tick === end ? 'end' : 'middle'}">${time(tick)}</text><line x1="${x(tick)}" x2="${x(tick)}" y1="${top-4}" y2="${height-15}" stroke="#e8edf6" stroke-dasharray="2 4"/>`;
  }
  for (let p=1;p<=result.ports;p++) {
    const y = top + (p-1)*rowHeight;
    svg += `<text class="port-label" x="8" y="${y+23}">Port ${String(p).padStart(2,'0')}</text><line x1="${left}" x2="${width-right}" y1="${y+42}" y2="${y+42}" stroke="#eef2f8"/>`;
  }
  result.schedule.forEach(request => {
    const y = top + (request.port-1)*rowHeight + 5;
    const slotWidth = Math.max(2,x(request.deadline_min)-x(request.arrival_min)-2);
    const color = request.surge_mult >= 2 ? '#c4a45d' : request.surge_mult >= 1.65 ? '#8d87bc' : '#7f9fda';
    const text = `R${request.request_id} · ${time(request.arrival_min)}–${time(request.deadline_min)} · ${money(request.profit_inr)} · Port ${request.port}`;
    svg += `<g class="slot" role="button" tabindex="0" data-session="${request.request_id}" aria-label="${escapeHTML(text)}"><title>${escapeHTML(text)}</title><rect x="${x(request.arrival_min)}" y="${y}" width="${slotWidth}" height="31" rx="4" fill="${color}"/>${slotWidth>29 ? `<text class="session-label" x="${x(request.arrival_min)+slotWidth/2}" y="${y+19}" text-anchor="middle">R${request.request_id}</text>` : ''}</g>`;
  });
  $('#timeline').innerHTML = svg + '</svg>';
}

function renderRequestTable() {
  if (!station) return;
  const result = currentResult();
  const accepted = new Set(result?.schedule.map(row => row.request_id) || []);
  const search = $('#request-search').value.trim().toLowerCase().replace(/^r/,'');
  const filter = $('#request-filter').value;
  const rows = station.requests.map(request => ({...request,status:result ? (accepted.has(request.request_id) ? 'accepted' : 'rejected') : 'unplanned'})).filter(request => String(request.request_id).includes(search) && (filter === 'all' || request.status === filter)).sort((a,b) => a.arrival_min-b.arrival_min || a.request_id-b.request_id);
  const pages = Math.max(1,Math.ceil(rows.length/20));
  page = Math.min(page,pages-1);
  const slice = rows.slice(page*20,page*20+20);
  $('#request-rows').innerHTML = slice.length ? slice.map(request => `<tr><td>R${request.request_id}</td><td>${time(request.arrival_min)} – ${time(request.deadline_min)}</td><td>${request.duration_min} min</td><td>${request.energy_kwh.toFixed(1)} kWh</td><td>${request.surge_mult.toFixed(2)}×</td><td>${money(request.profit_inr)}</td><td><span class="pill status-${request.status}">${request.status[0].toUpperCase()+request.status.slice(1)}</span></td><td><button type="button" class="edit-button" data-edit="${request.request_id}" aria-label="Edit request R${request.request_id}">Edit</button></td></tr>`).join('') : '<tr><td colspan="8"><div class="empty-state"><h3>No requests here yet.</h3><p>Add a booking, generate demand, or adjust your filters.</p></div></td></tr>';
  $('#filter-count').textContent = `${rows.length} matching requests`;
  $('#page-description').textContent = rows.length ? `${page*20+1}–${Math.min((page+1)*20,rows.length)} of ${rows.length} requests` : '0 requests';
  $('#prev-page').disabled = page === 0;
  $('#next-page').disabled = page >= pages-1;
}

function renderTrace() {
  const result = activeRun?.selected;
  if (!result) {
    $('#trace-title').textContent = 'Inside the solver';
    $('#trace-subtitle').textContent = 'Optimize a day to inspect its algorithm trace.';
    $('#trace-content').innerHTML = '<div class="empty-state"><span class="empty-icon">∑</span><h3>Follow the decision.</h3><p>Load the report example for an eight-request DP walkthrough.</p></div>';
    return;
  }
  $('#trace-title').textContent = `Inside ${result.name.toLowerCase()}`;
  $('#trace-subtitle').textContent = `Trace of the executed solver · ${result.accepted} accepted · ${money(result.profit_inr)} total profit`;
  $('#trace-complexity').textContent = result.complexity;
  if (result.algorithm === 'dp') {
    const chosen = new Set(result.schedule.map(r => r.request_id));
    const rows = result.trace.rows.slice(0,300);
    $('#trace-content').innerHTML = `<div class="trace-formula">OPT(j) = max(OPT(j−1), profit(j) + OPT(pred(j)))</div><table class="data-table"><thead><tr><th>j</th><th>Request</th><th>pred(j)</th><th>Include / ₹</th><th>Exclude / ₹</th><th>OPT(j) / ₹</th><th>Local choice</th><th>Traceback</th></tr></thead><tbody>${rows.map(row => `<tr><td>${row.j}</td><td>R${row.request_id}</td><td>${row.predecessor}</td><td>${row.include}</td><td>${row.exclude}</td><td>${row.optimal}</td><td><span class="trace-decision ${row.take ? '' : 'skip'}">${row.take ? 'Take' : 'Skip'}</span></td><td>${chosen.has(row.request_id) ? 'Selected' : '—'}</td></tr>`).join('')}</tbody></table><p class="footnote">The local choice improves a prefix; traceback identifies the final selected set. ${result.trace.rows.length>300 ? 'Showing the first 300 states. Export JSON for the complete trace.' : 'Ties skip the current request, matching the report.'}</p>`;
  } else if (result.algorithm === 'flow') {
    $('#trace-content').innerHTML = `<div class="trace-formula">Request arc: capacity = 1, cost = −profit · Send k units of flow</div><div class="flow-summary"><span><strong>${result.trace.nodes}</strong>time nodes</span><span><strong>${result.trace.arcs}</strong>forward arcs</span><span><strong>${result.trace.augmentations.length}</strong>augmentations</span></div>${result.trace.augmentations.map(row => `<div class="flow-step"><span class="flow-step-number">${row.iteration}</span><div><h3>Dijkstra search · ${row.units} unit${row.units===1?'':'s'} routed</h3><p>Total flow ${row.flow}/${result.ports} · ${row.reverse_arcs} reverse arcs used<br>Path: ${row.path_minutes.slice(0,35).map(time).join(' → ')}${row.path_minutes.length>35 ? ' …' : ''}</p></div><span class="flow-value">+${money(row.profit_change)}</span></div>`).join('')}<p class="footnote">Initial potentials come from a DAG shortest-path pass. Reverse arcs allow earlier choices to be exchanged; Dijkstra uses reduced non-negative costs.</p>`;
  } else {
    const detail = result.algorithm === 'search' ? `The branch-and-bound search visited ${integer(result.trace.visited)} states, pruning branches whose remaining positive profit could not improve the best answer.` : result.algorithm === 'subsets' ? `The oracle independently enumerated ${integer(result.trace.subsets)} subsets and checked their maximum overlap.` : 'This heuristic orders requests by its local rule, then uses minute bitsets to find a port free for the entire booking. It can miss combinations with higher total profit.';
    $('#trace-content').innerHTML = `<div class="empty-state"><span class="empty-icon">${result.exact ? '✓' : '≋'}</span><h3>${escapeHTML(result.name)}</h3><p>${detail}</p></div>`;
  }
}

function openDialog(id) {
  const dialog = $(id);
  const error = dialog.querySelector('.form-error');
  if (error) error.textContent = '';
  dialog.showModal();
}

function requestPreview() {
  const form = $('#request-form');
  const [hour,minute] = form.elements.start.value.split(':').map(Number);
  const deadline = hour*60+minute+Number(form.elements.duration_min.value);
  const value = Number(form.elements.energy_kwh.value)*(station.settings.tariff*Number(form.elements.surge_mult.value)-station.settings.energy_cost);
  $('#request-preview').textContent = `Leave by ${Number.isFinite(deadline) ? time(deadline) : '—'} · Estimated profit ${Number.isFinite(value) ? money(value) : '—'}`;
}

function editRequest(id = null) {
  const request = station.requests.find(r => r.request_id === id);
  const form = $('#request-form');
  form.reset();
  form.elements.request_id.value = request?.request_id || Math.max(0,...station.requests.map(r => r.request_id))+1;
  form.elements.start.value = time(request?.arrival_min ?? 540);
  ['duration_min','energy_kwh','surge_mult'].forEach(key => {
    if (request) form.elements[key].value = request[key];
  });
  $('#request-dialog-label').textContent = request ? `BOOKING R${id}` : 'NEW BOOKING';
  $('#request-dialog-title').textContent = request ? 'Fine-tune this booking.' : 'Make room for a new arrival.';
  $('#delete-request').classList.toggle('hidden',!request);
  requestPreview();
  openDialog('#request-dialog');
}

async function saveState(requests = station.requests, settings = station.settings) {
  const nextState = await api('/api/state',{method:'PUT',body:JSON.stringify({revision:station.revision,requests,settings})});
  invalidate(nextState,'Changes saved. Optimize to update the schedule.');
}

async function optimize() {
  const algorithm = $('#algorithm').value;
  activeRun = await api('/api/optimize',{method:'POST',body:JSON.stringify({revision:station.revision,algorithm})});
  shownMethod = activeRun.selected.algorithm;
  renderStation();
  notify(`${activeRun.selected.exact ? 'Optimal schedule' : 'Schedule'} ready. ${activeRun.selected.accepted} sessions, ${money(activeRun.selected.profit_inr)} profit.`);
}

async function loadHistory() {
  const runs = await api('/api/runs');
  $('#history-content').innerHTML = runs.length ? `<div class="table-scroll history-table"><table class="data-table"><thead><tr><th>Created</th><th>Method</th><th>Revision</th><th>Ports</th><th>Served</th><th>Profit</th><th></th></tr></thead><tbody>${runs.map(run => `<tr><td>${escapeHTML(new Date(run.created).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}))}</td><td>${escapeHTML(run.name)}</td><td>${run.revision}</td><td>${run.ports}</td><td>${run.accepted}</td><td>${money(run.profit_inr)}</td><td><button class="history-open" type="button" data-run="${run.id}">Inspect</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty-state"><span class="empty-icon">◷</span><h3>A fresh start.</h3><p>Run your first optimization to save a schedule here.</p></div>';
}

function showSession(id) {
  const request = selectedResult()?.schedule.find(row => row.request_id === id);
  if (!request) return;
  $('#session-details').innerHTML = `<div class="dialog-heading"><span class="eyebrow">ACCEPTED BOOKING</span><button type="button" class="close-button" data-close aria-label="Close dialog">×</button></div><h2>Request R${id}</h2><p>A complete session on Port ${request.port}, finishing by the driver’s strict deadline.</p><dl class="session-grid"><div><dt>Booking slot</dt><dd>${time(request.arrival_min)}–${time(request.deadline_min)}</dd></div><div><dt>Duration</dt><dd>${request.duration_min} minutes</dd></div><div><dt>Energy</dt><dd>${request.energy_kwh.toFixed(1)} kWh</dd></div><div><dt>Surge</dt><dd>${request.surge_mult.toFixed(2)}×</dd></div><div><dt>Net profit</dt><dd>${money(request.profit_inr)}</dd></div><div><dt>Port assignment</dt><dd>Port ${String(request.port).padStart(2,'0')}</dd></div></dl><button class="button secondary" type="button" data-close>Back to schedule</button>`;
  openDialog('#session-dialog');
}

function chart(rows, series, valueKey, xLabel, valueLabel) {
  const width=900,height=280,left=75,right=30,top=25,bottom=45;
  const maximum = Math.max(1,...rows.flatMap(row => series.map(item => row[item.key])))*1.1;
  const x = index => left+(index/(rows.length-1))*(width-left-right);
  const y = value => top+(1-value/maximum)*(height-top-bottom);
  let content = `<svg class="lab-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(valueLabel)} by ${escapeHTML(xLabel)}"><title>${escapeHTML(valueLabel)} by ${escapeHTML(xLabel)}. Data is also available in the table below.</title>`;
  for(let i=0;i<=4;i++) {
    const value=maximum*i/4;
    content+=`<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" stroke="#e5ecf6"/><text x="${left-12}" y="${y(value)+4}" text-anchor="end">${maximum>100 ? integer(Math.round(value)) : value.toFixed(1)}</text>`;
  }
  rows.forEach((row,i) => {content+=`<text x="${x(i)}" y="${height-16}" text-anchor="middle">${row[valueKey]}</text>`;});
  series.forEach(item => {
    content+=`<polyline fill="none" stroke="${item.color}" stroke-width="2.5" points="${rows.map((row,i)=>`${x(i)},${y(row[item.key])}`).join(' ')}"/>`;
    rows.forEach((row,i)=>{content+=`<circle cx="${x(i)}" cy="${y(row[item.key])}" r="4" fill="${item.color}"><title>${row[valueKey]} ${escapeHTML(xLabel)}: ${row[item.key].toFixed(2)} ${escapeHTML(valueLabel)}</title></circle>`;});
  });
  return content+'</svg><div class="lab-chart-legend">'+series.map(item=>`<span><i style="background:${item.color}"></i>${item.label}</span>`).join('')+'</div>';
}

$$('[data-view]').forEach(button=>button.addEventListener('click',()=>setView(button.dataset.view,true)));
for(let n=1;n<=32;n++) $('#ports').add(new Option(`${n} port${n===1?'':'s'}`,n));
$('#ports').addEventListener('change',event=>action(null,async()=>{
  const ports = Number(event.target.value);
  try {await saveState(station.requests,{...station.settings,ports});}
  finally {$('#ports').value=station.settings.ports;}
}));
$('#optimize').addEventListener('click',()=>action($('#optimize'),optimize));
$('#open-generate').addEventListener('click',()=>openDialog('#generate-dialog'));
$('#open-settings').addEventListener('click',()=>{
  const form=$('#settings-form');
  form.elements.tariff.value=station.settings.tariff;
  form.elements.energy_cost.value=station.settings.energy_cost;
  openDialog('#settings-dialog');
});
document.addEventListener('click',event=>{
  const close=event.target.closest('[data-close]');
  if(close) close.closest('dialog').close();
  const edit=event.target.closest('[data-edit]');
  if(edit && !busy) editRequest(Number(edit.dataset.edit));
  const session=event.target.closest('[data-session]');
  if(session) showSession(Number(session.dataset.session));
  const history=event.target.closest('[data-run]');
  if(history) action(history,async()=>{
    activeRun=await api(`/api/runs/${history.dataset.run}`);
    shownMethod=activeRun.selected.algorithm;
    renderResults();renderRequestTable();setView('overview',true);
  });
});
document.addEventListener('keydown',event=>{
  const session=event.target.closest?.('[data-session]');
  if(session && ['Enter',' '].includes(event.key)) {event.preventDefault();showSession(Number(session.dataset.session));}
});
$$('dialog').forEach(dialog=>dialog.addEventListener('click',event=>{
  if(event.target===dialog) {const rect=dialog.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom) dialog.close();}
}));
$('#generate-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  action(form.querySelector('[type=submit]'),async()=>{
    const values=Object.fromEntries(new FormData(form));
    const next=await api('/api/generate',{method:'POST',body:JSON.stringify({revision:station.revision,settings:station.settings,count:Number(values.count),seed:Number(values.seed),max_surge:Number(values.max_surge)})});
    invalidate(next,'A fresh charging day is ready.');$('#generate-dialog').close();
  });
});
$('#settings-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  action(form.querySelector('[type=submit]'),async()=>{
    await saveState(station.requests,{...station.settings,tariff:Number(form.elements.tariff.value),energy_cost:Number(form.elements.energy_cost.value)});
    $('#settings-dialog').close();
  });
});
$('#add-request').addEventListener('click',()=>editRequest());
$('#request-form').addEventListener('input',requestPreview);
$('#request-form').addEventListener('submit',event=>{
  event.preventDefault();const form=event.currentTarget;
  action(form.querySelector('[type=submit]'),async()=>{
    const [hour,minute]=form.elements.start.value.split(':').map(Number);
    const request={request_id:Number(form.elements.request_id.value),arrival_min:hour*60+minute,duration_min:Number(form.elements.duration_min.value),energy_kwh:Number(form.elements.energy_kwh.value),surge_mult:Number(form.elements.surge_mult.value)};
    if(request.arrival_min+request.duration_min>1440) throw new Error('The session must finish by midnight.');
    const requests=station.requests.filter(row=>row.request_id!==request.request_id);
    requests.push(request);await saveState(requests);$('#request-dialog').close();
  });
});
$('#delete-request').addEventListener('click',()=>action($('#delete-request'),async()=>{
  const id=Number($('#request-form').elements.request_id.value);
  await saveState(station.requests.filter(row=>row.request_id!==id));$('#request-dialog').close();
}));
$('#request-search').addEventListener('input',()=>{page=0;renderRequestTable();});
$('#request-filter').addEventListener('change',()=>{page=0;renderRequestTable();});
$('#prev-page').addEventListener('click',()=>{page--;renderRequestTable();});
$('#next-page').addEventListener('click',()=>{page++;renderRequestTable();});
$('#import-button').addEventListener('click',()=>$('#csv-file').click());
$('#csv-file').addEventListener('change',event=>{
  const file=event.target.files[0];if(!file) return;
  action($('#import-button'),async()=>{
    if(file.size>1000000) throw new Error('CSV must be smaller than 1 MB.');
    const next=await api(`/api/import?revision=${station.revision}`,{method:'POST',headers:{'Content-Type':'text/csv'},body:await file.text()});
    invalidate(next,'CSV imported. Profit has been recalculated from station prices.');
  }).finally(()=>{event.target.value='';});
});
$('#schedule-method').addEventListener('change',event=>{shownMethod=event.target.value;renderResults();renderRequestTable();});
$('#export-schedule').addEventListener('click',()=>{
  if(!activeRun) return;
  const result=selectedResult();
  const selected=new Map(result.schedule.map(row=>[row.request_id,row.port]));
  const fields=['request_id','arrival_min','duration_min','deadline_min','energy_kwh','surge_mult','profit_inr','status','port'];
  const rows=activeRun.requests.map(row=>({...row,status:selected.has(row.request_id)?'accepted':'rejected',port:selected.get(row.request_id)||''}));
  const csv=[fields.join(','),...rows.map(row=>fields.map(field=>row[field]).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  const link=document.createElement('a');link.href=url;link.download=`volt-${result.algorithm}-schedule.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$$('[data-lab]').forEach(button=>button.addEventListener('click',()=>{
  $$('[data-lab]').forEach(item=>{item.classList.toggle('active',item===button);item.setAttribute('aria-selected',String(item===button));});
  ['trace','verify','sensitivity','benchmark'].forEach(key=>$(`#lab-${key}`).classList.toggle('hidden',key!==button.dataset.lab));
}));
$('#worked-example').addEventListener('click',()=>action($('#worked-example'),async()=>{
  const next=await api('/api/example',{method:'POST',body:JSON.stringify({revision:station.revision})});
  invalidate(next);$('#algorithm').value='dp';await optimize();$('[data-lab="trace"]').click();
}));
$('#verify-button').addEventListener('click',()=>action($('#verify-button'),async()=>{
  const result=await api('/api/lab/verify',{method:'POST'});
  $('#verify-result').innerHTML=`<div class="verification-success"><span>✓</span><div><h3>${result.passed} checks. All passed.</h3><p>Every exact answer agreed with an independent method.</p></div></div><div class="verify-checks"><span>✓ ${result.checks.search} branch-and-bound checks</span><span>✓ ${result.checks.subsets} subset checks</span><span>✓ ${result.checks.dp_vs_flow} DP / flow checks</span></div><p class="footnote">These checks verify algorithm agreement on seeded cases; they are not a proof. The correctness arguments are in ALGORITHMS.md.</p>`;
}));
$('#sensitivity-button').addEventListener('click',()=>action($('#sensitivity-button'),async()=>{
  const rows=await api('/api/lab/sensitivity',{method:'POST'});labRevision=station.revision;
  $('#sensitivity-result').innerHTML=chart(rows,[{key:'optimal',label:'Optimal',color:'#557bc9'},{key:'fcfs',label:'FCFS',color:'#c9ab62'}],'ports','ports','profit / ₹')+`<table class="data-table"><thead><tr><th>Ports</th><th>Optimal / ₹</th><th>FCFS / ₹</th><th>Extra optimal profit / ₹</th></tr></thead><tbody>${rows.map((row,i)=>`<tr><td>${row.ports}</td><td>${money(row.optimal)}</td><td>${money(row.fcfs)}</td><td>${i?money(row.optimal-rows[i-1].optimal):'—'}</td></tr>`).join('')}</tbody></table><p class="footnote">Station revision ${labRevision}. Same fixed slots and prices; one day, not a statistical average.</p>`;
}));
$('#benchmark-button').addEventListener('click',()=>action($('#benchmark-button'),async()=>{
  const rows=await api('/api/lab/benchmark',{method:'POST'});
  $('#benchmark-result').innerHTML=chart(rows,[{key:'dp',label:'DP · 1 port',color:'#557bc9'},{key:'flow',label:'Flow · 4 ports',color:'#8d87bc'},{key:'fcfs',label:'FCFS · 4 ports',color:'#c9ab62'}],'n','requests','runtime / ms')+`<table class="data-table"><thead><tr><th>Requests</th><th>DP / ms</th><th>Flow / ms</th><th>FCFS / ms</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${integer(row.n)}</td><td>${row.dp.toFixed(3)}</td><td>${row.flow.toFixed(3)}</td><td>${row.fcfs.toFixed(3)}</td></tr>`).join('')}</tbody></table><p class="footnote">Best of three solver-only wall-clock measurements. Graph construction and traceback are included; port assignment, HTTP and rendering are excluded. Input seeds = 90000 + n.</p>`;
}));
$('#refresh-history').addEventListener('click',()=>action($('#refresh-history'),loadHistory));

async function initialize() {
  try {
    station=await api('/api/state');
    const runs=await api('/api/runs');
    const latest=runs.find(run=>run.revision===station.revision);
    if(latest) {activeRun=await api(`/api/runs/${latest.id}`);shownMethod=activeRun.selected.algorithm;}
    renderStation();
    const view=window.location.hash.slice(1);
    setView(['overview','requests','lab','history'].includes(view)?view:'overview');
    if(!activeRun) await action($('#optimize'),optimize);
  } catch(error) {$('#connection-state').textContent='Connection lost';notify(`Could not load Volt. ${error.message}`,true);}
}
initialize();
