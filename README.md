# Applicator Hub

A phone-first web app for Agri-Stor applicators. Admins upload labels, SDS sheets, SOPs and equipment manuals; applicators ask questions in plain words and get a short answer with links to the exact source pages, or browse the document library.

## How it works

- **web/** — React (Vite) app, deployed on Vercel. Sign-in, Ask, Library, and an admin-only Manage screen (upload, team approvals, question log).
- **supabase/migrations/** — database: documents, searchable passages (with keyword + meaning search), question log, user roles, file storage, and row-level security.
- **supabase/functions/ingest** — indexes uploaded documents (admins only).
- **supabase/functions/ask** — finds the best-matching passages and, if `ANTHROPIC_API_KEY` is set, writes an answer that cites them. Without the key it returns matching passages only.

Text is pulled out of PDFs and Word files in the admin's browser, split into ~900-character passages, and each passage is embedded with Supabase's built-in `gte-small` model. Scanned PDFs with no text layer need OCR before upload.

## Accounts and roles

There is no self sign-up. Admins add people under **Manage → Team** (name, email, starting password, access level), reset passwords, change access, or remove people there. Everyone can change their own password from the **Password** link at the top. Access levels: applicator (search and read), admin (also uploads and manages people), no access.

The `admin-users` edge function does the account work with the service key, after checking the caller is an admin.

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
