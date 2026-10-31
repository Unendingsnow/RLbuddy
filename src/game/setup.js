"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

const STATS_INI_RELATIVE = path.join("TAGame", "Config", "DefaultStatsAPI.ini");
const STEAM_APP_ID = "252950";

/** A folder is a Rocket League install if it has the TAGame config tree. */
function looksLikeRocketLeague(dir) {
  if (!dir) return false;
  try {
    return fs.existsSync(path.join(dir, "TAGame", "Config"));
  } catch {
    return false;
  }
}

/** Epic writes one .item manifest per installed game. */
function findViaEpic() {
  const manifestDir = path.join(
    process.env.PROGRAMDATA || "C:\\ProgramData",
    "Epic",
    "EpicGamesLauncher",
    "Data",
    "Manifests",
  );

  let entries = [];
  try {
    entries = fs.readdirSync(manifestDir).filter((f) => f.endsWith(".item"));
  } catch {
    return null;
  }

  for (const entry of entries) {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(manifestDir, entry), "utf8"));
      const name = String(manifest.DisplayName || "");
      if (!/rocket\s*league/i.test(name)) continue;
      if (looksLikeRocketLeague(manifest.InstallLocation)) return manifest.InstallLocation;
    } catch {
      // A malformed manifest is not worth failing setup over.
    }
  }
  return null;
}

function steamRoot() {
  const keys = [
    "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam",
    "HKLM\\SOFTWARE\\Valve\\Steam",
    "HKCU\\SOFTWARE\\Valve\\Steam",
  ];

  for (const key of keys) {
    try {
      const out = execFileSync("reg", ["query", key, "/v", "InstallPath"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"], windowsHide: true,
      });
      const match = out.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (match) return match[1].trim();
    } catch {
      // Key absent - try the next one.
    }
  }
  return null;
}

/** Steam spreads games across library folders listed in libraryfolders.vdf. */
function steamLibraries(root) {
  const libs = [root];
  const vdf = path.join(root, "steamapps", "libraryfolders.vdf");

  try {
    const text = fs.readFileSync(vdf, "utf8");
    for (const m of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
      libs.push(m[1].replace(/\\\\/g, "\\"));
    }
  } catch {
    // Older Steam layouts only have the root library.
  }
  return libs;
}

function findViaSteam() {
  const root = steamRoot();
  if (!root) return null;

  for (const lib of steamLibraries(root)) {
    const candidate = path.join(lib, "steamapps", "common", "rocketleague");
    if (looksLikeRocketLeague(candidate)) return candidate;

    // Confirm ownership via the appmanifest when the folder name differs.
    const manifest = path.join(lib, "steamapps", `appmanifest_${STEAM_APP_ID}.acf`);
    try {
      const text = fs.readFileSync(manifest, "utf8");
      const dirMatch = text.match(/"installdir"\s+"([^"]+)"/i);
      if (dirMatch) {
        const dir = path.join(lib, "steamapps", "common", dirMatch[1]);
        if (looksLikeRocketLeague(dir)) return dir;
      }
    } catch {
      // Not installed in this library.
    }
  }
  return null;
}

function findViaCommonPaths() {
  const guesses = [
    "C:\\Program Files\\Epic Games\\rocketleague",
    "C:\\Program Files (x86)\\Epic Games\\rocketleague",
    "D:\\Epic Games\\rocketleague",
    "C:\\Program Files (x86)\\Steam\\steamapps\\common\\rocketleague",
    "D:\\SteamLibrary\\steamapps\\common\\rocketleague",
  ];
  return guesses.find(looksLikeRocketLeague) || null;
}

/** Best-effort Rocket League install directory, or null. */
function findRocketLeague() {
  if (process.platform !== "win32") return null;
  return findViaEpic() || findViaSteam() || findViaCommonPaths() || null;
}

const SECTION = "[TAGame.MatchStatsExporter_TA]";

/**
 * Documents can be redirected (OneDrive being the usual culprit), so ask the
 * shell for its real location rather than assuming %USERPROFILE%\Documents.
 */
