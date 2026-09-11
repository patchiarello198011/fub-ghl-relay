/**
 * Thin wrapper around GoHighLevel's v2 API for the handful of calls this
 * relay needs: creating/finding contacts, creating opportunities, updating
 * opportunity stage, and adding notes.
 *
 * Docs: https://marketplace.gohighlevel.com/docs/
 */

const axios = require('axios');

const BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';

function client() {
  const token = process.env.GHL_API_KEY;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!token) throw new Error('GHL_API_KEY is not set in environment variables');
  if (!locationId) throw new Error('GHL_LOCATION_ID is not set in environment variables');

  return axios.create({
    baseURL: BASE_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      Version: API_VERSION,
      'Content-Type': 'application/json'
    }
  });
}

function getLocationId() {
  return process.env.GHL_LOCATION_ID;
}

/**
 * Finds a contact by email or phone, if one exists.
 * Returns the contact object or null.
 */
async function findContact({ email, phone }) {
  const api = client();
  const query = email ? `email=${encodeURIComponent(email)}` : `phone=${encodeURIComponent(phone)}`;
  const res = await api.get(`/contacts/?locationId=${getLocationId()}&${query}`);
  const contacts = res.data?.contacts || [];
  return contacts[0] || null;
}

/**
 * Creates a new contact in GHL. Returns the created contact object.
 */
async function createContact({ firstName, lastName, email, phone, source, tags }) {
  const api = client();
  const res = await api.post('/contacts/', {
    locationId: getLocationId(),
    firstName,
    lastName,
    email,
    phone,
    source: source || 'Brokerage Growth',
    tags: tags || ['brokerage-growth-referral']
  });
  return res.data.contact;
}

/**
 * Creates an opportunity for a given contact in the specified pipeline/stage.
 * pipelineId and stageId are optional - if omitted, GHL uses pipeline defaults.
 */
async function createOpportunity({ contactId, name, pipelineId, stageId, monetaryValue }) {
  const api = client();
  const payload = {
    locationId: getLocationId(),
    contactId,
    name: name || 'New Referral Lead',
    status: 'open'
  };
  if (pipelineId) payload.pipelineId = pipelineId;
  if (stageId) payload.pipelineStageId = stageId;
  if (monetaryValue) payload.monetaryValue = monetaryValue;

  const res = await api.post('/opportunities/', payload);
  return res.data.opportunity;
}

/**
 * Updates an existing opportunity's pipeline stage.
 */
async function updateOpportunityStage({ opportunityId, stageId }) {
  const api = client();
  const res = await api.put(`/opportunities/${opportunityId}`, {
    pipelineStageId: stageId
  });
  return res.data.opportunity;
}

/**
 * Adds a note to a contact. This is what backs the Follow Up Boss -> GHL
 * note sync - GHL's note-creation endpoint only requires the contacts.write
 * scope, no separate "notes" scope exists.
 */
async function createNote({ contactId, body }) {
  const api = client();
  const res = await api.post(`/contacts/${contactId}/notes`, { body });
  return res.data.note;
}

/**
 * Fetches every pipeline in the subaccount, with their stages, so
 * stageMap.js can match by name instead of needing hardcoded IDs.
 * Returns an array of { id, name, stages: [{ id, name }] }.
 */
async function listPipelines() {
  const api = client();
  const res = await api.get(`/opportunities/pipelines?locationId=${getLocationId()}`);
  return res.data.pipelines || [];
}

module.exports = {
  findContact,
  createContact,
  createOpportunity,
  updateOpportunityStage,
  createNote,
  listPipelines,
  getLocationId
};
