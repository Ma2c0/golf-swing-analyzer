/**
 * UI module — rendering helpers for analysis results.
 */
const UIModule = (() => {

  function setProgress(pct, text) {
    const fill = document.getElementById('progress-fill');
    const status = document.getElementById('analysis-status');
    if (fill) fill.style.width = pct + '%';
    if (status && text) status.textContent = text;
  }

  /** Golfer silhouette SVG for a swing phase */
  function phaseFigureSVG(phase, color) {
    const c = color || '#3F5F45';
    const svgs = {
      setup: `<svg viewBox="0 0 36 52" fill="none"><circle cx="18" cy="6" r="4.5" fill="${c}"/><line x1="18" y1="10" x2="18" y2="30" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="30" x2="12" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="30" x2="24" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="16" x2="10" y2="24" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="16" x2="26" y2="24" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/></svg>`,
      backswing: `<svg viewBox="0 0 36 52" fill="none"><circle cx="18" cy="6" r="4.5" fill="${c}"/><line x1="18" y1="10" x2="18" y2="30" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="30" x2="13" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="18" y1="30" x2="23" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><path d="M18 16 L24 12 L28 4" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="18" y1="16" x2="12" y2="22" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/></svg>`,
      downswing: `<svg viewBox="0 0 36 52" fill="none"><circle cx="18" cy="6" r="4.5" fill="${c}"/><path d="M18 10 L17 30" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="17" y1="30" x2="12" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="17" y1="30" x2="23" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><path d="M18 16 L24 10 L30 8" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 16 L10 28" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/></svg>`,
      impact: `<svg viewBox="0 0 36 52" fill="none"><circle cx="18" cy="6" r="4.5" fill="${c}"/><path d="M18 10 L16 30" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="16" y1="30" x2="10" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="16" y1="30" x2="22" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><path d="M18 16 L12 26 L8 32" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 16 L24 22" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/></svg>`,
      followThrough: `<svg viewBox="0 0 36 52" fill="none"><circle cx="18" cy="6" r="4.5" fill="${c}"/><path d="M18 10 L20 30" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="20" y1="30" x2="14" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><line x1="20" y1="30" x2="26" y2="46" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/><path d="M18 16 L10 6 L6 2" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 16 L26 20" stroke="${c}" stroke-width="2.5" stroke-linecap="round"/></svg>`
    };
    return svgs[phase] || svgs.setup;
  }

  /** Heartbeat-style icon SVG */
  function heartbeatSVG(color) {
    return `<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M2 10h4l2-4 3 8 2-4h5" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function scoreColor(score) {
    if (score >= 75) return '#3F5F45';
    if (score >= 55) return '#E5A400';
    return '#D56F55';
  }

  /**
   * Render full analysis results into the Analysis tab.
   * Called from app.js after analysis completes or when viewing from journal.
   */
  function renderAnalysis(result) {
    if (!result || result.error) return;

    const content = document.getElementById('analysis-content');
    const empty = document.getElementById('analysis-empty');
    empty.classList.add('hidden');
    content.classList.remove('hidden');

    // Default to Swing tab
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.cat-tab[data-cat="swing"]').classList.add('active');
    document.getElementById('panel-swing').classList.remove('hidden');
    document.getElementById('panel-body').classList.add('hidden');
    document.getElementById('panel-club').classList.add('hidden');

    renderSwingPanel(result);
    renderBodyPanel(result);
    renderClubPanel(result);
  }

  function renderSwingPanel(result) {
    const phases = result.phases || {};
    const phaseOrder = ['backswing', 'downswing', 'impact'];
    const phaseLabels = { backswing: 'Backswing', downswing: 'Downswing', impact: 'Impact' };

    // Phase cards
    const container = document.getElementById('phase-cards');
    container.innerHTML = '';

    // Find worst phase for default selection
    let worstKey = phaseOrder[0];
    let worstScore = 999;
    phaseOrder.forEach(k => {
      const s = phases[k]?.score ?? 100;
      if (s < worstScore) { worstScore = s; worstKey = k; }
    });

    phaseOrder.forEach(key => {
      const data = phases[key];
      if (!data) return;
      const color = scoreColor(data.score);
      const isGood = data.score >= 75;
      const card = document.createElement('div');
      card.className = 'p-card' + (key === worstKey ? ' selected' + (isGood ? ' good' : '') : '');
      card.dataset.phase = key;
      card.innerHTML = `
        <div class="p-card-figure">${phaseFigureSVG(key, color)}</div>
        <span class="p-card-name">${phaseLabels[key]}</span>
        <span class="p-card-score" style="color:${color}">${data.score}</span>
      `;
      container.appendChild(card);
    });

    // Show detail for worst phase
    showPhaseDetail(worstKey, phases);

    // Issues
    const issuesList = document.getElementById('issues-list');
    issuesList.innerHTML = '';
    const issues = result.issues || [];
    if (issues.length === 0) {
      issuesList.innerHTML = '<li>No major issues detected. Nice swing!</li>';
    } else {
      issues.forEach(txt => {
        const li = document.createElement('li');
        li.textContent = txt;
        issuesList.appendChild(li);
      });
    }

    // Improvements
    const improvList = document.getElementById('improvements-list');
    improvList.innerHTML = '';
    (result.improvements || []).forEach(txt => {
      const li = document.createElement('li');
      li.textContent = txt;
      improvList.appendChild(li);
    });
  }

  function showPhaseDetail(phaseKey, phases) {
    const data = phases[phaseKey];
    if (!data) return;

    const labels = { setup: 'Setup', backswing: 'Backswing', downswing: 'Downswing', impact: 'Impact', followThrough: 'Follow-through' };
    const color = scoreColor(data.score);
    const note = (data.notes && data.notes.length > 0) ? data.notes[0] : 'Looking good. No issues detected.';

    const el = document.getElementById('phase-detail');
    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="phase-detail-icon" style="background:${color}15">${heartbeatSVG(color)}</div>
      <div class="phase-detail-body">
        <div class="phase-detail-title" style="color:${color}">${labels[phaseKey]} ${data.score}</div>
        <div class="phase-detail-text">${note}</div>
      </div>
      <span class="phase-detail-arrow">&rsaquo;</span>
    `;

    // Update card selection
    document.querySelectorAll('.p-card').forEach(c => {
      const isThis = c.dataset.phase === phaseKey;
      c.classList.toggle('selected', isThis);
      if (isThis && data.score >= 75) c.classList.add('good');
      else c.classList.remove('good');
    });
  }

  function renderBodyPanel(result) {
    const container = document.getElementById('body-metrics');
    container.innerHTML = '';

    const phases = result.phases || {};
    const metrics = [
      { label: 'Posture', key: 'setup', aspect: 'Spine angle and stance', max: 100 },
      { label: 'Rotation', key: 'backswing', aspect: 'Shoulder turn and X-factor', max: 100 },
      { label: 'Sequence', key: 'downswing', aspect: 'Hip lead and weight shift', max: 100 },
      { label: 'Stability', key: 'impact', aspect: 'Head and spine at impact', max: 100 },
      { label: 'Balance', key: 'followThrough', aspect: 'Finish position and weight transfer', max: 100 },
    ];

    metrics.forEach(m => {
      const score = phases[m.key]?.score ?? 0;
      const color = scoreColor(score);
      const notes = phases[m.key]?.notes || [];
      const card = document.createElement('div');
      card.className = 'body-metric-card';
      let noteHtml = '';
      if (notes.length > 0) {
        noteHtml = `<p style="font-size:.72rem;color:#5A5A52;margin-top:.3rem;line-height:1.4">${notes[0]}</p>`;
      }
      card.innerHTML = `
        <h4>${m.label}</h4>
        <div class="metric-row">
          <span class="metric-label">${m.aspect}</span>
          <div class="metric-bar-bg"><div class="metric-bar-fill" style="width:${score}%;background:${color}"></div></div>
          <span class="metric-val" style="color:${color}">${score}</span>
        </div>
        ${noteHtml}
      `;
      container.appendChild(card);
    });
  }

  function renderClubPanel(result) {
    if (result.impact) {
      drawImpactDiagram(result.impact);
      const desc = document.getElementById('impact-description');
      desc.textContent = `${result.impact.tendency}: ${result.impact.description}`;
    }
  }

  function drawImpactDiagram(impact) {
    const canvas = document.getElementById('impact-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const fX = w * .2, fY = h * .15, fW = w * .6, fH = h * .5;

    ctx.fillStyle = '#3F5F45';
    ctx.strokeStyle = 'rgba(23,23,23,.2)';
    ctx.lineWidth = 2;
    roundRect(ctx, fX, fY, fW, fH, 15);

    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(fX + fW*(i/3), fY); ctx.lineTo(fX + fW*(i/3), fY+fH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(fX, fY + fH*(i/3)); ctx.lineTo(fX+fW, fY + fH*(i/3)); ctx.stroke();
    }
    const cx = fX + fW/2, cy = fY + fH/2;
    ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI*2); ctx.stroke();

    const ix = cx + (impact.x * fW * .4);
    const iy = cy - (impact.y * fH * .4);
    const glow = ctx.createRadialGradient(ix, iy, 0, ix, iy, 20);
    glow.addColorStop(0, 'rgba(213,111,85,.6)'); glow.addColorStop(1, 'rgba(213,111,85,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ix, iy, 20, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#D56F55'; ctx.beginPath(); ctx.arc(ix, iy, 7, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = 'rgba(23,23,23,.35)'; ctx.font = '11px Inter, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('TOE', fX+15, fY+fH+22);
    ctx.fillText('HEEL', fX+fW-15, fY+fH+22);
    ctx.fillText('Club Face', cx, h-12);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r); ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h); ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r); ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }

  return { setProgress, renderAnalysis, showPhaseDetail, scoreColor, phaseFigureSVG };
})();
