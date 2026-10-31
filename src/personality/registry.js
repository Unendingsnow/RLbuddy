"use strict";

const fs = require("node:fs");
const path = require("node:path");

const EVENT_TYPES = Object.freeze([
  "match_start", "goal", "conceded", "team_goal", "save", "epic_save",
  "assist", "shot", "demo", "demolished", "overtime", "win", "loss",
  "match_end", "idle", "greeting", "chat",
]);
const MAX_PACK_BYTES = 128 * 1024;
const MOOD_TYPES = Object.freeze(["idle", "happy", "hype", "sad", "smug", "surprised", "thinking"]);
const FIELDS = new Set([
  "schemaVersion", "id", "name", "tagline", "description", "author", "version",
  "color", "systemPrompt", "lines", "gentleLines", "spicyLines", "reactionStyles",
]);

function fail(message) { throw new Error(`Invalid personality pack: ${message}`); }
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}
function boundedString(value, label, max, required = true) {
  if (typeof value !== "string" || (required && !value.trim()) || value.length > max
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
    fail(`${label} must be text between ${required ? 1 : 0} and ${max} characters.`);
  }
  return value.trim();
}
function validateLines(value, label) {
  if (!isRecord(value)) fail(`${label} must be an object of event names and line arrays.`);
  const result = {};
  for (const [key, lines] of Object.entries(value)) {
    if (!EVENT_TYPES.includes(key)) fail(`unknown event "${key}" in ${label}.`);
    if (!Array.isArray(lines) || lines.length < 1 || lines.length > 30) fail(`${label}.${key} needs 1–30 lines.`);
    result[key] = lines.map((line) => boundedString(line, `${label}.${key}`, 220));
  }
  return result;
}

function validatePack(input) {
  if (!isRecord(input)) fail("the root must be a JSON object.");
  for (const key of Object.keys(input)) if (!FIELDS.has(key)) fail(`unsupported field "${key}".`);
  if (input.schemaVersion !== 1) fail("schemaVersion must be 1.");
  if (typeof input.id !== "string" || !/^[a-z][a-z0-9-]{1,47}$/.test(input.id)) fail("id must be 2–48 lowercase letters, digits, or hyphens.");
  if (typeof input.version !== "string" || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(input.version)) fail("version must use major.minor.patch.");
  if (typeof input.color !== "string" || !/^#[a-fA-F0-9]{6}$/.test(input.color)) fail("color must be a six-digit hex color.");
  const pack = {
    schemaVersion: 1,
    id: input.id,
    name: boundedString(input.name, "name", 40),
    tagline: boundedString(input.tagline, "tagline", 90),
    description: boundedString(input.description, "description", 600),
    author: boundedString(input.author, "author", 80),
    version: input.version,
    color: input.color,
    systemPrompt: boundedString(input.systemPrompt, "systemPrompt", 4000),
    lines: validateLines(input.lines, "lines"),
  };
  for (const required of ["greeting", "idle", "chat"]) {
    if (!pack.lines[required]) fail(`lines.${required} is required.`);
  }
  for (const field of ["gentleLines", "spicyLines"]) {
    if (input[field] !== undefined) pack[field] = validateLines(input[field], field);
  }
  if (input.reactionStyles !== undefined) {
    if (!isRecord(input.reactionStyles)) fail("reactionStyles must be an object.");
    pack.reactionStyles = {};
    for (const [event, style] of Object.entries(input.reactionStyles)) {
      if (!EVENT_TYPES.includes(event) || !isRecord(style)) fail("reactionStyles must use supported event names and objects.");
      for (const field of Object.keys(style)) if (!["mood", "bubbleMs", "cooldownMs", "weights"].includes(field)) fail(`unsupported reactionStyles field "${field}".`);
      const clean = {};
      if (style.mood !== undefined) {
        if (!MOOD_TYPES.includes(style.mood)) fail(`unsupported mood for ${event}.`);
        clean.mood = style.mood;
      }
      for (const [field, min, max] of [["bubbleMs", 2000, 20000], ["cooldownMs", 300, 60000]]) {
        if (style[field] !== undefined) {
          if (!Number.isInteger(style[field]) || style[field] < min || style[field] > max) fail(`${event}.${field} must be ${min}–${max}.`);
          clean[field] = style[field];
        }
      }
      if (style.weights !== undefined) {
        if (!Array.isArray(style.weights) || style.weights.length !== pack.lines[event]?.length
          || style.weights.some((weight) => !Number.isInteger(weight) || weight < 1 || weight > 100)) fail(`${event}.weights must match the normal lines and contain integers 1–100.`);
        clean.weights = [...style.weights];
      }
      pack.reactionStyles[event] = clean;
    }
  }
  return pack;
}

function readPack(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PACK_BYTES) fail("select a regular JSON file smaller than 128 KiB.");
  if (path.extname(file).toLowerCase() !== ".json") fail("only .json packs are supported.");
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")); }
  catch { fail("the file is not valid JSON."); }
  return validatePack(parsed);
}

class PersonalityRegistry {
  constructor({ builtinDir, userDir }) {
    this.builtinDir = path.resolve(builtinDir);
    this.userDir = path.resolve(userDir);
    fs.mkdirSync(this.userDir, { recursive: true });
    this.errors = [];
    this.packs = new Map();
    this.reload();
  }

  reload() {
    this.errors = [];
    this.packs.clear();
    for (const [dir, builtin] of [[this.builtinDir, true], [this.userDir, false]]) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
        try {
          const pack = readPack(path.join(dir, name));
          if (this.packs.has(pack.id)) throw new Error(`Duplicate personality id: ${pack.id}`);
          this.packs.set(pack.id, { ...pack, builtin });
        } catch (error) { this.errors.push({ file: name, message: error.message }); }
      }
    }
  }

  list() { return [...this.packs.values()].map((pack) => structuredClone(pack)); }
  get(id) {
    const pack = this.packs.get(id) || this.packs.get("octane") || this.packs.values().next().value;
    if (!pack) throw new Error("No valid personality packs are installed.");
    return structuredClone(pack);
  }

  importFile(file) {
    const pack = readPack(file);
    if (this.packs.get(pack.id)?.builtin) throw new Error("Built-in personalities cannot be replaced. Give your pack its own id.");
    const destination = path.join(this.userDir, `${pack.id}.json`);
    const temporary = `${destination}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(temporary, `${JSON.stringify(pack, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, destination);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
    this.reload();
    return this.get(pack.id);
  }
}

module.exports = { PersonalityRegistry, validatePack, readPack, EVENT_TYPES, MOOD_TYPES, MAX_PACK_BYTES };
