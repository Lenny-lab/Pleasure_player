// main.js - Electron 主进程
const { app, BrowserWindow, ipcMain, protocol, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const chokidar = require('chokidar');
const mm = require('music-metadata');

// ====== 配置 ======
// ====== 配置 ======
// 不预填任何默认路径。首次启动 = 空状态，等用户主动拖入或选择目录。
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json');

let MUSIC_DIR = null;        // null = 尚未锁定任何目录
let mainWindow = null;
let watcher = null;
let tracks = []; // 当前内存里的曲目列表

// 注册自定义协议（必须在 app.whenReady 前）
protocol.registerSchemesAsPrivileged([
  { scheme: 'music', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }
]);

// ====== 配置管理 ======
function loadConfig() {
  try {
    if (fsSync.existsSync(CONFIG_PATH)) {
      const data = JSON.parse(fsSync.readFileSync(CONFIG_PATH, 'utf-8'));
      if (data.musicDir && fsSync.existsSync(data.musicDir)) {
        MUSIC_DIR = data.musicDir;
      }
    }
  } catch (e) {
    console.error('loadConfig failed', e);
  }
}

function saveConfig() {
  try {
    fsSync.writeFileSync(CONFIG_PATH, JSON.stringify({ musicDir: MUSIC_DIR }, null, 2));
  } catch (e) {
    console.error('saveConfig failed', e);
  }
}

// ====== LRC 解析 ======
function parseLRC(text) {
  const lines = text.split(/\r?\n/);
  const result = [];
  const timeRegex = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const metaRegex = /\[(ti|ar|al|by|offset):(.*)\]/i;
  const meta = {};

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(metaRegex);
    if (m) {
      meta[m[1].toLowerCase()] = m[2].trim();
      continue;
    }
    const matches = [...line.matchAll(timeRegex)];
    if (matches.length === 0) continue;
    const text = line.replace(timeRegex, '').trim();
    for (const tm of matches) {
      const min = parseInt(tm[1], 10);
      const sec = parseInt(tm[2], 10);
      const ms = tm[3] ? parseInt(tm[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      result.push({ time: min * 60 + sec + ms / 1000, text });
    }
  }
  result.sort((a, b) => a.time - b.time);
  return { lines: result, meta };
}

// ====== 解析单个音频文件 ======
async function parseTrack(filePath) {
  try {
    const stat = await fs.stat(filePath);
    const meta = await mm.parseFile(filePath, { duration: true });
    const baseName = path.basename(filePath, path.extname(filePath));

    // 找同名 .lrc
    let lyrics = [];
    const lrcPath = filePath.replace(/\.[^.]+$/, '.lrc');
    try {
      const lrcText = await fs.readFile(lrcPath, 'utf-8');
      lyrics = parseLRC(lrcText).lines;
    } catch (_) { /* 没歌词也行 */ }

    // 内嵌封面
    let cover = null;
    if (meta.common.picture && meta.common.picture.length > 0) {
      const pic = meta.common.picture[0];
      cover = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`;
    }

    return {
      id: filePath,
      path: filePath,
      title: meta.common.title || baseName,
      artist: meta.common.artist || '未知艺术家',
      album: meta.common.album || '未知专辑',
      duration: Math.round(meta.format.duration || 0),
      trackNo: meta.common.track.no || null,
      cover,
      lyrics,
      size: stat.size,
      mtime: stat.mtimeMs,
    };
  } catch (e) {
    console.error('parseTrack failed', filePath, e);
    return null;
  }
}

// ====== 扫描目录 ======
async function scanDirectory(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  console.log(`[scan] readdir ${dir} returned ${entries.length} entries`);
  const audioFiles = entries
    .filter(e => e.isFile() && /\.(flac|mp3|m4a|aac|ogg|wav)$/i.test(e.name))
    .map(e => path.join(dir, e.name));
  console.log(`[scan] ${audioFiles.length} audio files matched`);
  const results = await Promise.all(audioFiles.map(parseTrack));
  const ok = results.filter(Boolean);
  console.log(`[scan] ${ok.length} tracks parsed successfully`);
  return ok.sort((a, b) => {
    if (a.trackNo && b.trackNo) return a.trackNo - b.trackNo;
    return a.title.localeCompare(b.title, 'zh');
  });
}

// ====== 启动监听 ======
function startWatcher(dir) {
  if (watcher) watcher.close();
  // macOS 打包后 fsevents 经常因 process.cwd() 不可写而拒绝初始化，
  // 直接走 polling 模式更稳。1s 间隔对"拖入新歌立即出现"足够好。
  const isPackaged = app.isPackaged;
  watcher = chokidar.watch(dir, {
    persistent: true,
    ignoreInitial: true,
    depth: 0,
    usePolling: isPackaged,         // dev 走 fsevents（更快），打包后走 polling
    interval: 1000,
    binaryInterval: 2000,
    awaitWriteFinish: { stabilityThreshold: 800, pollInterval: 200 },
  });
  watcher.on('add', async (filePath) => {
    if (!/\.(flac|mp3|m4a|aac|ogg|wav)$/i.test(filePath)) return;
    const track = await parseTrack(filePath);
    if (!track) return;
    if (tracks.some(t => t.id === track.id)) return;
    tracks.push(track);
    tracks.sort((a, b) => (a.trackNo || 999) - (b.trackNo || 999));
    if (mainWindow) mainWindow.webContents.send('music:added', track);
  });
  watcher.on('unlink', (filePath) => {
    const idx = tracks.findIndex(t => t.id === filePath);
    if (idx >= 0) {
      const removed = tracks.splice(idx, 1)[0];
      if (mainWindow) mainWindow.webContents.send('music:removed', removed.id);
    }
  });
  watcher.on('error', (err) => console.error('[watcher]', err));
}

// ====== 协议：music:// 安全访问本地文件 ======
function registerProtocol() {
  const { net } = require('electron');
  protocol.handle('music', async (request) => {
    try {
      const url = new URL(request.url);
      // music://app/absolute/path → pathname = /absolute/path
      let decoded = decodeURIComponent(url.pathname);
      // 安全沙箱：必须以 MUSIC_DIR 开头
      if (!decoded.startsWith(MUSIC_DIR)) {
        return new Response('forbidden', { status: 403 });
      }
      // 用 file:// + 真实文件存在性校验
      const fs2 = require('fs');
      if (!fs2.existsSync(decoded)) {
        return new Response('not found: ' + decoded, { status: 404 });
      }
      return net.fetch('file://' + decoded);
    } catch (e) {
      return new Response(String(e && e.message || e), { status: 500 });
    }
  });
}

// ====== IPC 处理器 ======
function setupIpc() {
  ipcMain.handle('music:list', () => tracks);
  ipcMain.handle('music:getDir', () => MUSIC_DIR);
  ipcMain.handle('music:pickDir', async () => {
    const res = await dialog.showOpenDialog(mainWindow, {
      title: '选择音乐文件夹',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    return res.filePaths[0];
  });
  ipcMain.handle('music:setDir', async (_e, newDir) => {
    if (!fsSync.existsSync(newDir)) return { ok: false, error: '目录不存在' };
    MUSIC_DIR = newDir;
    saveConfig();
    tracks = [];
    if (mainWindow) mainWindow.webContents.send('music:cleared');
    tracks = await scanDirectory(MUSIC_DIR);
    startWatcher(MUSIC_DIR);
    if (mainWindow) mainWindow.webContents.send('music:reset', tracks);
    return { ok: true, dir: MUSIC_DIR, count: tracks.length };
  });
  ipcMain.handle('music:rescan', async () => {
    tracks = await scanDirectory(MUSIC_DIR);
    startWatcher(MUSIC_DIR);
    if (mainWindow) mainWindow.webContents.send('music:reset', tracks);
    return tracks.length;
  });
  ipcMain.handle('music:openDir', () => {
    shell.openPath(MUSIC_DIR);
  });
  ipcMain.handle('music:unlock', async () => {
    if (watcher) { watcher.close(); watcher = null; }
    MUSIC_DIR = null;
    tracks = [];
    // 清空 config.json 里的 musicDir 字段（保留文件）
    try {
      if (fsSync.existsSync(CONFIG_PATH)) {
        fsSync.writeFileSync(CONFIG_PATH, JSON.stringify({}, null, 2));
      }
    } catch (e) { /* ignore */ }
    if (mainWindow) mainWindow.webContents.send('music:empty');
    return { ok: true };
  });
  ipcMain.handle('music:addDroppedPath', async (_e, filePath) => {
    try {
      if (!filePath) return { ok: false, error: '空路径' };
      const stat = await fs.stat(filePath);
      let target = filePath;
      if (stat.isFile()) target = path.dirname(filePath); // 拖的是文件 → 取父目录
      if (!stat.isDirectory()) return { ok: false, error: '不是文件夹' };
      MUSIC_DIR = target;
      saveConfig();
      tracks = [];
      if (mainWindow) mainWindow.webContents.send('music:cleared');
      tracks = await scanDirectory(MUSIC_DIR);
      startWatcher(MUSIC_DIR);
      if (mainWindow) mainWindow.webContents.send('music:reset', tracks);
      return { ok: true, dir: MUSIC_DIR, count: tracks.length };
    } catch (e) {
      return { ok: false, error: String(e && e.message || e) };
    }
  });
}

// ====== 菜单 ======
function setupMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        {
          label: '切换音乐文件夹…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (!mainWindow) return;
            const res = await dialog.showOpenDialog(mainWindow, {
              title: '选择音乐文件夹',
              properties: ['openDirectory'],
            });
            if (!res.canceled && res.filePaths[0]) {
              mainWindow.webContents.send('music:requestSetDir', res.filePaths[0]);
            }
          },
        },
        {
          label: '在 Finder 中打开',
          click: () => shell.openPath(MUSIC_DIR),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: '视图',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ====== 窗口 ======
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    title: 'Pleasure',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // preload 只用 ipcRenderer + contextBridge，不需要 fs
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ====== 启动 ======
app.whenReady().then(async () => {
  // 打包后 process.cwd() 可能是 "/" 或某个 asar 虚拟路径，fsevents 等原生模块
  // 会因 cwd 不可写而拒绝初始化。改到 userData 目录。
  try { process.chdir(app.getPath('userData')); } catch (_) {}

  loadConfig();
  registerProtocol();
  setupIpc();
  setupMenu();
  createWindow();

  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', async () => {
      if (MUSIC_DIR) {
        tracks = await scanDirectory(MUSIC_DIR);
        startWatcher(MUSIC_DIR);
        console.log(`[main] Pleasure ready — ${tracks.length} tracks from ${MUSIC_DIR}`);
        mainWindow.webContents.send('music:reset', tracks);
        mainWindow.webContents.send('music:dir', MUSIC_DIR);
      } else {
        console.log(`[main] Pleasure ready — no folder locked. Drop a folder to begin.`);
        mainWindow.webContents.send('music:empty');
      }
    });
  }

  // DEV: 自动测播（命令行带 --autoplay）
  if (process.argv.includes('--autoplay')) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => mainWindow.webContents.send('dev:autoplay'), 800);
    });
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (watcher) watcher.close();
});
