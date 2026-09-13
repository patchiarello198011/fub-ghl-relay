require('dotenv').config();
const express = require('express');
const ghl = require('./lib/ghlClient');
const fub = require('./lib/fubClient');
const store = require('./lib/store');
const { verifyFubSignature } = require('./lib/verifyWebhook');
const { getGhlStageForPersonStage, getGhlStageForDealStage, getPipelineIds } = require('./lib/stageMap');

const app = express();

// Keep the raw body around for signature verification, while still parsing JSON.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString('utf8');
    }
  })
);

const PORT = process.env.PORT || 3000;

/** Retries an async function with exponential backoff. Throws if all attempts fail. */
async function withRetry(fn, { attempts = 3, baseDelayMs = 500 } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

// Basic health check - useful for confirming the service is up after deploy.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// View dead letters (failed syncs) - protect this in production with a
// simple shared secret query param or basic auth before going live.
app.get('/dead-letters', (req, res) => {
  if (req.query.key !== process.env.ADMIN_VIEW_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json(store.getDeadLetters());
});

/**
 * LEG 1: GHL -> Follow Up Boss
 * Fires when a new contact/opportunity is created in the GHL subaccount
 * (via iSpeedToLead or manually). Creates the matching person in FUB and
 * saves the ID mapping.
 *
 * Configure this URL as a GHL workflow's "Webhook" action, triggered on
 * contact/opportunity creation.
 */
app.post('/webhooks/ghl', async (req, res) => {
  // Respond fast; GHL doesn't need to wait for the FUB call to finish.
  res.sendStatus(200);

  const payload = req.body;
  const eventId = payload.id || payload.contactId || `${Date.now()}`;

  if (store.hasProcessedEvent(`ghl:${eventId}`)) {
    console.log(`Skipping already-processed GHL event ${eventId}`);
    return;
  }

  const ghlContactId = payload.contactId || payload.id;
  const firstName = payload.firstName || payload.first_name;
  const lastName = payload.lastName || payload.last_name;
  const email = payload.email;
  const phone = payload.phone;

  if (!ghlContactId) {
    store.logDeadLetter({ direction: 'ghl->fub', reason: 'missing contactId', payload });
    return;
  }

  try {
    // Avoid creating duplicate FUB people if this contact was already synced.
    const existing = store.getFubPersonIdForGhlContact(ghlContactId);
    if (existing) {
      console.log(`GHL contact ${ghlContactId} already mapped to FUB person ${existing}`);
      store.markEventProcessed(`ghl:${eventId}`);
      return;
    }

    const fubPerson = await withRetry(() =>
      fub.createPerson({ firstName, lastName, email, phone, source: 'Brokerage Growth', ghlContactId })
    );

    store.saveMapping(fubPerson.id, ghlContactId, ghl.getLocationId());

    // Create an opportunity in each pipeline now, so future stage-change
    // webhooks from FUB have something to update rather than failing.
    const { personPipelineId, dealPipelineId } = await getPipelineIds();
    const contactName = `${firstName || ''} ${lastName || ''}`.trim() || 'New Referral Lead';

    if (personPipelineId) {
      const personOpp = await withRetry(() =>
        ghl.createOpportunity({ contactId: ghlContactId, name: contactName, pipelineId: personPipelineId })
      );
      store.savePersonOpportunityId(fubPerson.id, personOpp.id);
    } else {
      store.logDeadLetter({
        direction: 'ghl->fub',
        reason: 'Person Stage pipeline not found in GHL - opportunity not created',
        payload
      });
    }

    if (dealPipelineId) {
      const dealOpp = await withRetry(() =>
        ghl.createOpportunity({ contactId: ghlContactId, name: contactName, pipelineId: dealPipelineId })
      );
      store.saveDealOpportunityId(fubPerson.id, dealOpp.id);
    } else {
      store.logDeadLetter({
        direction: 'ghl->fub',
        reason: 'Deal Stage (Transactions) pipeline not found in GHL - opportunity not created',
        payload
      });
    }

    store.markEventProcessed(`ghl:${eventId}`);
    console.log(`Synced GHL contact ${ghlContactId} -> FUB person ${fubPerson.id}`);
  } catch (err) {
    store.logDeadLetter({
      direction: 'ghl->fub',
      reason: err.message,
      payload
    });
  }
});

/**
 * LEG 2: Follow Up Boss -> GHL
 * Fires on FUB events: stage changes and new notes. Updates the matching
 * GHL opportunity/contact.
 *
 * Register this URL in Follow Up Boss for the "stageChanged" (or
 * equivalent) and "note.created" events.
 */
app.post('/webhooks/fub', async (req, res) => {
  const signature = req.header('FUB-Signature');
  const isValid = verifyFubSignature(req.rawBody, signature);

  if (!isValid) {
    console.warn('Rejected FUB webhook - signature verification failed');
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  const payload = req.body;
  const eventId = payload.eventId || `${Date.now()}`;
  const eventType = payload.event; // 'peopleStageUpdated', 'dealsUpdated', 'notesCreated', etc.

  if (store.hasProcessedEvent(`fub:${eventId}`)) {
    console.log(`Skipping already-processed FUB event ${eventId}`);
    return;
  }

  try {
    // --- PERSON STAGE CHANGE ---
    // This event is unusual in that FUB includes the new stage name directly
    // in the payload (payload.data.stage) - no extra fetch needed.
    if (eventType === 'peopleStageUpdated') {
      const fubPersonId = payload.resourceIds?.[0];
      const newStageName = payload.data?.stage;
      if (!fubPersonId || !newStageName) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: 'missing personId or stage in peopleStageUpdated payload', payload });
        return;
      }

      const mapping = store.getGhlContactIdForFubPerson(fubPersonId);
      if (!mapping) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: `no GHL mapping for FUB person ${fubPersonId}`, payload });
        return;
      }

      const stageInfo = await getGhlStageForPersonStage(newStageName);
      if (!stageInfo) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: `no Person Stage mapping in GHL for "${newStageName}"`, payload });
      } else if (mapping.ghlPersonOpportunityId) {
        await withRetry(() => ghl.updateOpportunityStage({ opportunityId: mapping.ghlPersonOpportunityId, stageId: stageInfo.stageId }));
        console.log(`Updated GHL Person Stage for contact ${mapping.ghlContactId} -> ${newStageName}`);
      } else {
        store.logDeadLetter({ direction: 'fub->ghl', reason: 'no GHL Person Stage opportunity exists yet for this contact', payload });
      }
    }

    // --- DEAL STAGE CHANGE ---
    // FUB's dealsUpdated payload does NOT include the deal's current stage -
    // we have to fetch the deal itself from payload.uri to find that out.
    if (eventType === 'dealsUpdated') {
      const dealId = payload.resourceIds?.[0];
      if (!dealId || !payload.uri) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: 'missing dealId or uri in dealsUpdated payload', payload });
        return;
      }

      const dealData = await withRetry(() => fub.getResource(payload.uri));
      const deal = dealData.deals?.[0] || dealData;
      const newStageName = deal.stage || deal.stageName;
      // FUB's deal schema isn't fully documented publicly - try the common
      // shapes a deal might use to reference its associated person.
      const fubPersonId =
        deal.personId || deal.people?.[0]?.id || deal.peopleIds?.[0] || deal.contactId;

      if (!fubPersonId) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: 'could not determine which person this deal belongs to', payload, dealData });
        return;
      }

      const mapping = store.getGhlContactIdForFubPerson(fubPersonId);
      if (!mapping) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: `no GHL mapping for FUB person ${fubPersonId}`, payload });
        return;
      }

      const stageInfo = newStageName ? await getGhlStageForDealStage(newStageName) : null;
      if (!stageInfo) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: `no Deal Stage mapping in GHL for "${newStageName}"`, payload, dealData });
      } else if (mapping.ghlDealOpportunityId) {
        await withRetry(() => ghl.updateOpportunityStage({ opportunityId: mapping.ghlDealOpportunityId, stageId: stageInfo.stageId }));
        console.log(`Updated GHL Deal Stage for contact ${mapping.ghlContactId} -> ${newStageName}`);
      } else {
        store.logDeadLetter({ direction: 'fub->ghl', reason: 'no GHL Deal Stage opportunity exists yet for this contact', payload });
      }
    }

    // --- NOTE CREATED ---
    // Same situation - the webhook only gives us an ID and a link, so we
    // fetch the actual note content before mirroring it into GHL.
    if (eventType === 'notesCreated') {
      const noteId = payload.resourceIds?.[0];
      if (!noteId || !payload.uri) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: 'missing noteId or uri in notesCreated payload', payload });
        return;
      }

      const noteData = await withRetry(() => fub.getResource(payload.uri));
      const note = noteData.notes?.[0] || noteData;
      const fubPersonId = note.personId;
      const noteBody = note.body;

      if (!fubPersonId || !noteBody) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: 'note missing personId or body', payload, noteData });
        return;
      }

      const mapping = store.getGhlContactIdForFubPerson(fubPersonId);
      if (!mapping) {
        store.logDeadLetter({ direction: 'fub->ghl', reason: `no GHL mapping for FUB person ${fubPersonId}`, payload });
        return;
      }

      await withRetry(() => ghl.createNote({ contactId: mapping.ghlContactId, body: `[From Follow Up Boss] ${noteBody}` }));
      console.log(`Synced note for GHL contact ${mapping.ghlContactId}`);
    }

    store.markEventProcessed(`fub:${eventId}`);
  } catch (err) {
    store.logDeadLetter({
      direction: 'fub->ghl',
      reason: err.message,
      payload
    });
  }
});

app.listen(PORT, () => {
  console.log(`Relay service listening on port ${PORT}`);
});
