# Sales suite (branch `feat/crm-sales-suite`)

## What's new

| Feature | API | Frontend page |
|---|---|---|
| Login required on all client/lead routes; employees see only leads assigned to them (by `projectAccountHandledBy`, `teamMember`, `teamAssigned` or `createdBy` matching their full or first name); deletes, import, reports and audit are admin-only | all routes | — |
| Follow-up queue (overdue / today / next 7 days / later / no date) | `GET /api/v1/leadsource/followups`, `PATCH /api/v1/leadsource/:id/followup` | `/crm/follow-ups` |
| One-click outreach + logging (Email, WhatsApp, Call, Visit, Instagram DM, with outcome and next follow-up) | `POST /api/v1/leadsource/:id/activity` now accepts `outcome` and `nextFollowUpDate` | "Contact" button on Leads and Follow-ups |
| Outreach templates with `{{placeholders}}` | `/api/v1/template` (+ `POST /starters`) | `/crm/templates` |
| Structured research fields on clients (`research.score`, `tier`, `gap`, `signal`, `angle`, `sourceUrls`, ...) and filters (`?tier=P1`, `?missingContact=true`) | `/api/v1/leadclient` | tier badges on Leads and Clients |
| CSV import with dry-run preview and duplicate detection | `POST /api/v1/leadclient/import` | `/crm/import` |
| Pipeline reports (funnel, win rate, sources, industries, services, owners, time in stage, lost reasons, activity) | `GET /api/v1/leadsource/reports` | `/crm/reports` |
| Won lead -> project + kickoff task (also manual "Create project"), welcome email | `/api/v1/project` | `/crm/projects` |
| Proposals with line items, GST, PDF download; Sent/Accepted update the lead (Accepted = Won + project) | `/api/v1/proposal` | `/crm/proposals`, "Proposal" button on Leads |
| Audit log of every create / update / stage / activity / delete | `GET /api/v1/audit` | `/crm/audit-log` |
| Calendar: "Add to Google Calendar" links and `.ics` export of follow-ups | — | Follow-ups, Contact dialog |
| Daily follow-up email digest (off by default) | — | — |

Also fixed: brand names with brackets broke duplicate checks and search (regex is now escaped).

## New optional environment variables

| Variable | Default | Purpose |
|---|---|---|
| `FOLLOWUP_DIGEST_ENABLED` | `false` | `true` sends the daily follow-up email (uses the existing `EMAIL` / `EMAIL_PASSWORD` mailer) |
| `FOLLOWUP_DIGEST_HOUR` | `9` | Hour to send the digest, in the business time zone |
| `CRM_TZ_OFFSET_MINUTES` | `330` | Business time zone offset from UTC (330 = IST) for "today" / "overdue" |
| `CRM_APP_URL` | — | Frontend URL linked from the digest email, e.g. `https://crm.arsdeen.cloud` |
| `COMPANY_NAME`, `COMPANY_TAGLINE`, `COMPANY_ADDRESS`, `COMPANY_EMAIL`, `COMPANY_PHONE`, `COMPANY_GSTIN` | Trends of Media defaults | Branding printed on proposal PDFs |

Frontend: `VITE_BACKEND_URL` (optional) overrides the API base URL; it defaults to production.

## Deploying

1. Deploy backend and frontend together. The lead routes now require a login token; the current frontend already sends it, but any script calling the API needs `Authorization: Bearer <token>`.
2. No data migration is needed. New fields are optional and existing leads keep working.
3. Employees can now open the CRM, but they only see the leads assigned to them. Check that `projectAccountHandledBy` / `teamMember` names match your users' names.
4. To add the research fields to leads imported earlier, run the prospect import script with `--backfill`.
