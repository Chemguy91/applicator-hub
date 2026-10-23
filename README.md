# Applicator Hub

A phone-first reference site for Agri-Stor applicators: one tile per product, each opening the full product reference card with its Sprout-Nip processing settings (tip temperature, volume per hour, airflow).

## Where the content lives

- **web/src/data/cards.json** — all 13 product cards (Sanidate 12.0 left out on purpose) (from *Thermal Application Reference Cards*) and the processing settings (from the *Processing Temps* sheet, "At The Tip of The Sprout-Nip Machine"). Values are copied exactly as written. CIPC combos are stored under Aceto Shield Pellets; the "Storox/Perox" line applies to both Storox 2.0 and Perox AG. Products not on the sheet show "Not on the processing temperature sheet yet."
- **web/src/pages/Reference.jsx** — tiles, product-type tabs, search, and the card view.
- **web/src/data/checklist.json** + **web/src/pages/Setup.jsx** — the Checklists tab: *Sprout Inhibiting — Operational Checklist For New Machines* (27 steps, from the .docx) and the *Post Treatment Check List* (10 items). Checkmarks and write-ins are saved in the phone's browser only; "Start a new job" clears them.
- **web/src/pages/Team.jsx** — admin screen for adding people, resetting passwords and removing access.

To change a card or a setting, edit `cards.json` and push; Vercel redeploys.

The Supabase document-search tables and the `ingest`/`ask` functions from the first version are still deployed but no longer used by the site.

## Access codes and locations

There are no personal accounts. Each location has a general code and an admin code:

Locations: Washington (WA), Idaho (ID), Colorado (CO). The codes themselves are kept out of this repo.

- Codes are stored only as bcrypt hashes in `private.access_codes` (not in this repo's code). The `code-login` edge function checks them in the database and signs the phone in as that code's shared account.
- 8 wrong codes from one address in 15 minutes locks that address out for 15 minutes; 60 wrong codes overall in 15 minutes locks everyone out for 15 minutes.
- Submitted checklists are tagged with the location by the database (from who is signed in, never the browser). Everyone sees only their own location's results; only that location's admin can edit or delete them. Edits are timestamped.
- Signing out only signs out that phone (everyone shares the same account per code).

To change a code, update its hash, e.g.
`update private.access_codes set code_hash = extensions.crypt('1234', extensions.gen_salt('bf', 10)) where location = 'WA' and role = 'applicator';`

The `ask`, `ingest` and `admin-users` functions from earlier versions are retired (return 410).

## Setup

1. Create a Supabase project and run `supabase/migrations/001_hub_schema.sql`.
2. Deploy the three edge functions (`ingest`, `ask`, `admin-users`) with JWT verification **off** (they check the user themselves).
3. Add the edge function secret `ANTHROPIC_API_KEY` (optional `ANSWER_MODEL`, default `claude-sonnet-5-5`).
4. In Auth settings, turn off **Allow new users to sign up** and **Confirm email**, and set Site URL to the live address.
5. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` (publishable key) in Vercel, root directory `web`.
6. Create the first admin in the Supabase dashboard (Authentication → Users → Add user → Create new user, auto-confirm), then:
   `update profiles set role = 'admin' where email = 'you@example.com';`

## Local development

```bash
cd web
cp .env.example .env   # fill in your project values
npm install
npm run dev
```
