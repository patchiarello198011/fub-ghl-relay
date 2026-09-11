/**
 * Maps Follow Up Boss stage/pipeline names to GHL pipeline + stage IDs.
 *
 * Rather than requiring hardcoded GHL stage IDs (painful to find manually
 * and brittle if a stage gets renamed), this module fetches GHL's actual
 * pipeline structure at runtime and matches by NAME instead. As long as
 * the stage names in GHL match Follow Up Boss's names (which we set up
 * deliberately when building the pipelines), this just works - no IDs to
 * copy/paste, and renaming a stage in GHL doesn't break anything.
 *
 * Two GHL pipelines are expected to exist in the subaccount:
 *   - "Brokerage Growth Referrals" (Person Stage tracking)
 *   - "Brokerage Growth Referrals - Transactions" (Deal Stage tracking)
 *
 * Results are cached for 10 minutes so we're not hitting the GHL API on
 * every single webhook event.
 */

const ghl = require('./ghlClient');

const PERSON_PIPELINE_NAME = 'Brokerage Growth Referrals';
const DEAL_PIPELINE_NAME = 'Brokerage Growth Referrals - Transactions';
const CACHE_TTL_MS = 10 * 60 * 1000;

let cache = { data: null, fetchedAt: 0 };

async function getPipelineStructure() {
  const isFresh = cache.data && Date.now() - cache.fetchedAt < CACHE_TTL_MS;
  if (isFresh) return cache.data;

  const pipelines = await ghl.listPipelines();

  const personPipeline = pipelines.find((p) => p.name === PERSON_PIPELINE_NAME);
  const dealPipeline = pipelines.find((p) => p.name === DEAL_PIPELINE_NAME);

  if (!personPipeline) {
    console.warn(`[stageMap] Pipeline "${PERSON_PIPELINE_NAME}" not found in GHL yet.`);
  }
  if (!dealPipeline) {
    console.warn(`[stageMap] Pipeline "${DEAL_PIPELINE_NAME}" not found in GHL yet.`);
  }

  cache = {
    data: { personPipeline, dealPipeline },
    fetchedAt: Date.now()
  };
  return cache.data;
}

/**
 * Looks up the GHL pipeline + stage ID for a Follow Up Boss PERSON stage
 * name (e.g. "Lead", "Under Contract"). Returns null if not found.
 */
async function getGhlStageForPersonStage(fubStageName) {
  const { personPipeline } = await getPipelineStructure();
  if (!personPipeline) return null;
  const stage = personPipeline.stages.find((s) => s.name === fubStageName);
  if (!stage) return null;
  return { pipelineId: personPipeline.id, stageId: stage.id };
}

/**
 * Looks up the GHL pipeline + stage ID for a Follow Up Boss DEAL stage
 * name (e.g. "Signed", "Mls Live Listings"). Returns null if not found.
 */
async function getGhlStageForDealStage(fubStageName) {
  const { dealPipeline } = await getPipelineStructure();
  if (!dealPipeline) return null;
  const stage = dealPipeline.stages.find((s) => s.name === fubStageName);
  if (!stage) return null;
  return { pipelineId: dealPipeline.id, stageId: stage.id };
}

/**
 * Returns { personPipelineId, dealPipelineId } for use when creating new
 * opportunities. Either value may be null if that pipeline doesn't exist
 * in GHL yet.
 */
async function getPipelineIds() {
  const { personPipeline, dealPipeline } = await getPipelineStructure();
  return {
    personPipelineId: personPipeline ? personPipeline.id : null,
    dealPipelineId: dealPipeline ? dealPipeline.id : null
  };
}

module.exports = { getGhlStageForPersonStage, getGhlStageForDealStage, getPipelineIds };
