const DATA_URL = "clean_champ_dict.json";

const ATTRS = [
  { key: "gender",      label: "Gender",   type: "single" },
  { key: "positions",   label: "Position", type: "array"  },
  { key: "species",     label: "Species",  type: "array"  },
  { key: "resource",    label: "Resource", type: "single" },
  { key: "rangeType",   label: "Range",    type: "array"  },
  { key: "regions",     label: "Region",   type: "array"  },
  { key: "releaseYear", label: "Year",     type: "year"   },
];

const CYCLES = {
  single: [null, "correct", "wrong"],
  array:  [null, "correct", "partial", "wrong"],
  year:   [null, "correct", "higher", "lower"],
};

let CHAMPION_DATA = [];
let guesses = [];       // array of champion data objects
let feedbackState = []; // array of { attrKey: state }
let selectedCandidate = null; // name of clicked candidate chip

// --- DOM refs ---
const champInput     = document.getElementById("champion-input");
const addBtn         = document.getElementById("add-guess-btn");
const autocompleteList = document.getElementById("autocomplete-list");
const guessesSection = document.getElementById("guesses-section");
const guessesList    = document.getElementById("guesses-list");
const candidateCount = document.getElementById("candidate-count");
const candidatesList = document.getElementById("candidates-list");

// --- Transform raw data ---
function transformChampion(name, raw) {
  const posMap = { "Middle": "Mid" };
  const positions = (raw.positions || []).map(p => posMap[p] || p);
  const resource  = raw.resource === "Manaless" ? "None" : (raw.resource || "");
  const rangeType = raw.range_type || [];

  return {
    name,
    gender: raw.gender,
    species: raw.species || [],
    regions: raw.regions || [],
    positions,
    resource,
    rangeType,
    releaseYear: raw.release_year ?? null,
  };
}

// --- Autocomplete ---
function onInput() {
  const val = champInput.value.trim().toLowerCase();
  autocompleteList.innerHTML = "";
  if (!val) { autocompleteList.classList.add("hidden"); return; }

  const matches = CHAMPION_DATA
    .filter(c => c.name.toLowerCase().startsWith(val))
    .slice(0, 8);
  if (!matches.length) { autocompleteList.classList.add("hidden"); return; }

  autocompleteList.classList.remove("hidden");
  matches.forEach(champ => {
    const div = document.createElement("div");
    div.textContent = champ.name;
    div.addEventListener("mousedown", () => {
      champInput.value = champ.name;
      autocompleteList.classList.add("hidden");
    });
    autocompleteList.appendChild(div);
  });
}

// --- Add guess ---
function addGuess() {
  const name = champInput.value.trim();
  if (!name) return;

  const matched = CHAMPION_DATA.find(c => c.name.toLowerCase() === name.toLowerCase());
  if (!matched) {
    champInput.style.borderColor = "#e53e3e";
    setTimeout(() => champInput.style.borderColor = "", 800);
    return;
  }

  if (guesses.some(g => g.name === matched.name)) return;

  guesses.push(matched);
  feedbackState.push(Object.fromEntries(ATTRS.map(a => [a.key, null])));

  champInput.value = "";
  selectedCandidate = null;
  autocompleteList.classList.add("hidden");
  renderAll();
}

// --- Feedback cycling ---
function cycleState(attrType, current) {
  const cycle = CYCLES[attrType];
  return cycle[(cycle.indexOf(current) + 1) % cycle.length];
}

function onCellClick(td, guessIdx, attrKey, attrType) {
  feedbackState[guessIdx][attrKey] = cycleState(attrType, feedbackState[guessIdx][attrKey]);
  const state = feedbackState[guessIdx][attrKey];
  td.className = "attr-cell" + (state ? ` ${state}` : "");
  td.textContent = displayValue(guesses[guessIdx], attrKey) + arrowFor(state);
  renderCandidates();
}

// --- Filtering ---
function computeCandidates() {
  const guessedNames = new Set(guesses.map(g => g.name));

  return CHAMPION_DATA.filter(candidate => {
    if (guessedNames.has(candidate.name)) return false;

    for (let i = 0; i < guesses.length; i++) {
      const guess = guesses[i];
      const fb    = feedbackState[i];

      for (const { key, type } of ATTRS) {
        const state = fb[key];
        if (!state) continue;

        if (type === "single") {
          if (state === "correct" && candidate[key] !== guess[key]) return false;
          if (state === "wrong"   && candidate[key] === guess[key]) return false;

        } else if (type === "array") {
          const cSet = new Set(candidate[key]);
          const gArr = guess[key];
          const isIdentical = cSet.size === gArr.length && gArr.every(v => cSet.has(v));
          const hasShared   = gArr.some(v => cSet.has(v));

          if (state === "correct" && !isIdentical)          return false;
          if (state === "partial" && (isIdentical || !hasShared)) return false;
          if (state === "wrong"   && hasShared)             return false;

        } else if (type === "year") {
          if (state === "correct" && candidate[key] !== guess[key]) return false;
          if (state === "higher"  && candidate[key] <= guess[key])  return false;
          if (state === "lower"   && candidate[key] >= guess[key])  return false;
        }
      }
    }
    return true;
  });
}