function documentsDir() {
  try {
    const out = execFileSync(
      "reg",
      ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Folders", "/v", "Personal"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], windowsHide: true },
    );
    const m = out.match(/Personal\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/i);
    if (m) {
      const expanded = m[1].trim().replace(/%([^%]+)%/g, (_, v) => process.env[v] || "");
      if (expanded && fs.existsSync(expanded)) return expanded;
    }
  } catch {
    // Fall through to the conventional location.
  }
  return path.join(process.env.USERPROFILE || os.homedir(), "Documents");
}

/**
 * The file the game actually reads at runtime.
 *
 * Rocket League is an Unreal 3 game: DefaultStatsAPI.ini in the install is
 * only a template, copied once into Documents\My Games\... as TAStatsAPI.ini.
 * After a player's first launch the template is ignored entirely, so patching
 * only the install folder changes nothing - and silently, which is worse.
 *
 * Happily this path is under Documents, so it needs no admin rights.
 */
function userStatsIniPath() {
  return path.join(documentsDir(), "My Games", "Rocket League", "TAGame", "Config", "TAStatsAPI.ini");
}

/** Value of `key` inside the exporter section, or null. */
function readIniValue(text, key) {
  let inSection = false;
  for (const line of String(text).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      inSection = trimmed.toLowerCase() === SECTION.toLowerCase();
      continue;
    }
    if (!inSection || trimmed.startsWith(";")) continue;
    const m = trimmed.match(/^([A-Za-z_]+)\s*=\s*(.*)$/);
    if (m && m[1].toLowerCase() === key.toLowerCase()) return m[2].trim();
  }
  return null;
}

/**
 * Rewrite only the keys we care about, preserving comments, spacing and any
 * other settings. The shipped file also defines WebPort, and clobbering the
 * whole file would silently drop it.
 */
function patchIni(text, updates) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  const applied = new Set();

  let inSection = false;
  let sectionSeen = false;
  let sectionEnd = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("[")) {
      if (inSection) sectionEnd = out.length;
      inSection = trimmed.toLowerCase() === SECTION.toLowerCase();
      if (inSection) sectionSeen = true;
      out.push(line);
      continue;
    }

    if (inSection && !trimmed.startsWith(";")) {
      const m = trimmed.match(/^([A-Za-z_]+)\s*=/);
      if (m) {
        const key = Object.keys(updates).find((k) => k.toLowerCase() === m[1].toLowerCase());
        if (key) {
          out.push(`${key}=${updates[key]}`);
          applied.add(key);
          continue;
        }
      }
    }
    out.push(line);
  }

  if (inSection) sectionEnd = out.length;

  const missing = Object.keys(updates).filter((k) => !applied.has(k));

  if (!sectionSeen) {
    if (out.length && out[out.length - 1].trim() !== "") out.push("");
    out.push(SECTION, ...missing.map((k) => `${k}=${updates[k]}`), "");
  } else if (missing.length) {
    const at = sectionEnd >= 0 ? sectionEnd : out.length;
    const block = missing.map((k) => `${k}=${updates[k]}`);
    // Keep a blank line before whatever section follows.
    if (at < out.length && out[at].trim().startsWith("[")) block.push("");
    out.splice(at, 0, ...block);
  }

  return out.join("\r\n");
}

/**
 * Enable the Stats API in DefaultStatsAPI.ini.
 *
 * Note PacketSendRate ships as 0, which disables the periodic UpdateState
 * packet - without it there is no end-of-match stat snapshot, so setup has to
 * raise it rather than just check that Port is set.
 *
 * Returns { ok, path, reason }; `reason: "permission"` means re-run elevated,
 * since game installs usually sit under Program Files.
 */
