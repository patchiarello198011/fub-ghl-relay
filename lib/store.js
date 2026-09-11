/**
 * Simple file-based storage for:
 *  - ID mappings between GHL contacts and Follow Up Boss people
 *  - Processed webhook event IDs (for deduplication)
 *  - Dead-letter log (failed syncs that need manual attention)
 *
 * NOTE: This uses a JSON file on disk. That's fine for getting started, but
 * most free hosting tiers (e.g. Render's free plan) reset the filesystem on
 * every deploy/restart, which would wipe this data. Before relying on this
 * in production, either:
 *   (a) upgrade to a host with a persistent disk and mount DATA_DIR there, or
 *   (b) swap this file for a small hosted database (e.g. a free Postgres
 *       instance on Render/Supabase). The rest of the app doesn't need to
 *       change if you keep the same function signatures below.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

function ensureDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        {
          mappings: {},        // fubPersonId -> { ghlContactId, ghlLocationId }
          mappingsByGhl: {},   // ghlContactId -> fubPersonId
          processedEvents: {}, // eventId -> timestamp (dedupe)
          deadLetters: []      // failed sync attempts for manual review
        },
        null,
        2
      )
    );
  }
}

function readDb() {
  ensureDb();
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function saveMapping(fubPersonId, ghlContactId, ghlLocationId) {
  const db = readDb();
  const existing = db.mappings[fubPersonId] || {};
  db.mappings[fubPersonId] = { ...existing, ghlContactId, ghlLocationId };
  db.mappingsByGhl[ghlContactId] = fubPersonId;
  writeDb(db);
}

/**
 * Records the GHL opportunity ID created in the Person Stage pipeline for
 * this contact, so later peopleStageUpdated events know which opportunity
 * to move between stages.
 */
function savePersonOpportunityId(fubPersonId, opportunityId) {
  const db = readDb();
  if (!db.mappings[fubPersonId]) return;
  db.mappings[fubPersonId].ghlPersonOpportunityId = opportunityId;
  writeDb(db);
}

/**
 * Records the GHL opportunity ID created in the Deal Stage (Transactions)
 * pipeline for this contact, so later dealsUpdated events know which
 * opportunity to move between stages.
 */
function saveDealOpportunityId(fubPersonId, opportunityId) {
  const db = readDb();
  if (!db.mappings[fubPersonId]) return;
  db.mappings[fubPersonId].ghlDealOpportunityId = opportunityId;
  writeDb(db);
}

function getGhlContactIdForFubPerson(fubPersonId) {
  const db = readDb();
  return db.mappings[fubPersonId] || null;
}

function getFubPersonIdForGhlContact(ghlContactId) {
  const db = readDb();
  return db.mappingsByGhl[ghlContactId] || null;
}

function hasProcessedEvent(eventId) {
  const db = readDb();
  return Boolean(db.processedEvents[eventId]);
}

function markEventProcessed(eventId) {
  const db = readDb();
  db.processedEvents[eventId] = new Date().toISOString();
  // Keep this map from growing forever - trim entries older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const [id, ts] of Object.entries(db.processedEvents)) {
    if (new Date(ts).getTime() < cutoff) delete db.processedEvents[id];
  }
  writeDb(db);
}

function logDeadLetter(entry) {
  const db = readDb();
  db.deadLetters.push({ ...entry, loggedAt: new Date().toISOString() });
  writeDb(db);
  console.error('[DEAD LETTER]', JSON.stringify(entry));
}

function getDeadLetters() {
  return readDb().deadLetters;
}

module.exports = {
  saveMapping,
  savePersonOpportunityId,
  saveDealOpportunityId,
  getGhlContactIdForFubPerson,
  getFubPersonIdForGhlContact,
  hasProcessedEvent,
  markEventProcessed,
  logDeadLetter,
  getDeadLetters
};
