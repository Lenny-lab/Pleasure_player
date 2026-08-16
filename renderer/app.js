// app.js - 渲染层主逻辑
'use strict';

const $ = (id) => document.getElementById(id);

const audio = $('audio');
const listEl = $('list');
const listEmpty = $('listEmpty');
const trackCountEl = $('trackCount');
const dirPathEl = $('dirPath');
const titleEl = $('title');
const metaTitle = $('metaTitle');
const metaArtist = $('metaArtist');
const artEl = $('art');
const progressBar = $('progressBar');
const progressFill = $('progressFill');
const progressThumb = $('progressThumb');
const curTimeEl = $('curTime');
const durTimeEl = $('durTime');
const btnPlay = $('btnPlay');
const btnPrev = $('btnPrev');
const btnNext = $('btnNext');
const btnShuffle = $('btnShuffle');
const btnMode = $('btnMode');
const btnLyrics = $('btnLyrics');
const btnUnlock = $('btnUnlock');
const btnOpenDir = $('btnOpenDir');
const btnPickDir = $('btnPickDir');
const volumeEl = $('volume');
const lyricsPage = $('lyricsPage');
const lyricsClose = $('lyricsClose');
const lyricsArt = $('lyricsArt');
const lyricsTitle = $('lyricsTitle');
const lyricsArtist = $('lyricsArtist');
const lyricsList = $('lyricsList');
const dropOverlay = $('dropOverlay');

// ====== 状态 ======
let tracks = [];          // 所有曲目
let currentIdx = -1;      // 当前播放索引
let isPlaying = false;
// 播放模式：'sequence' 顺序播完停止 | 'loop-one' 单曲循环
let playMode = 'sequence';
const PLAY_MODES = ['sequence', 'loop-one'];
// Emoji 风格
const MODE_ICONS = {
  'sequence': '🔁',         // 顺序：循环箭头（默认关闭态）
  'loop-one': '🔂',          // 单曲循环：循环箭头 + 1
};
const MODE_TITLES = {
  'sequence': '顺序播放',
  'loop-one': '单曲循环',
};

// ====== 工具 ======
function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function basename(p) {
  if (!p) return '';
  return p.split(/[\\/]/).pop();
}

// music:// 协议把本地路径转换成可访问 URL
function toMediaURL(filePath) {
  // 已经是 music:// 直接返回
  if (filePath.startsWith('music://')) return filePath;
  // music://app + 绝对路径，避免空 host 时 Chromium 把路径当 authority
  return 'music://app' + filePath;
}

function shuffleArray(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// (shuffleArray 保留备用，目前 2 态不调用)

// ====== 列表渲染 ======
function renderList() {
  listEl.innerHTML = '';
  if (tracks.length === 0) {
    listEmpty.style.display = 'block';
    listEl.appendChild(listEmpty);
    trackCountEl.textContent = '0';
    return;
  }
  listEmpty.style.display = 'none';
  trackCountEl.textContent = String(tracks.length).padStart(2, '0');

  const frag = document.createDocumentFragment();
  tracks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'track';
    row.dataset.idx = i;
    if (i === currentIdx) row.classList.add('active');

    const num = document.createElement('div');
    num.className = 'num';
    num.textContent = String(i + 1).padStart(2, '0');
    if (i === currentIdx && isPlaying) num.classList.add('playing');

    const cover = document.createElement('div');
    cover.className = 'cover';
    if (t.cover) cover.style.backgroundImage = `url(${t.cover})`;

    const info = document.createElement('div');
    info.className = 'info';
    const tn = document.createElement('div');
    tn.className = 't';
    tn.textContent = t.title;
    const an = document.createElement('div');
    an.className = 'a';
    an.textContent = t.artist;
    info.appendChild(tn);
    info.appendChild(an);

    const dur = document.createElement('div');
    dur.className = 'dur';
    dur.textContent = fmtTime(t.duration);

    row.appendChild(num);
    row.appendChild(cover);
    row.appendChild(info);
    row.appendChild(dur);

    row.addEventListener('click', () => playIndex(i));
    frag.appendChild(row);
  });
  listEl.appendChild(frag);
}

