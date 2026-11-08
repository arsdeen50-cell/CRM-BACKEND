import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { EmailMessage } from "../models/emailMessage.model.js";
import { LeadClient } from "../models/leadClient.model.js";
import { LeadSource } from "../models/leadSource.model.js";
import { User } from "../models/user.model.js";
import { emailConfigured, graph, mailProvider } from "./mailer.js";
import { appendActivity } from "./leadActivity.js";
import { stopSequencesForLead } from "./sequenceRunner.js";
import { notify } from "./notify.js";

/* Client email replies -> the CRM. Every few minutes the CRM mailbox (EMAIL) is read for recent mail. A message is
   kept only when it answers an email the CRM sent (its In-Reply-To / References quote our Message-ID) or comes from
   a client's address on file; everything else in the mailbox is left alone and never stored.
   A kept reply is filed on the lead's conversation next to WhatsApp, logged as "Replied", stops sequences set to stop
   on reply, and notifies the people on the lead. Gmail / SMTP mailboxes are read over IMAP with the same EMAIL /
   EMAIL_PASSWORD (IMAP_HOST overrides the server); Microsoft 365 through Graph (needs the Mail.Read app permission). */

const LOOKBACK_DAYS = 3;
const MAX_PER_RUN = 300;
const SKIP_SENDER = /(mailer-daemon|postmaster|no-?reply|do-?not-?reply|notifications?@)/i;

const ids = (s) => (String(s || "").match(/<[^<>\s]+>/g) || []).map((x) => x.trim());
const lower = (s) => String(s || "").trim().toLowerCase();

// Keep what the client wrote, not the quoted thread under it
export const stripQuoted = (text = "") => {
  const lines = String(text).replace(/\r/g, "").split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const twoLines = `${line} ${lines[i + 1] || ""}`;
    if (/^\s*On .{4,200}wrote:\s*$/i.test(line) || /^\s*On .{4,200}wrote:\s*$/i.test(twoLines.trim())) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(line) || /^\s*_{10,}\s*$/.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && /^\s*(Sent|Date):\s/i.test(lines[i + 1] || "")) break;
    if (/^\s*>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
};

const isAuto = (h = {}) => {
  const auto = lower(h["auto-submitted"]);
  const prec = lower(h.precedence);
  return (auto && auto !== "no") || !!h["x-autoreply"] || !!h["x-autorespond"] || ["bulk", "junk", "auto_reply", "list"].includes(prec);
};

/* Which lead a message belongs to: the CRM email it answers, else the client's address on file (their most
   recently updated lead). Messages from the team or the CRM mailbox itself are ignored. */
const buildMatcher = async (candidates) => {
  const quoted = [...new Set(candidates.flatMap((c) => [...c.inReplyTo, ...c.references]))];
  const sent = quoted.length ? await EmailMessage.find({ direction: { $ne: "in" }, providerMessageId: { $in: quoted } }).select("leadId clientId clientName providerMessageId sentBy").lean() : [];
  const byMsgId = new Map(sent.map((m) => [m.providerMessageId, m]));
  const senders = [...new Set(candidates.map((c) => c.from))];
  const [clients, staff] = await Promise.all([
    LeadClient.find({ email: { $in: senders }, isDeleted: { $ne: true } }).select("_id email brandName").lean(),
    User.find({ email: { $in: senders } }).select("email").lean(),
  ]);
  const staffSet = new Set(staff.map((u) => lower(u.email)));
  const clientsByEmail = new Map();
  for (const c of clients) clientsByEmail.set(lower(c.email), [...(clientsByEmail.get(lower(c.email)) || []), c]);
  const leadCache = new Map();
  const latestLead = async (clientIds) => {
    const key = clientIds.join(",");
    if (!leadCache.has(key)) leadCache.set(key, await LeadSource.findOne({ clientId: { $in: clientIds } }).sort({ updatedAt: -1 }).select("_id clientId clientName").lean());
    return leadCache.get(key);
  };
  return async (c) => {
    if (staffSet.has(c.from) || c.from === lower(process.env.EMAIL)) return null;
    const answered = [...c.inReplyTo, ...c.references].map((id) => byMsgId.get(id)).find((m) => m?.leadId);
    if (answered) return { leadId: answered.leadId, clientId: answered.clientId, clientName: answered.clientName, answered };
    const own = clientsByEmail.get(c.from);
    if (!own) return null;
    const lead = await latestLead(own.map((x) => x._id));
    return lead ? { leadId: lead._id, clientId: lead.clientId, clientName: own[0].brandName || lead.clientName } : null;
  };
};