// --- Entropy ---
function compareLists(a, b) {
  const setB = new Set(b);
  if (a.length === setB.size && a.every(v => setB.has(v))) return "green";
  if (a.some(v => setB.has(v))) return "yellow";
  return "red";
}

function provideFeedback(guess, candidate) {
  const fb = {};
  for (const { key, type } of ATTRS) {
    if (type === "single") {
      fb[key] = guess[key] === candidate[key] ? "green" : "red";
    } else if (type === "array") {
      fb[key] = compareLists(guess[key], candidate[key]);
    } else if (type === "year") {
      if (guess[key] === candidate[key]) fb[key] = "green";
      else if (candidate[key] < guess[key]) fb[key] = "earlier";
      else fb[key] = "later";
    }
  }
  return JSON.stringify(fb);
}

function computeEntropy(guess, candidates) {
  const counts = new Map();
  for (const c of candidates) {
    const fb = provideFeedback(guess, c);
    counts.set(fb, (counts.get(fb) || 0) + 1);
  }
  const total = candidates.length;
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / total;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// --- Render helpers ---
function displayValue(champ, attrKey) {
  const v = champ[attrKey];
  if (Array.isArray(v)) return v.join(", ");
  return v ?? "—";
}

function arrowFor(state) {
  if (state === "higher") return " ↑";
  if (state === "lower")  return " ↓";
  return "";
}

// --- Render ---
function renderAll() {
  renderGuesses();
  renderCandidates();
}

function renderGuesses() {
  if (!guesses.length) { guessesSection.classList.add("hidden"); return; }
  guessesSection.classList.remove("hidden");

  guessesList.innerHTML = "";

  const table = document.createElement("table");
  table.className = "guess-table";

  // Header
  const thead = table.createTHead();
  const headerRow = thead.insertRow();
  ["Champion", ...ATTRS.map(a => a.label)].forEach(label => {
    const th = document.createElement("th");
    th.textContent = label;
    headerRow.appendChild(th);
  });

  // Body
  const tbody = table.createTBody();
  [...guesses].reverse().forEach((champ, ri) => {
    const i = guesses.length - 1 - ri;
    const tr = tbody.insertRow();

    // Champion name cell
    const nameTd = tr.insertCell();
    nameTd.textContent = champ.name;
    nameTd.className = "champion-cell";

    // Attribute cells
    ATTRS.forEach(({ key, type }) => {
      const td    = tr.insertCell();
      const state = feedbackState[i][key];
      td.className = "attr-cell" + (state ? ` ${state}` : "");
      td.textContent = displayValue(champ, key) + arrowFor(state);
      td.addEventListener("click", () => onCellClick(td, i, key, type));
    });
  });

  guessesList.appendChild(table);
}

function renderCandidates() {
  const candidates = computeCandidates();
  candidateCount.textContent = candidates.length;
  candidatesList.innerHTML = "";

  if (!candidates.length) {
    candidatesList.innerHTML = `<p class="empty-state">No candidates remaining.</p>`;
    return;
  }

  const ranked = candidates
    .map(c => ({ champ: c, entropy: computeEntropy(c, candidates) }))
    .sort((a, b) => b.entropy - a.entropy);

  ranked.forEach(({ champ, entropy }) => {
    const chip = document.createElement("div");
    chip.className = "candidate-chip" + (selectedCandidate === champ.name ? " selected" : "");
    chip.innerHTML = `${champ.name} <span class="entropy">${entropy.toFixed(2)}</span>`;
    chip.addEventListener("click", () => {
      if (selectedCandidate === champ.name) {
        selectedCandidate = null;
        champInput.value = "";
      } else {
        selectedCandidate = champ.name;
        champInput.value = champ.name;
      }
      renderCandidates();
    });
    candidatesList.appendChild(chip);
  });
}

// --- Tabs ---
function initTabs() {
  document.querySelectorAll(".tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".tab-content").forEach(c => c.classList.add("hidden"));
      document.getElementById("tab-" + btn.dataset.tab).classList.remove("hidden");
      if (btn.dataset.tab === "glossary" && !glossaryRendered) {
        renderGlossary();
        glossaryRendered = true;
      }
    });
  });
}