function updateListActive() {
  const rows = listEl.querySelectorAll('.track');
  rows.forEach((r, i) => {
    const num = r.querySelector('.num');
    r.classList.toggle('active', i === currentIdx);
    if (i === currentIdx && isPlaying) {
      num.classList.add('playing');
      num.textContent = '';
    } else {
      num.classList.remove('playing');
      num.textContent = String(i + 1).padStart(2, '0');
    }
  });
}

// ====== 播放 ======
function playIndex(i) {
  if (i < 0 || i >= tracks.length) return;
  currentIdx = i;
  const t = tracks[i];

  audio.src = toMediaURL(t.path);
  audio.volume = parseFloat(volumeEl.value);
  applyPlayMode();           // 切歌前同步 loop 状态
  audio.play().then(() => {
    isPlaying = true;
    btnPlay.textContent = '⏸';
    onTrackChange(t);
  }).catch((e) => {
    console.error('[play] failed:', e.name, e.message);
    isPlaying = false;
    btnPlay.textContent = '▶';
  });
}

function togglePlay() {
  if (currentIdx < 0 && tracks.length > 0) {
    playIndex(0);
    return;
  }
  if (currentIdx < 0) return;
  if (isPlaying) {
    audio.pause();
    isPlaying = false;
    btnPlay.textContent = '▶';
  } else {
    audio.play().catch(() => { /* src not ready or autoplay blocked */ });
    isPlaying = true;
    btnPlay.textContent = '⏸';
  }
  updateListActive();
}

function getNextIndex() {
  if (tracks.length === 0) return -1;
  return (currentIdx + 1) % tracks.length;
}

function getPrevIndex() {
  if (tracks.length === 0) return -1;
  return (currentIdx - 1 + tracks.length) % tracks.length;
}

function next() {
  // sequence 模式播完最后一首时停在末尾，不切歌
  if (playMode === 'sequence' && currentIdx === tracks.length - 1) return;
  const idx = getNextIndex();
  if (idx >= 0) playIndex(idx);
}

function prev() {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  // sequence 模式在第一首时点上一首，保持在第一首重置进度
  if (playMode === 'sequence' && currentIdx === 0) {
    audio.currentTime = 0;
    return;
  }
  const idx = getPrevIndex();
  if (idx >= 0) playIndex(idx);
}

// 单曲循环：直接用 HTMLAudioElement.loop 属性，浏览器原生处理，不需要 ended 事件
function applyPlayMode() {
  audio.loop = (playMode === 'loop-one');
}

function onTrackChange(t) {
  titleEl.textContent = `${t.title} · ${t.artist}`;
  metaTitle.textContent = t.title;
  metaArtist.textContent = `${t.artist} — ${t.album}`;
  if (t.cover) {
    artEl.style.backgroundImage = `url(${t.cover})`;
    artEl.querySelector('.art-placeholder').style.display = 'none';
    lyricsArt.style.backgroundImage = `url(${t.cover})`;
  } else {
    artEl.style.backgroundImage = '';
    artEl.querySelector('.art-placeholder').style.display = 'flex';
    lyricsArt.style.backgroundImage = '';
  }
  lyricsTitle.textContent = t.title;
  lyricsArtist.textContent = `${t.artist} — ${t.album}`;
  artEl.classList.add('playing');
  updateListActive();
  buildLyrics(t.lyrics || []);
}

// ====== 进度条 ======
function updateProgress() {
  const cur = audio.currentTime || 0;
  const dur = audio.duration || 0;
  const pct = dur > 0 ? (cur / dur) * 100 : 0;
  progressFill.style.width = pct + '%';
  progressThumb.style.left = pct + '%';
  curTimeEl.textContent = fmtTime(cur);
  if (dur > 0) durTimeEl.textContent = fmtTime(dur);
  updateLyricsActive(cur);
}

function seekFromEvent(e) {
  const rect = progressBar.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const pct = Math.max(0, Math.min(1, x / rect.width));
  if (audio.duration) audio.currentTime = audio.duration * pct;
}

