const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_PATH = path.join(__dirname, process.env.CONFIG_PATH || 'config.yaml');

let _config = null;

function load() {
  if (_config) return _config;
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`[CONFIG] ${CONFIG_PATH} not found. Copy config.example.yaml to config.yaml`);
    process.exit(1);
  }
  _config = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
  return _config;
}

function get(key, fallback) {
  const cfg = load();
  const keys = key.split('.');
  let val = cfg;
  for (const k of keys) {
    if (val == null) return fallback;
    val = val[k];
  }
  return val ?? fallback;
}

module.exports = { load, get };
