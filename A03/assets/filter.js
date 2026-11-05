// filter.js - shared by index.html and view.html
// Builds the list of ELIGIBLE characters (image really loads) and ELIGIBLE villages.

const API = "https://dattebayo-api.onrender.com";
const CACHE_KEY = "shinobiEligibleData_v1";
const CACHE_HOURS = 24;
let pageFailed = false; // true if any API page could not be loaded

// Show a loading message in the #message box
function showProgress(text) {
  const box = document.getElementById("message");
  if (box) {
    box.innerHTML = '<div class="text-center my-5"><div class="spinner-border text-danger"></div><p class="mt-2">' + text + "</p></div>";
  }
}

// Saved results (so images are not checked again on every page load)
function readCache() {
  try {
    const saved = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (saved && Date.now() - saved.time < CACHE_HOURS * 3600000) return saved.data;
  } catch (error) {}
  return null;
}

function saveCache(data) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), data: data }));
  } catch (error) {}
}

// Step 1a: get every page of villages
async function fetchAllVillages() {
  let list = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const response = await fetch(API + "/villages?page=" + page);
    const data = await response.json();
    list = list.concat(data.villages);
    totalPages = Math.ceil(data.total / data.pageSize);
    page++;
  }
  return list;
}

// Get one page of characters (tries twice)
async function fetchCharacterPage(page) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(API + "/characters?page=" + page);
      const data = await response.json();
      return data;
    } catch (error) {}
  }
  pageFailed = true;
  return { characters: [], total: 0, pageSize: 20 };
}

// Step 1b: get every page of characters (5 pages at a time)
async function fetchAllCharacters(onProgress) {
  const first = await fetchCharacterPage(1);
  let list = first.characters;
  const totalPages = Math.ceil(first.total / first.pageSize);
  for (let start = 2; start <= totalPages; start += 5) {
    const requests = [];
    for (let p = start; p < start + 5 && p <= totalPages; p++) {
      requests.push(fetchCharacterPage(p));
    }
    const results = await Promise.all(requests);
    for (let i = 0; i < results.length; i++) {
      list = list.concat(results[i].characters);
    }
    onProgress("Loading characters... page " + Math.min(start + 4, totalPages) + " of " + totalPages);
  }
  return list;
}

// Step 3: does the character have an image URL at all?
function hasImageUrl(character) {
  if (!Array.isArray(character.images)) return false;
  for (let i = 0; i < character.images.length; i++) {
    const url = character.images[i];
    if (typeof url === "string" && url.trim().startsWith("http")) return true;
  }
  return false;
}

// Step 4: really load the image with the Image object (onload / onerror)
function checkImage(url) {
  return new Promise(function (resolve) {
    const img = new Image();
    const timer = setTimeout(function () {
      img.src = "";
      resolve(false);
    }, 8000);
    img.onload = function () {
      clearTimeout(timer);
      resolve(img.naturalWidth > 0);
    };
    img.onerror = function () {
      clearTimeout(timer);
      resolve(false);
    };
    img.src = url;
  });
}

// Return the first image of the character that loads, or "" if none do
async function findWorkingImage(character) {
  for (let i = 0; i < character.images.length; i++) {
    const url = character.images[i];
    if (typeof url === "string" && url.trim().startsWith("http")) {
      const works = await checkImage(url.trim());
      if (works) return url.trim();
    }
  }
  return "";
}

// Runs all 9 steps. Returns { villages: [...], characters: {id: character} }
// villages[i].characters only holds ELIGIBLE character ids.
async function loadEligibleData(onProgress) {
  const cached = readCache();
  if (cached) return cached;

  // Step 1: villages and characters from the API
  onProgress("Loading villages...");
  const villages = await fetchAllVillages();
  const inVillage = {};
  for (let i = 0; i < villages.length; i++) {
    for (let j = 0; j < villages[i].characters.length; j++) {
      inVillage[villages[i].characters[j]] = true;
    }
  }
  const allCharacters = await fetchAllCharacters(onProgress);

  // Steps 2-3: keep characters that belong to a village and have an image URL
  const candidates = [];
  const seen = {};
  for (let i = 0; i < allCharacters.length; i++) {
    const c = allCharacters[i];
    if (inVillage[c.id] && !seen[c.id] && hasImageUrl(c)) {
      seen[c.id] = true;
      candidates.push(c);
    }
  }

  // Steps 4-5: check that the image loads (20 at a time), exclude the broken ones
  const eligible = {};
  for (let start = 0; start < candidates.length; start += 20) {
    const batch = candidates.slice(start, start + 20);
    const urls = await Promise.all(batch.map(findWorkingImage));
    for (let i = 0; i < batch.length; i++) {
      if (urls[i] !== "") {
        const c = batch[i];
        eligible[c.id] = {
          id: c.id,
          name: c.name,
          images: [urls[i]],
          personal: { clan: c.personal ? c.personal.clan : "", classification: c.personal ? c.personal.classification : "" },
          rank: { ninjaRank: c.rank ? c.rank.ninjaRank : "" }
        };
      }
    }
    onProgress("Checking images... " + Math.min(start + 20, candidates.length) + " of " + candidates.length);
  }

  // Steps 6-8: group by village, drop empty villages, count only eligible characters
  const eligibleVillages = [];
  for (let i = 0; i < villages.length; i++) {
    const ids = [];
    for (let j = 0; j < villages[i].characters.length; j++) {
      const id = villages[i].characters[j];
      if (eligible[id] && !ids.includes(id)) ids.push(id);
    }
    if (ids.length > 0) {
      eligibleVillages.push({ id: villages[i].id, name: villages[i].name, characters: ids });
    }
  }

  // Step 9: return the filtered data (only save it if every API page loaded)
  const result = { villages: eligibleVillages, characters: eligible };
  if (!pageFailed) saveCache(result);
  return result;
}
