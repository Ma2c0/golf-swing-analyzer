/**
 * UI module — result rendering.
 */
const UIModule = (() => {

  function showScreen() {
    // Navigation handled by app.js showTab()
  }

  function setProgress(pct, text) {
    const fill = document.getElementById('progress-fill');
    const status = document.getElementById('analysis-status');
    if (fill) fill.style.width = pct + '%';
    if (status && text) status.textContent = text;
  }

  function renderResults(result) {
    if (result.error) {
      alert(result.message || 'Analysis failed');
      return;
    }

    const scoreVal = document.getElementById('score-value');
    const scoreGrade = document.getElementById('score-grade');
    const scoreCircle = document.getElementById('score-circle');

    scoreVal.textContent = result.score;
    scoreGrade.textContent = result.grade;

    scoreCircle.className = 'score-circle';
    if (result.score >= 75) scoreCircle.classList.add('score-good');
    else if (result.score >= 60) scoreCircle.classList.add('score-ok');
    else if (result.score >= 45) scoreCircle.classList.add('score-poor');
    else scoreCircle.classList.add('score-bad');

    scoreGrade.style.color = getScoreColor(result.score);

    // Phase scores
    const phaseContainer = document.getElementById('phase-scores');
    phaseContainer.innerHTML = '';
    const phaseNames = {
      setup: 'Setup',
      backswing: 'Backswing',
      downswing: 'Downswing',
      impact: 'Impact',
      followThrough: 'Finish'
    };

    for (const [key, name] of Object.entries(phaseNames)) {
      const data = result.phases[key];
      if (!data) continue;
      const row = document.createElement('div');
      row.className = 'phase-row';
      row.innerHTML = `
        <span class="phase-name">${name}</span>
        <div class="phase-bar-bg">
          <div class="phase-bar-fill" style="width:${data.score}%;background:${getScoreColor(data.score)}"></div>
        </div>
        <span class="phase-score-val" style="color:${getScoreColor(data.score)}">${data.score}</span>
      `;
      phaseContainer.appendChild(row);
    }

    // Impact
    drawImpactDiagram(result.impact);
    const impactDesc = document.getElementById('impact-description');
    impactDesc.textContent = `${result.impact.tendency}: ${result.impact.description}`;

    // Issues
    const issuesList = document.getElementById('issues-list');
    issuesList.innerHTML = '';
    if (!result.issues || result.issues.length === 0) {
      issuesList.innerHTML = '<li>No major issues detected — nice swing!</li>';
    } else {
      result.issues.forEach(issue => {
        const li = document.createElement('li');
        li.textContent = issue;
        issuesList.appendChild(li);
      });
    }

    // Improvements
    const improvList = document.getElementById('improvements-list');
    improvList.innerHTML = '';
    (result.improvements || []).forEach(tip => {
      const li = document.createElement('li');
      li.textContent = tip;
      improvList.appendChild(li);
    });
  }

  function drawImpactDiagram(impact) {
    const canvas = document.getElementById('impact-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const faceX = w * 0.2, faceY = h * 0.15;
    const faceW = w * 0.6, faceH = h * 0.5;

    ctx.fillStyle = '#3F5F45';
    ctx.strokeStyle = 'rgba(23,23,23,0.2)';
    ctx.lineWidth = 2;
    roundRect(ctx, faceX, faceY, faceW, faceH, 15);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(faceX + faceW * (i/3), faceY); ctx.lineTo(faceX + faceW * (i/3), faceY + faceH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(faceX, faceY + faceH * (i/3)); ctx.lineTo(faceX + faceW, faceY + faceH * (i/3)); ctx.stroke();
    }

    const cx = faceX + faceW/2, cy = faceY + faceH/2;
    ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, 15, 0, Math.PI * 2); ctx.stroke();

    const ix = cx + (impact.x * faceW * 0.4);
    const iy = cy - (impact.y * faceH * 0.4);
    const glow = ctx.createRadialGradient(ix, iy, 0, ix, iy, 20);
    glow.addColorStop(0, 'rgba(213,111,85,0.6)');
    glow.addColorStop(1, 'rgba(213,111,85,0)');
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(ix, iy, 20, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#D56F55'; ctx.beginPath(); ctx.arc(ix, iy, 7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();

    ctx.fillStyle = 'rgba(23,23,23,0.35)';
    ctx.font = '11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('TOE', faceX + 15, faceY + faceH + 22);
    ctx.fillText('HEEL', faceX + faceW - 15, faceY + faceH + 22);
    ctx.fillText('Club Face', cx, h - 12);
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

  function getScoreColor(score) {
    if (score >= 75) return '#3F5F45';
    if (score >= 55) return '#E5A400';
    return '#D56F55';
  }

  return { showScreen, setProgress, renderResults };
})();