// ====== 歌词 ======
function buildLyrics(lines) {
  lyricsList.innerHTML = '';
  if (!lines || lines.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lyrics-empty';
    empty.textContent = '这首没有歌词';
    lyricsList.appendChild(empty);
    return;
  }
  const frag = document.createDocumentFragment();
  lines.forEach((ln, i) => {
    const el = document.createElement('div');
    el.className = 'lyrics-line';
    el.textContent = ln.text || ' ';
    el.dataset.idx = i;
    el.dataset.time = ln.time;
    el.addEventListener('click', () => {
      if (audio.duration) audio.currentTime = ln.time;
    });
    frag.appendChild(el);
  });
  lyricsList.appendChild(frag);
}

let lastLyricIdx = -1;
function updateLyricsActive(cur) {
  if (lyricsPage.hidden) return; // 歌词页隐藏时不计算
  const lineEls = lyricsList.querySelectorAll('.lyrics-line');
  if (lineEls.length === 0) return;

  // 找到当前时间对应的歌词行（最后一个 time <= cur）
  let idx = -1;
  for (let i = 0; i < lineEls.length; i++) {
    const t = parseFloat(lineEls[i].dataset.time);
    if (t <= cur) idx = i;
    else break;
  }
  if (idx === lastLyricIdx) return;
  lastLyricIdx = idx;

  lineEls.forEach((el, i) => {
    el.classList.remove('active', 'upcoming');
    if (i === idx) el.classList.add('active');
    else if (i === idx + 1) el.classList.add('upcoming');
  });

  // 滚动到中间
  if (idx >= 0) {
    const el = lineEls[idx];
    const listH = lyricsList.clientHeight;
    const elTop = el.offsetTop;
    const target = elTop - listH / 2 + el.clientHeight / 2;
    lyricsList.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }
}

// ====== 事件绑定 ======
btnPlay.addEventListener('click', togglePlay);
btnNext.addEventListener('click', next);
btnPrev.addEventListener('click', prev);
// 合并模式按钮：sequence ↔ loop-one
btnMode.addEventListener('click', () => {
  const idx = PLAY_MODES.indexOf(playMode);
  playMode = PLAY_MODES[(idx + 1) % PLAY_MODES.length];
  btnMode.textContent = MODE_ICONS[playMode];
  btnMode.dataset.mode = playMode;
  btnMode.title = MODE_TITLES[playMode];
  btnMode.classList.toggle('active', playMode !== 'sequence');
  applyPlayMode();          // 立刻把 audio.loop 同步成新模式
});
btnLyrics.addEventListener('click', () => {
  if (currentIdx < 0) return;
  lyricsPage.hidden = false;
  lastLyricIdx = -1;
  updateLyricsActive(audio.currentTime || 0);
});
lyricsClose.addEventListener('click', () => { lyricsPage.hidden = true; });
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'ArrowRight') next();
  else if (e.key === 'ArrowLeft') prev();
  else if (e.key === 'Escape') lyricsPage.hidden = true;
});

btnOpenDir.addEventListener('click', () => window.musicAPI.openDir());
btnUnlock.addEventListener('click', async () => {
  if (tracks.length === 0 && !isPlaying) return; // 没锁定任何目录时禁用
  const ok = confirm('退出当前文件夹？\n列表将被清空。');
  if (!ok) return;
  await window.musicAPI.unlock();
});

volumeEl.addEventListener('input', () => {
  audio.volume = parseFloat(volumeEl.value);
});

progressBar.addEventListener('click', seekFromEvent);
let dragging = false;
progressBar.addEventListener('mousedown', (e) => { dragging = true; seekFromEvent(e); });
document.addEventListener('mousemove', (e) => { if (dragging) seekFromEvent(e); });
document.addEventListener('mouseup', () => { dragging = false; });

audio.addEventListener('timeupdate', updateProgress);
// 单曲循环由 audio.loop 接管（浏览器原生处理，不会触发 ended 事件）
// 所以这里只处理 sequence 模式：播完一首停下
audio.addEventListener('ended', () => {
  if (playMode === 'sequence') next();
});
audio.addEventListener('error', () => {
  const err = audio.error;
  console.error('[audio] error code=', err && err.code, 'message=', err && err.message);
});
audio.addEventListener('loadedmetadata', () => {
  durTimeEl.textContent = fmtTime(audio.duration);
  progressBar.classList.toggle('is-playing', !audio.paused);
});
audio.addEventListener('play', () => {
  isPlaying = true;
  btnPlay.textContent = '⏸';
  progressBar.classList.add('is-playing');
  artEl.classList.add('playing');
  applyPlayMode();        // 每次 play 时同步一次 loop 状态
  updateListActive();
});
audio.addEventListener('pause', () => {
  isPlaying = false;
  btnPlay.textContent = '▶';
  progressBar.classList.remove('is-playing');
  updateListActive();
});

