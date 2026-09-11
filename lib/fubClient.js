/**
 * Thin wrapper around the Follow Up Boss REST API for creating a person
 * when a new lead arrives in GHL.
 *
 * FUB authenticates with HTTP Basic Auth: your API key as the username,
 * blank password. Some FUB accounts also require X-System / X-System-Key
 * headers identifying the integration - if FUB support tells you this is
 * required for your account, set FUB_SYSTEM_NAME and FUB_SYSTEM_KEY in
 * your environment and this client will include them automatically.
 *
 * Docs: https://docs.followupboss.com/
 */

const axios = require('axios');

const BASE_URL = 'https://api.followupboss.com/v1';

function client() {
  const apiKey = process.env.FUB_API_KEY;
  if (!apiKey) throw new Error('FUB_API_KEY is not set in environment variables');

  const headers = {
    'Content-Type': 'application/json'
  };
  if (process.env.FUB_SYSTEM_NAME) headers['X-System'] = process.env.FUB_SYSTEM_NAME;
  if (process.env.FUB_SYSTEM_KEY) headers['X-System-Key'] = process.env.FUB_SYSTEM_KEY;

  return axios.create({
    baseURL: BASE_URL,
    auth: { username: apiKey, password: '' },
    headers
  });
}

/**
 * Creates a person in Follow Up Boss. Returns the created person object,
 * which includes the FUB person id needed for the ID-mapping table.
 */
async function createPerson({ firstName, lastName, email, phone, source, ghlContactId }) {
  const api = client();
  const res = await api.post('/people', {
    firstName,
    lastName,
    emails: email ? [{ value: email }] : undefined,
    phones: phone ? [{ value: phone }] : undefined,
    source: source || 'Brokerage Growth',
    // Custom field to store the GHL contact ID on the FUB side too -
    // useful for manual lookups and as a backup if the local mapping
    // table is ever lost. Requires a matching custom field to exist in
    // FUB named something like "GHL Contact ID" - adjust the key below
    // to match whatever FUB calls it once you've created that field.
    customGhlContactId: ghlContactId
  });
  return res.data;
}

module.exports = { createPerson };
