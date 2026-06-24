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
    if (score >= 90) return '#3F5F45';
    if (score >= 70) return '#E5A400';
    return '#D56F55';
  }

  function scoreTier(score) {
    if (score >= 90) return 'good';
    if (score >= 70) return 'mid';
    return 'bad';
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
    const swingTab = document.querySelector('.cat-tab[data-cat="swing"]');
    if (swingTab) swingTab.classList.add('active');
    document.getElementById('panel-swing').classList.remove('hidden');
    const panelClub = document.getElementById('panel-club');
    if (panelClub) panelClub.classList.add('hidden');

    setupAnalysisVideo(result);
    renderSwingPanel(result);
    renderClubPanel(result);
  }

  /**
   * Set up the Analysis video card. Plays whatever swing video is associated
   * with the result (if any); otherwise just shows the placeholder gradient.
   * Center play button hides on play and returns when the video ends.
   */
  function setupAnalysisVideo(result) {
    const video = document.getElementById('a-video');
    const playBtn = document.getElementById('a-play-btn');
    const dur = document.getElementById('a-video-duration');
    if (!video || !playBtn) return;

    // Hook video source if available
    const src = result.videoUrl || window.__lastSwingVideoUrl || null;
    if (src && video.src !== src) {
      video.src = src;
      video.load();
    }

    const fmt = (s) => {
      if (!isFinite(s)) return '0:00';
      const m = Math.floor(s / 60);
      const r = Math.floor(s % 60);
      return m + ':' + String(r).padStart(2, '0');
    };
    const refreshDur = () => {
      if (dur && video.duration) {
        dur.textContent = fmt(video.currentTime) + ' / ' + fmt(video.duration);
      }
    };
    video.addEventListener('loadedmetadata', refreshDur);
    video.addEventListener('timeupdate', refreshDur);

    // Reset state
    playBtn.classList.remove('hidden');
    video.pause();

    // Remove any previous handlers via cloning
    const fresh = playBtn.cloneNode(true);
    playBtn.parentNode.replaceChild(fresh, playBtn);
    fresh.addEventListener('click', () => {
      if (!video.src) {
        // No video to play — just briefly hide the button as a demo cue
        fresh.classList.add('hidden');
        setTimeout(() => fresh.classList.remove('hidden'), 1800);
        return;
      }
      fresh.classList.add('hidden');
      video.currentTime = 0;
      video.play().catch(() => fresh.classList.remove('hidden'));
    });
    video.onended = () => fresh.classList.remove('hidden');
    video.onpause = () => {
      if (!video.ended && video.currentTime > 0 && video.currentTime < video.duration) {
        // user-initiated pause via controls (rare) — leave button hidden if mid-play
      }
    };
  }

  function renderSwingPanel(result) {
    const phases = result.phases || {};
    // 5 real phases + 1 full-swing playback card
    const phaseOrder = ['setup', 'backswing', 'downswing', 'impact', 'followThrough'];
    const phaseLabels = {
      setup: 'Setup',
      backswing: 'Backswing',
      downswing: 'Downswing',
      impact: 'Impact',
      followThrough: 'Finish'
    };
    const phaseImgs = {
      setup: 'assets/phases/Setup.png',
      backswing: 'assets/phases/Backswing.png',
      downswing: 'assets/phases/Downswing.png',
      impact: 'assets/phases/Impact.png',
      followThrough: 'assets/phases/Finish.png'
    };

    // Stash on result for later access in showPhaseDetail
    result._phaseLabels = phaseLabels;

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
      const tier = scoreTier(data.score);
      const card = document.createElement('div');
      card.className = 'p-card' + (key === worstKey ? ' selected' : '');
      card.dataset.phase = key;
      card.innerHTML = `
        <div class="p-card-figure"><img src="${phaseImgs[key]}" alt="${phaseLabels[key]}"></div>
        <span class="p-card-name">${phaseLabels[key]}</span>
        <span class="p-card-score tier-${tier}">${data.score}</span>
      `;
      container.appendChild(card);
    });

    // Full Swing playback card
    const fullCard = document.createElement('div');
    fullCard.className = 'p-card';
    fullCard.dataset.phase = 'fullSwing';
    fullCard.innerHTML = `
      <div class="p-card-figure">
        <svg class="full-play" viewBox="0 0 56 56" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="28" cy="28" r="22"/>
          <path d="M23 19 L23 37 L38 28 Z" fill="currentColor" stroke="none"/>
        </svg>
      </div>
      <span class="p-card-name">Full Swing</span>
      <span class="p-card-playlabel">play</span>
    `;
    container.appendChild(fullCard);

    // Stash phases reference for click handler
    result._phases = phases;
    window.__lastAnalysisResult = result;

    // Show detail for worst phase
    showPhaseDetail(worstKey, phases, result);

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

  /** Praise messages per phase when there are no issues. */
  const PRAISE = {
    setup: { title: 'Setup is dialed in', body: "Stance, posture, and ball position all look great. Keep doing what you're doing." },
    backswing: { title: 'Smooth backswing', body: "Shoulder turn and arm path look solid. Repeat this feel." },
    downswing: { title: 'Great downswing', body: "Hips lead, weight shifts on time. This is the move \u2014 lock it in." },
    impact: { title: 'Clean impact', body: "Hands ahead, body open, weight forward. Textbook strike." },
    followThrough: { title: 'Beautiful finish', body: "Balanced, rotated through, hands high. Hold this pose every time." }
  };

  function showPhaseDetail(phaseKey, phases, result) {
    const labels = { setup: 'Setup', backswing: 'Backswing', downswing: 'Downswing', impact: 'Impact', followThrough: 'Finish', fullSwing: 'Full Swing' };
    const el = document.getElementById('phase-detail');
    const cardIssues = document.getElementById('card-issues');
    const cardImprove = document.getElementById('card-improve');
    const cardPraise = document.getElementById('card-praise');
    const cardFull = document.getElementById('card-fullswing');
    const phaseTag = document.getElementById('a-video-phase-tag');

    // Update card selection visuals
    document.querySelectorAll('.p-card').forEach(c => {
      c.classList.toggle('selected', c.dataset.phase === phaseKey);
    });
    if (phaseTag) phaseTag.textContent = labels[phaseKey] || '';

    // ---- FULL SWING ----
    if (phaseKey === 'fullSwing') {
      el.classList.add('hidden');
      if (cardIssues) cardIssues.classList.add('hidden');
      if (cardImprove) cardImprove.classList.add('hidden');
      if (cardPraise) cardPraise.classList.add('hidden');
      if (cardFull) cardFull.classList.remove('hidden');
      return;
    }

    const data = phases[phaseKey];
    if (!data) return;

    const tier = scoreTier(data.score);
    const note = (data.notes && data.notes.length > 0)
      ? data.notes[0]
      : 'Looking good. No issues detected for this phase.';

    el.classList.remove('hidden');
    el.innerHTML = `
      <div class="phase-detail-body">
        <div class="phase-detail-title">${labels[phaseKey]}</div>
        <div class="phase-detail-text">${note}</div>
      </div>
      <span class="phase-detail-pill tier-${tier}">${data.score}</span>
    `;

    if (cardFull) cardFull.classList.add('hidden');

    const hasIssues = data.notes && data.notes.length > 0;
    if (hasIssues) {
      // Show Issues & Improvements scoped to this phase
      const issuesList = document.getElementById('issues-list');
      const improvList = document.getElementById('improvements-list');
      issuesList.innerHTML = '';
      data.notes.forEach(txt => {
        const li = document.createElement('li');
        li.textContent = txt;
        issuesList.appendChild(li);
      });
      // Use the global improvements list as suggestions until
      // per-phase suggestions are wired in
      improvList.innerHTML = '';
      const improves = (result && result.improvements) ? result.improvements : [];
      improves.slice(0, 3).forEach(txt => {
        const li = document.createElement('li');
        li.textContent = txt;
        improvList.appendChild(li);
      });
      if (cardIssues) cardIssues.classList.remove('hidden');
      if (cardImprove) cardImprove.classList.remove('hidden');
      if (cardPraise) cardPraise.classList.add('hidden');
    } else {
      // Praise state
      if (cardIssues) cardIssues.classList.add('hidden');
      if (cardImprove) cardImprove.classList.add('hidden');
      if (cardPraise) {
        const praise = PRAISE[phaseKey] || { title: 'Nothing to fix here', body: "Looks great. Keep doing what you're doing." };
        const t = document.getElementById('praise-title');
        const b = document.getElementById('praise-body');
        if (t) t.textContent = praise.title;
        if (b) b.textContent = praise.body;
        cardPraise.classList.remove('hidden');
      }
    }
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

  return { setProgress, renderAnalysis, showPhaseDetail, scoreColor, scoreTier, phaseFigureSVG };
})();