// ====== IPC 初始化 ======
(async function init() {
  const dir = await window.musicAPI.getDir();
  dirPathEl.textContent = dir;
  document.title = `Pleasure — ${basename(dir)}`;

  window.musicAPI.onDir((d) => {
    dirPathEl.textContent = d;
    document.title = `Pleasure — ${basename(d)}`;
    // 锁定目录时显示 banner
    document.body.classList.add('has-dir');
  });
  window.musicAPI.onEmpty(() => {
    tracks = [];
    currentIdx = -1;
    isPlaying = false;
    try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (e) {}
    btnPlay.textContent = '▶';
    metaTitle.textContent = '未在播放';
    metaArtist.textContent = '拖入一个音乐文件夹开始';
    artEl.style.backgroundImage = '';
    artEl.querySelector('.art-placeholder').style.display = 'flex';
    titleEl.textContent = 'Pleasure';
    dirPathEl.textContent = '';
    document.title = 'Pleasure';
    // 隐藏 banner
    document.body.classList.remove('has-dir');
    renderList();
  });
  window.musicAPI.onReset((list) => {
    tracks = list;
    currentIdx = -1;
    isPlaying = false;
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch (e) { /* ignore */ }
    btnPlay.textContent = '▶';
    metaTitle.textContent = '未在播放';
    metaArtist.textContent = '选一首歌开始';
    artEl.style.backgroundImage = '';
    artEl.querySelector('.art-placeholder').style.display = 'flex';
    titleEl.textContent = 'Pleasure';
    renderList();
  });
  window.musicAPI.onAdded((t) => {
    if (tracks.some(x => x.id === t.id)) return;
    tracks.push(t);
    tracks.sort((a, b) => (a.trackNo || 999) - (b.trackNo || 999));
    renderList();
  });
  window.musicAPI.onRemoved((id) => {
    const idx = tracks.findIndex(x => x.id === id);
    if (idx < 0) return;
    const wasCurrent = idx === currentIdx;
    tracks.splice(idx, 1);
    if (idx < currentIdx) currentIdx--;
    else if (wasCurrent) {
      try {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      } catch (e) { /* ignore */ }
      currentIdx = -1;
      isPlaying = false;
      btnPlay.textContent = '▶';
    }
    renderList();
  });
  window.musicAPI.onCleared(() => {
    tracks = [];
    renderList();
  });
  window.musicAPI.onRequestSetDir((dir) => {
    // 从菜单触发的切换
    window.musicAPI.setDir(dir);
  });

  // 初始拉一次列表
  const initial = await window.musicAPI.list();
  if (initial && initial.length > 0) {
    tracks = initial;
    renderList();
  }

  // DEV: 启动后自动播第一首（--autoplay 标志触发）
  window.musicAPI.onAutoplay(() => {
    if (tracks.length > 0) playIndex(0);
  });

  // ====== 拖拽文件夹切换目录 ======
  let dragDepth = 0;
  const isFileDrag = (e) => {
    if (!e.dataTransfer || !e.dataTransfer.types) return false;
    return Array.from(e.dataTransfer.types).includes('Files');
  };

  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth++;
    dropOverlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.hidden = true;
  });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    if (!e.dataTransfer || !e.dataTransfer.files || e.dataTransfer.files.length === 0) return;
    const file = e.dataTransfer.files[0];
    const filePath = window.musicAPI.getPathForFile(file);
    if (!filePath) {
      alert('无法识别该文件路径，请用菜单或 ⇄ 按钮选择。');
      return;
    }
    const res = await window.musicAPI.addDroppedPath(filePath);
    if (!res.ok) {
      alert('切换失败：' + res.error);
    }
  });
})();
