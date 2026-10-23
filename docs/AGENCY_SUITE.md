# Agency suite (branch `feat/agency-suite`)

Eleven features on top of the sales suite. Every integration is optional: with its variables missing, the CRM keeps the manual flow (open your own email / WhatsApp, record payments by hand).

| # | Feature | API | Page |
|---|---|---|---|
| 1 | Send email from the CRM, with open/click tracking, logged on the lead | `POST /api/v1/messages/email`, `GET /api/v1/messages`, `GET /api/v1/messages/lead/:id` | Contact dialog "Send from CRM", `/crm/messages`, Messages button on Leads |
| 2 | WhatsApp Business (Meta Cloud API): send + receive replies on the lead | `POST /api/v1/messages/whatsapp`, webhook `/api/v1/public/whatsapp/webhook` | Contact dialog "Send via WhatsApp API", `/crm/messages` |
| 3 | Follow-up sequences (Day 0 email -> Day 2 WhatsApp -> Day 5 call), auto or manual steps, stop on reply / Won / Lost | `/api/v1/sequence`, `/api/v1/sequence/enrollments` | `/crm/sequences`, "Add to sequence" on Leads |
| 4 | Lead capture: public forms (link + website embed), Facebook/Instagram lead ads, Instagram DMs, unknown WhatsApp numbers | `/api/v1/leadform`, `/api/v1/public/forms/:key`, webhook `/api/v1/public/meta/webhook` | `/crm/lead-forms`, public `/f/:key` |
| 5 | Proposal client link: view tracking, online accept with drawn signature, decline; acceptance = Won + project | `POST /api/v1/proposal/:id/share`, `/api/v1/public/proposal/:token` | Link / email buttons on Proposals, public `/p/:token` |
| 6 | Monthly targets + leaderboard (calls, emails, WhatsApps, meetings, new leads, won, revenue) | `/api/v1/target` | `/crm/targets` |
| 7 | GST invoices (CGST+SGST / IGST, Indian FY numbering), Razorpay payment links, payments, reminders | `/api/v1/invoice`, webhook `/api/v1/public/razorpay/webhook`, `/api/v1/public/invoice/:token` | `/crm/invoices`, public `/i/:token` |
| 8 | Retainers: MRR/ARR, renewal alerts, auto-renew, monthly invoice on the billing day | `/api/v1/retainer` | `/crm/retainers` |
| 9 | Content calendar per client, generated from retainer deliverables, files, comments | `/api/v1/content` | `/crm/content` |
| 10 | Client portal (magic link): projects, content approval, invoices + pay, proposals, files | `/api/v1/portal-access` (admin), `/api/v1/portal/*` (X-Portal-Token) | `/crm/portal`, public `/portal/:token` |
| 11 | Time tracking (timer or manual) and profit per client (invoiced revenue before GST - hours x cost) | `/api/v1/time`, `/api/v1/time/profitability`, `/api/v1/time/rates` | `/crm/time`, `/crm/profitability` |

Status of every integration: `/crm/integrations` (admin).

## Access

- Admin only: invoices, retainers, portal links, lead forms, sequence create/edit, targets setting, profitability, staff rates.
- Every logged-in member: send messages and enroll **their own** leads, complete sequence steps for their leads, the leaderboard, the content calendar, their own time entries.
- No login (public): lead forms, proposal / invoice pages (long random tokens), client portal (token hashed in the DB, revocable, expires), webhooks (signature-checked), tracking pixel/redirect (redirects only to signed URLs).

## Environment variables (all optional)

| Variable | Purpose |
|---|---|
| `CRM_APP_URL` (default `https://crm.arsdeen.cloud`) | Base of public links (/f, /p, /i, /portal) |
| `CRM_API_PUBLIC_URL` (default `https://api.crm.arsdeen.cloud`) | Base of tracking + webhook URLs |
| `EMAIL`, `EMAIL_PASSWORD` (existing) · `SMTP_HOST`, `SMTP_PORT` | Sending email. Gmail by default |
| `EMAIL_TRACKING_DISABLED=true` | Turn off open/click tracking |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` | WhatsApp Cloud API send + webhook |
| `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_PAGE_ACCESS_TOKEN` | Lead ads + Instagram DMs webhook |
| `LEAD_DEFAULT_OWNER`, `LEAD_NOTIFY_EMAILS` | Owner and email alerts for webhook leads |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Payment links + "paid" webhook |
| `INVOICE_REMINDERS_ENABLED=true`, `BILLING_HOUR` (10) | Automatic reminders: 3 days before, due day, 7/14/30 days overdue |
| `RETAINER_BILLING_DISABLED=true` | Stop automatic monthly retainer invoices |
| `SEQUENCES_DISABLED=true`, `SEQUENCE_SEND_HOURS` (9-19) | Sequence runner and its sending window |
| `INVOICE_PREFIX` (TOM-INV), `INVOICE_TERMS`, `COMPANY_GSTIN`, `COMPANY_BANK_NAME`, `COMPANY_BANK_ACCOUNT`, `COMPANY_BANK_IFSC`, `COMPANY_UPI_ID` | Printed on invoices |

## Webhook setup

- **WhatsApp**: Meta app -> WhatsApp -> Configuration -> callback `https://api.crm.arsdeen.cloud/api/v1/public/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to `messages`.
- **Lead ads / Instagram**: Meta app -> Webhooks -> Page object field `leadgen`, Instagram object field `messages`, callback `https://api.crm.arsdeen.cloud/api/v1/public/meta/webhook`, verify token = `META_VERIFY_TOKEN`. The page token needs `leads_retrieval`, `pages_manage_metadata`, `instagram_manage_messages`.
- **Razorpay**: Dashboard -> Webhooks -> `https://api.crm.arsdeen.cloud/api/v1/public/razorpay/webhook`, secret = `RAZORPAY_WEBHOOK_SECRET`, event `payment_link.paid`.

## Deploying

No new npm packages and no data migration. Deploy backend and frontend together, then `pm2 restart crm-backend`. The backend starts two background jobs: the sequence runner (every 5 minutes) and daily billing (after `BILLING_HOUR`). Nothing sends on its own until you create a sequence with an auto step, tick auto-send on a retainer, or set `INVOICE_REMINDERS_ENABLED=true`.

Known limits: email replies aren't read back into the CRM (log "Replied" to stop a sequence); opens are approximate (some mail apps pre-load or block images); free-text WhatsApp only works within 24 h of the customer's last message.
