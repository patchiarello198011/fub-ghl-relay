# Brokerage Growth <-> Follow Up Boss Relay

This is the program that keeps GoHighLevel (Brokerage Growth Referrals
subaccount) and Follow Up Boss (ADT Realty) in sync:

- New GHL contacts get created as people in Follow Up Boss.
- Notes and pipeline stage changes made in Follow Up Boss get mirrored
  back onto the matching GHL contact/opportunity.

It does **not** send any text messages or make any calls - it's purely
server-to-server data syncing.

## What you need before deploying

- Your GHL Private Integration key (starts with `pit-`)
- Your GHL subaccount's Location ID (the string in the URL after
  `/v2/location/`)
- Your Follow Up Boss API key (starts with `fka_`)

## Deploying (Render.com, free tier)

1. Go to https://render.com and sign up / log in.
2. Click **New +** -> **Web Service**.
3. When asked for a repository, choose the option to deploy from a
   local folder / upload, or push this folder to a GitHub repo first
   and connect that repo (either works - ask if you want help with
   either path).
4. Set the **Build Command** to `npm install`.
5. Set the **Start Command** to `npm start`.
6. Under **Environment Variables**, add each line from `.env.example`
   with your real values (do not upload the `.env.example` file itself
   as your real config - just copy the variable names into Render's
   own environment variable form).
7. Click **Create Web Service**. Render will give you a URL like
   `https://your-service-name.onrender.com` once it's deployed.

## Connecting GHL to this service

1. In the Brokerage Growth Referrals subaccount, go to **Automation**
   and create a new Workflow.
2. Trigger: **Contact Created** (or Opportunity Created, depending on
   what you want to sync on).
3. Action: **Webhook**, URL = `https://your-service-name.onrender.com/webhooks/ghl`
4. Save and publish the workflow.

## Connecting Follow Up Boss to this service

1. In Follow Up Boss, go to **Admin -> Webhooks** (ask ADT Realty to
   do this part, since it's their account).
2. Create a webhook for the events you want synced (stage changes,
   note created) pointed at:
   `https://your-service-name.onrender.com/webhooks/fub`
3. If FUB support tells you your account needs a "System Key" for
   signature verification, add that as `FUB_SYSTEM_KEY` in Render's
   environment variables and redeploy.

## How pipeline syncing works

This relay tracks two separate things per lead, because Follow Up Boss
treats them as two separate objects:

- **Person Stage** (Lead, Attempted Contact, Spoke with Customer,
  Appointment Set, Under Contract, Closed) - synced to the GHL pipeline
  named exactly `Brokerage Growth Referrals`.
- **Deal Stage** (Appointment Set, Appointment Met, Signed, Mls Live
  Listings, Pending, Closed) - synced to the GHL pipeline named exactly
  `Brokerage Growth Referrals - Transactions`.

You do NOT need to manually find or enter GHL stage IDs. The relay
looks up both pipelines by name and matches stages by name automatically
every time it needs one, caching the result for 10 minutes. If you
rename a stage in GHL, just make sure the new name still matches
Follow Up Boss's wording exactly - no code changes needed.

If a FUB stage name doesn't have a matching GHL stage (typo, or a stage
that exists in FUB but wasn't built in GHL), the sync logs it to
dead-letters instead of failing silently - check that endpoint
periodically, especially right after setup.

## Checking on failures

Visit `https://your-service-name.onrender.com/dead-letters?key=YOUR_ADMIN_VIEW_KEY`
(using the ADMIN_VIEW_KEY you set) to see any syncs that failed and
why - this is your safety net for catching anything that didn't go
through automatically.

## Security notes

- Never commit a real `.env` file to any code repository - only
  `.env.example` (with placeholder values) should ever be shared.
- The API keys used to set this up were shared in chat during setup.
  Once everything is tested and working, regenerate both the GHL
  Private Integration key and the Follow Up Boss API key so the
  ones that passed through chat aren't the ones staying live long-term.