// --- Glossary ---
let glossaryRendered = false;
let glossarySortKey = "name";
let glossarySortAsc = true;
const glossaryFilters = {};
const GLOSSARY_COLS = ["name", "gender", "positions", "species", "resource", "rangeType", "regions", "releaseYear"];

function glossaryValue(champ, key) {
  const v = champ[key];
  if (Array.isArray(v)) return v.join(", ");
  return v ?? "—";
}

function glossarySortCompare(a, b) {
  const key = glossarySortKey;
  let av = a[key], bv = b[key];
  if (Array.isArray(av)) av = av.join(", ");
  if (Array.isArray(bv)) bv = bv.join(", ");
  if (av == null) av = "";
  if (bv == null) bv = "";
  if (typeof av === "number" && typeof bv === "number") {
    return glossarySortAsc ? av - bv : bv - av;
  }
  av = String(av).toLowerCase();
  bv = String(bv).toLowerCase();
  if (av < bv) return glossarySortAsc ? -1 : 1;
  if (av > bv) return glossarySortAsc ? 1 : -1;
  return 0;
}

const ARRAY_COLS = new Set(["positions", "species", "rangeType", "regions"]);

function matchesFilter(champ, key, filterVal) {
  if (!filterVal) return true;
  if (key === "name") {
    return champ.name.toLowerCase().includes(filterVal.toLowerCase());
  }
  if (ARRAY_COLS.has(key)) {
    return Array.isArray(champ[key]) && champ[key].includes(filterVal);
  }
  return String(champ[key] ?? "—") === filterVal;
}

function renderGlossary() {
  const tbody = document.getElementById("glossary-body");
  tbody.innerHTML = "";

  const filtered = CHAMPION_DATA
    .filter(c => GLOSSARY_COLS.every(key => matchesFilter(c, key, glossaryFilters[key])))
    .sort(glossarySortCompare);

  filtered.forEach(champ => {
    const tr = document.createElement("tr");
    GLOSSARY_COLS.forEach(key => {
      const td = document.createElement("td");
      td.textContent = glossaryValue(champ, key);
      if (key === "name") td.className = "glossary-name";
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // Update sort indicators
  document.querySelectorAll(".glossary-table th").forEach(th => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === glossarySortKey) {
      th.classList.add(glossarySortAsc ? "sort-asc" : "sort-desc");
    }
  });
}

function populateFilterDropdowns() {
  // Column dropdowns
  GLOSSARY_COLS.forEach(key => {
    if (key === "name") return;
    const select = document.querySelector(`select[data-filter="${key}"]`);
    if (!select) return;
    const values = new Set();
    CHAMPION_DATA.forEach(c => {
      const v = c[key];
      if (ARRAY_COLS.has(key) && Array.isArray(v)) {
        v.forEach(item => values.add(item));
      } else {
        values.add(String(v ?? "—"));
      }
    });
    [...values].sort((a, b) => {
      if (key === "releaseYear") return Number(a) - Number(b);
      return a.localeCompare(b);
    }).forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      select.appendChild(opt);
    });
  });
}

function initGlossary() {
  document.querySelectorAll(".glossary-table th[data-sort]").forEach(th => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      if (glossarySortKey === key) {
        glossarySortAsc = !glossarySortAsc;
      } else {
        glossarySortKey = key;
        glossarySortAsc = true;
      }
      renderGlossary();
    });
  });

  // Column filters
  document.querySelectorAll(".filter-row select[data-filter]").forEach(sel => {
    sel.addEventListener("change", () => {
      glossaryFilters[sel.dataset.filter] = sel.value;
      renderGlossary();
    });
  });
  populateFilterDropdowns();
}

// --- Init ---
function init() {
  champInput.addEventListener("input", onInput);
  document.addEventListener("click", e => {
    if (!autocompleteList.contains(e.target) && e.target !== champInput) {
      autocompleteList.classList.add("hidden");
    }
  });
  addBtn.addEventListener("click", addGuess);
  champInput.addEventListener("keydown", e => { if (e.key === "Enter") addGuess(); });

  initTabs();
  initGlossary();
  renderCandidates();
}

// --- Bootstrap ---
fetch(DATA_URL)
  .then(r => r.json())
  .then(raw => {
    CHAMPION_DATA = Object.entries(raw).map(([name, data]) => transformChampion(name, data));
    init();
  })
  .catch(err => {
    console.error("Failed to load champion data:", err);
    candidatesList.innerHTML =
      `<p class="empty-state">Failed to load champion data. Check the console.</p>`;
  });