/** Patch one ini file, backing it up first. */
function patchOne(target, port, packetSendRate) {
  let existing = null;
  let original = null;
  let encoding = "utf8";
  try {
    original = fs.readFileSync(target);
    if (original[0] === 0xff && original[1] === 0xfe) encoding = "utf16le";
    existing = original.toString(encoding);
  } catch (err) {
    // Missing file is normal on a fresh install.
    if (err.code !== "ENOENT") return { ok: false, path: target, reason: "read", error: err.message };
  }

  if (Number(readIniValue(existing || "", "WebPort")) === Number(port)) return { ok: false, path: target, reason: "port-conflict", error: "TCP Port and WebPort must be different. Change the Stats API port in settings or change WebPort in the game config." };

  if (existing !== null && isStatsApiEnabledText(existing, port)) {
    return { ok: true, path: target, alreadyEnabled: true, changed: false };
  }

  const next = patchIni(existing ?? "", { Port: port, PacketSendRate: packetSendRate });

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Keep a one-time backup so a bad patch is always recoverable.
    if (existing !== null && !fs.existsSync(`${target}.bak`)) {
      fs.writeFileSync(`${target}.bak`, original);
    }
    fs.writeFileSync(target, next, encoding);
    return { ok: true, path: target, alreadyEnabled: false, changed: true };
  } catch (err) {
    if (err.code === "EPERM" || err.code === "EACCES") {
      return { ok: false, path: target, reason: "permission", error: err.message };
    }
    return { ok: false, path: target, reason: "write", error: err.message };
  }
}

/**
 * Enable the Stats API.
 *
 * Patches the live user config first - that is the one the game reads, and it
 * lives under Documents so it needs no elevation. The install-folder template
 * is updated too when writable, so a config reset keeps the setting.
 */
function enableStatsApi(installDir, port = 49123, packetSendRate = 10) {
  if (!Number.isInteger(Number(port)) || port < 1 || port > 65535) return { ok: false, path: null, message: "Invalid Stats API port." };
  if (installDir && !looksLikeRocketLeague(installDir)) return { ok: false, path: null, message: "Choose the Rocket League folder containing TAGame\\Config." };
  const user = patchOne(userStatsIniPath(), port, packetSendRate);

  let template = null;
  if (installDir) {
    const installedUser = path.join(installDir, "TAGame", "Config", "TAStatsAPI.ini");
    template = patchOne(fs.existsSync(installedUser) ? installedUser : path.join(installDir, STATS_INI_RELATIVE), port, packetSendRate);
  }

  let message = user.ok ? "Game feed enabled. Restart Rocket League to apply the change." : `Could not update game config: ${user.error || user.reason}`;
  if (user.ok && template && !template.ok) message += " Your Documents config is ready, but the install-folder config could not be updated. If no feed arrives, update the install config manually.";
  return { ...user, message, userPath: user.path, templatePath: template?.path || null, template };
}

function isStatsApiEnabledText(text, port = 49123) {
  const configured = readIniValue(text, "Port");
  const rate = Number(readIniValue(text, "PacketSendRate"));
  return String(configured) === String(port) && Number.isFinite(rate) && rate > 0 && Number(readIniValue(text, "WebPort")) !== Number(port);
}

/**
 * True if the exporter is on, pointed at `port`, AND actually sending state.
 * Checks the live user config - the install template is not what the game reads.
 */
function isStatsApiEnabled(installDir, port = 49123) {
  try {
    const bytes = fs.readFileSync(userStatsIniPath());
    return isStatsApiEnabledText(bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf16le" : "utf8"), port);
  } catch {
    return false;
  }
}

function detectGame() {
  const installDir = findRocketLeague();
  const userConfigPath = userStatsIniPath();
  let installConfigPath = null;
  let installEnabled = false;
  if (installDir) {
    const installedUser = path.join(installDir, "TAGame", "Config", "TAStatsAPI.ini");
    installConfigPath = fs.existsSync(installedUser) ? installedUser : path.join(installDir, STATS_INI_RELATIVE);
    try {
      const bytes = fs.readFileSync(installConfigPath);
      installEnabled = isStatsApiEnabledText(bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf16le" : "utf8"));
    } catch { /* The install template may not exist yet. */ }
  }
  return {
    installDir,
    configPath: fs.existsSync(userConfigPath) ? userConfigPath : installConfigPath || userConfigPath,
    userConfigPath, installConfigPath,
    enabled: isStatsApiEnabled(installDir) || installEnabled,
  };
}

module.exports = { detectGame, enableStatsApi, findRocketLeague, userStatsIniPath, patchIni, readIniValue, isStatsApiEnabledText, patchOne };