const fileReply = async (c, match) => {
  try {
    const msg = await EmailMessage.create({
      direction: "in",
      leadId: match.leadId,
      clientId: match.clientId,
      clientName: match.clientName || "",
      to: process.env.EMAIL,
      from: c.from,
      fromName: c.fromName,
      subject: c.subject,
      body: c.body,
      status: "Received",
      providerMessageId: c.messageId,
      replyToMessageId: match.answered?.providerMessageId || "",
      readByTeam: false,
      source: "reply",
      createdAt: c.date,
    });
    const who = c.fromName || c.from;
    await appendActivity(match.leadId, { type: "Email", outcome: "Replied", note: `Email reply from ${who}: "${c.subject}"\n${c.body}`.slice(0, 2000), loggedBy: who, nextFollowUpDate: new Date() });
    await stopSequencesForLead(match.leadId, "Replied by email", { onlyStopOnReply: true });
    const lead = await LeadSource.findById(match.leadId).select("projectAccountHandledBy teamMember createdBy").lean();
    const names = [lead?.projectAccountHandledBy, lead?.teamMember, lead?.createdBy, match.answered?.sentBy].filter(Boolean);
    const people = names.length ? await User.find({ fullname: { $in: names }, isActive: { $ne: false } }).select("_id").lean() : [];
    await notify(people.map((p) => p._id), { kind: "lead", title: `${match.clientName || who} replied by email`, body: c.subject, link: match.clientId ? `/crm/clients/${match.clientId}` : "/crm/messages" });
    return msg;
  } catch (err) {
    if (err.code === 11000) return null; // already filed
    throw err;
  }
};

const since = () => new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

/* ---------- Gmail / SMTP mailboxes over IMAP ---------- */
const imapHost = () => process.env.IMAP_HOST || (process.env.SMTP_HOST ? process.env.SMTP_HOST.replace(/^smtp\./i, "imap.") : "imap.gmail.com");

const readImap = async () => {
  const client = new ImapFlow({ host: imapHost(), port: Number(process.env.IMAP_PORT || 993), secure: true, auth: { user: process.env.EMAIL, pass: process.env.EMAIL_PASSWORD }, logger: false });
  await client.connect();
  const found = [];
  const lock = await client.getMailboxLock("INBOX");
  try {
    const uids = (await client.search({ since: since() }, { uid: true })) || [];
    const recent = uids.slice(-MAX_PER_RUN);
    const heads = [];
    if (recent.length) {
      for await (const m of client.fetch(recent, { uid: true, envelope: true, headers: ["references", "auto-submitted", "precedence", "x-autoreply", "x-autorespond"] }, { uid: true })) {
        const raw = m.headers?.toString() || "";
        const h = {};
        for (const [, k, v] of raw.replace(/\r?\n[ \t]+/g, " ").matchAll(/^([\w-]+):\s*(.*)$/gm)) h[k.toLowerCase()] = v;
        const from = m.envelope?.from?.[0];
        heads.push({
          uid: m.uid,
          messageId: m.envelope?.messageId || "",
          inReplyTo: ids(m.envelope?.inReplyTo),
          references: ids(h.references),
          from: lower(from?.address),
          fromName: from?.name || "",
          subject: m.envelope?.subject || "",
          date: m.envelope?.date || new Date(),
          auto: isAuto(h),
        });
      }
    }
    const candidates = heads.filter((x) => x.messageId && x.from && !x.auto && !SKIP_SENDER.test(x.from));
    const known = new Set((await EmailMessage.find({ direction: "in", providerMessageId: { $in: candidates.map((x) => x.messageId) } }).select("providerMessageId").lean()).map((x) => x.providerMessageId));
    const fresh = candidates.filter((x) => !known.has(x.messageId));
    const match = await buildMatcher(fresh);
    for (const c of fresh) {
      const m = await match(c);
      if (!m) continue;
      const { content } = await client.download(String(c.uid), undefined, { uid: true });
      const parsed = await simpleParser(content);
      c.body = stripQuoted(parsed.text || String(parsed.html || "").replace(/<[^>]+>/g, " ")) || "(no text)";
      found.push([c, m]);
    }
  } finally {
    lock.release();
    await client.logout().catch(() => {});
  }
  return found;
};

/* ---------- Microsoft 365 over Graph ---------- */
const readGraph = async () => {
  const mailbox = encodeURIComponent(process.env.EMAIL);
  const select = "id,internetMessageId,subject,from,receivedDateTime,internetMessageHeaders,body";
  let url = `/users/${mailbox}/mailFolders/inbox/messages?$filter=receivedDateTime ge ${since().toISOString()}&$select=${select}&$top=100&$orderby=receivedDateTime desc`;
  const rows = [];
  for (let page = 0; url && page < 3; page++) {
    const data = await graph(url, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    rows.push(...(data.value || []));
    url = data["@odata.nextLink"] ? data["@odata.nextLink"].replace("https://graph.microsoft.com/v1.0", "") : null;
  }
  const candidates = rows
    .map((r) => {
      const h = {};
      for (const x of r.internetMessageHeaders || []) h[lower(x.name)] = x.value;
      return {
        messageId: r.internetMessageId || "",
        inReplyTo: ids(h["in-reply-to"]),
        references: ids(h.references),
        from: lower(r.from?.emailAddress?.address),
        fromName: r.from?.emailAddress?.name || "",
        subject: r.subject || "",
        date: new Date(r.receivedDateTime),
        auto: isAuto(h),
        body: stripQuoted(r.body?.content || "") || "(no text)",
      };
    })
    .filter((x) => x.messageId && x.from && !x.auto && !SKIP_SENDER.test(x.from));
  const known = new Set((await EmailMessage.find({ direction: "in", providerMessageId: { $in: candidates.map((x) => x.messageId) } }).select("providerMessageId").lean()).map((x) => x.providerMessageId));
  const fresh = candidates.filter((x) => !known.has(x.messageId));
  const match = await buildMatcher(fresh);
  const found = [];
  for (const c of fresh) {
    const m = await match(c);
    if (m) found.push([c, m]);
  }
  return found;
};

export const readReplies = async () => {
  const found = mailProvider() === "microsoft" ? await readGraph() : await readImap();
  let filed = 0;
  for (const [c, m] of found.sort((a, b) => new Date(a[0].date) - new Date(b[0].date))) if (await fileReply(c, m)) filed++;
  return filed;
};

let running = false;
export const startReplyReader = () => {
  if (String(process.env.EMAIL_REPLIES_DISABLED).toLowerCase() === "true" || !emailConfigured()) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await readReplies();
      if (n) console.log(`📥 Filed ${n} email repl${n === 1 ? "y" : "ies"} on leads`);
    } catch (err) {
      console.error("Reading email replies failed:", err.message);
    } finally {
      running = false;
    }
  };
  setInterval(tick, 5 * 60 * 1000).unref();
  setTimeout(tick, 90 * 1000).unref();
  console.log("📥 Client email replies are read every 5 min");
};
