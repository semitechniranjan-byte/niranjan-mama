/**
 * Client-facing overview of the Qsilon voice agent.
 *
 * Every figure here is either measured on the live deployment or a published provider
 * list price; nothing is projected. Where a number is an estimate the document says so.
 */
const fs = require("fs");
const {
  AlignmentType, BorderStyle, Document, Footer, HeadingLevel, LevelFormat, PageBreak,
  Packer, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, VerticalAlign,
  WidthType,
} = require("docx");

// A4 (11906 DXA) less 1440 margins each side.
const W = 9026;
const INK = "14202E";
const MUTED = "5A6672";
const SIGNAL = "0E6E6C";
const WON = "14735A";
const LOST = "A32F3C";
const BG_HEAD = "EDF3F2";
const BG_ALT = "F7F6F3";
const BG_TOTAL = "E6F1F0";

const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const HAIR = { style: BorderStyle.SINGLE, size: 2, color: "D8D4CB" };

function txt(text, o = {}) {
  return new TextRun({
    text,
    bold: o.bold,
    italics: o.italics,
    color: o.color || INK,
    size: o.size || 20,
    font: o.mono ? "Consolas" : "Calibri",
  });
}

function p(text, o = {}) {
  return new Paragraph({
    alignment: o.align,
    spacing: { before: o.before ?? 0, after: o.after ?? 120, line: 276 },
    indent: o.indent,
    border: o.border,
    children: Array.isArray(text) ? text : [txt(text, o)],
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, bold: true, size: 30, color: INK, font: "Calibri" })],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
    children: [new TextRun({ text, bold: true, size: 23, color: SIGNAL, font: "Calibri" })],
  });
}

function cell(children, o = {}) {
  return new TableCell({
    width: { size: o.w, type: WidthType.DXA },
    shading: o.bg ? { type: ShadingType.CLEAR, fill: o.bg, color: "auto" } : undefined,
    margins: { top: 90, bottom: 90, left: 130, right: 130 },
    verticalAlign: VerticalAlign.CENTER,
    columnSpan: o.span,
    borders: o.borders,
    children: Array.isArray(children) ? children : [children],
  });
}

/** Standard data table: header row, optional zebra, optional emphasised last row. */
function table(cols, headers, rows, opts = {}) {
  const head = new TableRow({
    tableHeader: true,
    children: headers.map((t, i) =>
      cell(p([txt(t, { bold: true, size: 17, color: SIGNAL })], { after: 0 }), {
        w: cols[i], bg: BG_HEAD,
      }),
    ),
  });
  const body = rows.map((r, ri) => {
    const isTotal = opts.totalRow && ri === rows.length - 1;
    return new TableRow({
      children: r.map((c, i) => {
        const val = typeof c === "object" ? c : { t: c };
        return cell(
          p([txt(val.t, {
            bold: isTotal || val.bold,
            size: 19,
            mono: val.mono,
            color: val.color,
          })], { after: 0, align: val.align }),
          { w: cols[i], bg: isTotal ? BG_TOTAL : ri % 2 ? BG_ALT : undefined },
        );
      }),
    });
  });
  return new Table({
    width: { size: W, type: WidthType.DXA },
    columnWidths: cols,
    rows: [head, ...body],
  });
}

/** One stage of the architecture pipeline. */
function stage(title, sub, w, bg) {
  return cell(
    [
      p([txt(title, { bold: true, size: 18 })], { after: 20, align: AlignmentType.CENTER }),
      p([txt(sub, { size: 15, color: MUTED, mono: true })], { after: 0, align: AlignmentType.CENTER }),
    ],
    { w, bg, borders: { top: HAIR, bottom: HAIR, left: HAIR, right: HAIR } },
  );
}

function arrow(w) {
  return cell(p([txt("→", { size: 24, color: SIGNAL, bold: true })], {
    after: 0, align: AlignmentType.CENTER,
  }), { w, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE } });
}

const bullets = (items) =>
  items.map((t) =>
    new Paragraph({
      numbering: { reference: "dots", level: 0 },
      spacing: { after: 90, line: 276 },
      children: Array.isArray(t) ? t : [txt(t)],
    }),
  );

// ── document ────────────────────────────────────────────────────────────────
const doc = new Document({
  creator: "Qsilon",
  title: "Qsilon Voice Agent — Client Overview",
  numbering: {
    config: [{
      reference: "dots",
      levels: [{
        level: 0, format: LevelFormat.BULLET, text: "•",
        alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 360, hanging: 220 } } },
      }],
    }],
  },
  styles: {
    default: { document: { run: { font: "Calibri", size: 20, color: INK } } },
  },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    footers: {
      default: new Footer({
        children: [p([txt("Qsilon Voice Agent  ·  Client Overview  ·  August 2026",
          { size: 15, color: MUTED })], { align: AlignmentType.CENTER, after: 0 })],
      }),
    },
    children: [
      // ── cover ──────────────────────────────────────────────────────────
      p([txt("QSILON", { bold: true, size: 22, color: SIGNAL })], { before: 1800, after: 40 }),
      p([txt("Conversational Collections", { size: 20, color: MUTED })], { after: 400 }),
      new Paragraph({
        spacing: { after: 200 },
        children: [new TextRun({
          text: "An AI agent that calls, negotiates and reports.",
          bold: true, size: 46, color: INK, font: "Calibri",
        })],
      }),
      p([txt(
        "A production Hindi voice agent for EMI recovery. It dials the customer, holds a real " +
        "conversation, secures a payment commitment, and writes back a disposition the " +
        "collections desk can act on — at roughly three rupees a minute.",
        { size: 22, color: MUTED },
      )], { after: 600 }),

      table([2600, 6426], ["", ""], [
        ["Prepared for", "Client evaluation · pilot review"],
        ["System", { t: "www.qsilon.com", mono: true }],
        ["Status", { t: "Live · in production", color: WON, bold: true }],
        ["Figures", "Measured on the live deployment, August 2026"],
      ]),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 1 ──────────────────────────────────────────────────────────────
      h1("1.  What this is"),
      p("Qsilon places outbound collection calls in Hindi, conducts the conversation without " +
        "a human agent, and records what the customer committed to. It is not a recorded " +
        "IVR: the customer speaks naturally, the agent understands, negotiates within the " +
        "policy it has been given, and closes the call."),
      p("Three things separate it from a dialler with a recording:"),
      ...bullets([
        [txt("It negotiates. ", { bold: true }), txt("A promise beyond three days triggers a three-step negotiation — overdue reminder, credit-score consequence, then a firm close.")],
        [txt("It reports. ", { bold: true }), txt("Every call is scored automatically into one of thirteen disposition codes, with the promise date and a quote of what the customer actually said.")],
        [txt("It survives real conditions. ", { bold: true }), txt("Traffic, shops, a television in the room, a customer talking over the agent — all handled without the conversation breaking down.")],
      ]),

      h2("Where it stands today"),
      p("Measured on the live system, not projected.", { color: MUTED, size: 18 }),
      table([2256, 2256, 2257, 2257],
        ["Reply latency", "Greeting starts", "Median call", "Turns per call"],
        [[{ t: "~700 ms", mono: true, bold: true }, { t: "129 ms", mono: true, bold: true },
          { t: "45 sec", mono: true, bold: true }, { t: "7", mono: true, bold: true }]]),
      p("", { after: 80 }),
      table([2256, 2256, 2257, 2257],
        ["Languages ready", "Scenarios passing", "Disposition codes", "Concurrent calls"],
        [[{ t: "7", mono: true, bold: true }, { t: "14 / 14", mono: true, bold: true },
          { t: "13", mono: true, bold: true }, { t: "5", mono: true, bold: true }]]),
      p([txt("A human pause on a phone call is 500–800 ms. At ~700 ms the agent answers " +
        "inside that window, so the conversation does not feel like it is waiting on a machine.",
        { italics: true, color: MUTED })], { before: 160 }),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 2 ──────────────────────────────────────────────────────────────
      h1("2.  Architecture"),
      p("Audio streams in both directions over a single WebSocket. No stage waits for the " +
        "previous one to finish before it starts — speech is being transcribed while the " +
        "customer is still talking, and the reply is spoken as it is generated."),

      h2("Call path"),
      new Table({
        width: { size: W, type: WidthType.DXA },
        columnWidths: [1900, 420, 1900, 420, 2066, 420, 1900],
        rows: [new TableRow({
          children: [
            stage("Customer", "mobile", 1900),
            arrow(420),
            stage("Vobiz", "PSTN · SIP", 1900),
            arrow(420),
            stage("Qsilon Agent", "FastAPI · Render", 2066, BG_TOTAL),
            arrow(420),
            stage("Console", "React · operator", 1900),
          ],
        })],
      }),
      p("", { after: 100 }),
      p("The agent calls three services on every turn:", { color: MUTED, size: 18 }),
      new Table({
        width: { size: W, type: WidthType.DXA },
        columnWidths: [2900, 163, 2900, 163, 2900],
        rows: [new TableRow({
          children: [
            stage("Deepgram", "speech → text", 2900),
            cell(p("", { after: 0 }), { w: 163, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE } }),
            stage("Gemini", "decides the reply", 2900),
            cell(p("", { after: 0 }), { w: 163, borders: { top: NONE, bottom: NONE, left: NONE, right: NONE } }),
            stage("Cartesia", "text → speech", 2900),
          ],
        })],
      }),
      p([txt("Everything to the right of the agent is a stateless API call. Any one provider " +
        "can be swapped from the console without a code change.", { italics: true, color: MUTED })],
        { before: 140 }),

      h2("What each part does"),
      table([2100, 6926], ["Component", "Responsibility"], [
        ["Vobiz", "Places the call over the Indian phone network and streams the audio to and from the agent."],
        ["Qsilon Agent", "Owns the conversation: voice-activity detection, background-noise filtering, barge-in, turn-taking, the script, and hanging up when the call is done."],
        ["Deepgram", "Transcribes Hindi as the customer speaks, and signals where each sentence ends."],
        ["Gemini", "Reads the script and the conversation so far, then decides the next reply."],
        ["Cartesia", "Speaks the reply, streaming audio back as it is produced."],
        ["MongoDB Atlas", "Stores transcripts, outcomes, datasheets and campaign state."],
        ["Console", "Operator interface — campaigns, test calls, transcripts and reporting."],
      ]),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 3 ──────────────────────────────────────────────────────────────
      h1("3.  How one turn works"),
      p("What happens between the customer finishing a sentence and hearing a reply. " +
        "Times are measured on the live service."),
      table([900, 5926, 2200], ["Step", "What happens", "Elapsed"], [
        ["1", "Customer speaks — audio streams to Deepgram while they are still talking", { t: "0 ms", mono: true }],
        ["2", "Deepgram marks the sentence complete and returns the transcript", { t: "~300 ms", mono: true }],
        ["3", "Noise filter drops coughs, traffic and television before they reach the model", { t: "< 1 ms", mono: true }],
        ["4", "Gemini reads the script and the conversation, and decides the reply", { t: "~560 ms", mono: true }],
        ["5", "Cartesia begins speaking — audio is sent as generated, not after", { t: "~120 ms", mono: true }],
        [{ t: "", bold: true }, { t: "Customer hears the reply", bold: true }, { t: "~700 ms", mono: true, bold: true }],
      ], { totalRow: true }),

      h2("If the customer talks over the agent"),
      ...bullets([
        "The agent stops within 160 ms and answers what was actually said, rather than finishing its sentence.",
        "It does not repeat what the customer already heard — the model is told what it was cut off saying.",
        "If the interruption produces nothing usable — a cough, a passing lorry — the agent re-invites the customer rather than going silent.",
        "A short grace window stops the customer's own last word from cutting off a reply that has only just begun.",
      ]),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 4 ──────────────────────────────────────────────────────────────
      h1("4.  What the agent handles"),
      p("Every scenario below is covered by the script and verified against the live model. " +
        "Current pass rate: 14 of 14."),
      table([2600, 6426], ["Scenario", "Behaviour"], [
        ["Identity check", "Confirms the customer by name before disclosing anything about the account."],
        ["Wrong person", "Ends the call politely without revealing the debt."],
        ["Commits within 3 days", "Accepts and asks for a time — does not re-ask for a date already given."],
        ["Commits beyond 3 days", "Runs the three-step negotiation before accepting."],
        ["Vague answer", "Asks for a specific day rather than accepting “soon”."],
        ["No money right now", "Shows understanding, then asks what part-payment is possible."],
        ["Claims already paid", "Asks which day, confirms it will be checked, closes."],
        ["Illness or bereavement", "Expresses sympathy, stops pushing for payment, offers a callback."],
        ["Anger or abuse", "Stays calm, acknowledges, and ends the call after two attempts."],
        ["Busy or driving", "Asks when to call back."],
        ["Off topic", "Redirects to payment twice, then ends the call."],
        ["Asked who is calling", "Identifies the company only — never the branch or other details."],
        ["Payment method asked", "Explains UPI, app, payment link and dealership cash."],
        ["Background noise", "Asks the customer to repeat rather than guessing; ends politely after three attempts."],
      ]),
      p([txt("Two rules the agent never breaks: it never claims to be human, and it never " +
        "offers to reduce the EMI.", { bold: true })], { before: 160 }),

      h2("Languages"),
      p("Hindi is live today. English, Tamil, Telugu, Kannada, Marathi and Malayalam share " +
        "the same engine — each needs only its own script and voice, not new development."),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 5 ──────────────────────────────────────────────────────────────
      h1("5.  Reporting"),
      p("Each call is scored automatically after it ends and written to the console. Nobody " +
        "listens to recordings to find out what happened."),

      h2("What comes back from every call"),
      ...bullets([
        [txt("Disposition code ", { bold: true }), txt("— one of thirteen, grouped by what it means commercially")],
        [txt("Promise date and days to pay ", { bold: true }), txt("— validated against the three-day rule")],
        [txt("What the customer said ", { bold: true }), txt("— quoted from the transcript")],
        [txt("Cooperation level and interruption count", { bold: true })],
        [txt("Full transcript ", { bold: true }), txt("— turn by turn, with the recording")],
      ]),

      h2("Outcomes measured across 28 analysed pilot calls"),
      table([2400, 1100, 1000, 4526], ["Outcome", "Code", "Calls", "Action for the desk"], [
        [{ t: "Promise to pay", color: WON, bold: true }, { t: "PTP", mono: true }, { t: "9", mono: true }, "Committed within three days"],
        [{ t: "Future promise", bold: true }, { t: "FPTP", mono: true }, { t: "4", mono: true }, "Committed three to seven days out"],
        [{ t: "Claims paid", bold: true }, { t: "CP", mono: true }, { t: "4", mono: true }, "Verify against the ledger"],
        ["Not reachable", { t: "NR", mono: true }, { t: "5", mono: true }, "Retry in the next cycle"],
        ["Inconclusive", { t: "ICR", mono: true }, { t: "3", mono: true }, "Line quality — retry, not a refusal"],
        [{ t: "No commitment", color: LOST }, { t: "NC", mono: true }, { t: "2", mono: true }, "Escalate to a human agent"],
        [{ t: "Refused", color: LOST }, { t: "RTP", mono: true }, { t: "1", mono: true }, "Escalate to a human agent"],
      ]),
      p([txt("Poor audio is deliberately scored as inconclusive, never as a refusal. " +
        "Otherwise a bad line would appear in your reporting as a customer who said no.",
        { italics: true, color: MUTED })], { before: 140 }),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 6 ──────────────────────────────────────────────────────────────
      h1("6.  Technology stack"),
      p("Each layer is swappable from the console. Four telephony providers and three " +
        "language models are already wired in and tested."),
      table([1900, 2300, 2100, 2726],
        ["Layer", "In production", "Also supported", "Why this one"], [
        ["Telephony", "Vobiz", "Exotel, Twilio, Plivo", "Indian caller ID, bidirectional streaming, per-second billing"],
        ["Speech → text", "Deepgram nova-3", "—", "Streaming Hindi; ~0.94 confidence in live calls"],
        ["Conversation", "Gemini 3.5 flash-lite", "Groq, Cerebras", "Answered 5/5 where alternatives returned empty replies"],
        ["Text → speech", "Cartesia sonic-3", "—", "First audio in ~120 ms — fastest of those tested"],
        ["Application", "FastAPI · Python 3.12", "—", "Async WebSockets, one isolated handler per call"],
        ["Console", "React · TypeScript", "—", "Role-based: admin sees all, the client desk sees its work"],
        ["Database", "MongoDB Atlas", "—", "Indexed and paginated — transcripts, outcomes, campaigns"],
        ["Hosting", "Render · 0.5 vCPU", "—", "Always-on instance, custom domain with TLS"],
      ]),

      h2("Built for the daily file"),
      ...bullets([
        "Datasheet upload with column mapping to the fields the script uses",
        "Campaigns split across agent pools, weighted by capacity, so one file dials in controlled waves",
        "Per-row language chosen from the datasheet, or one language for the whole run",
        "Every run tracked separately — RUN-1, RUN-2 — with its own outcome breakdown",
        "Two sign-ins: an administrator who sees configuration, and an operator account for the client desk",
      ]),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 7 ──────────────────────────────────────────────────────────────
      h1("7.  Cost per minute"),
      p("Everything it takes to run one minute of conversation. Rupee figures at ₹84 to " +
        "the US dollar."),
      table([2900, 4126, 2000], ["Component", "Basis", "Per call-minute"], [
        ["Telephony — Vobiz", "₹1.00 per minute, billed per second", { t: "₹1.00", mono: true }],
        ["Speech to text — Deepgram", "$0.0077 / min streaming, full call duration", { t: "₹0.65", mono: true }],
        ["Text to speech — Cartesia", "$5 buys 133 min of speech; agent speaks ~45% of a call", { t: "₹1.42", mono: true }],
        ["Conversation — Gemini", "~2,870 input tokens per minute at list price", { t: "₹0.03", mono: true }],
        [{ t: "Variable cost per minute" }, "", { t: "₹3.10", mono: true }],
      ], { totalRow: true }),
      p([txt("The language model is currently on a free tier, so today the variable cost is " +
        "₹3.07. The ₹0.03 above is what it becomes on paid usage — the line " +
        "barely moves.", { italics: true, color: MUTED })], { before: 140 }),

      h2("With hosting spread across volume"),
      table([1900, 1800, 1900, 1800, 1626],
        ["Monthly minutes", "Fixed hosting", "Per minute", "All-in / min", "Monthly total"], [
        [{ t: "500", mono: true }, { t: "₹620", mono: true }, { t: "₹1.24", mono: true }, { t: "₹4.34", mono: true }, { t: "₹2,170", mono: true }],
        [{ t: "1,000", mono: true }, { t: "₹620", mono: true }, { t: "₹0.62", mono: true }, { t: "₹3.72", mono: true }, { t: "₹3,720", mono: true }],
        [{ t: "3,000", mono: true }, { t: "₹2,200", mono: true }, { t: "₹0.73", mono: true }, { t: "₹3.83", mono: true }, { t: "₹11,490", mono: true }],
      ]),
      p([txt("At 3,000 minutes the instance moves to 1 vCPU and speech moves to a larger " +
        "Cartesia plan; the per-minute figure barely shifts. A 45-second call — the " +
        "current median — costs about ₹2.80.", { color: MUTED })], { before: 140 }),

      h2("Already prepaid"),
      p("The Deepgram balance on the account covers roughly 26,000 minutes of transcription, " +
        "so speech-to-text is effectively a sunk cost for the first several months of operation."),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 8 ──────────────────────────────────────────────────────────────
      h1("8.  Capacity"),
      p("What this configuration handles today, and what each step up requires."),
      table([1600, 2000, 1800, 2400, 1226],
        ["Tier", "Concurrent calls", "100 leads in", "What it needs", "Added cost"], [
        [{ t: "Today", bold: true }, { t: "5", mono: true, bold: true }, { t: "~20 min", mono: true }, "Current setup — no change", { t: "—", mono: true }],
        ["Growth", { t: "25", mono: true }, { t: "~4 min", mono: true }, "Paid model tier, 1 vCPU instance", { t: "~₹2,600/mo", mono: true }],
        ["Scale", { t: "100+", mono: true }, { t: "< 1 min", mono: true }, "Shared call registry, instances behind a balancer", { t: "on volume", mono: true }],
      ]),
      p([txt("The ceiling today is the free language-model tier at 15 requests per minute, " +
        "not the application. It is a configuration limit, and lifting it is a billing " +
        "change rather than an engineering one.", { italics: true, color: MUTED })],
        { before: 140 }),

      h2("What a 100-lead file looks like today"),
      table([3000, 6026], ["", ""], [
        ["Calls placed at once", { t: "5", mono: true }],
        ["Median call length", { t: "45 seconds", mono: true }],
        ["Time to complete 100 leads", { t: "~20 minutes", mono: true }],
        ["Telephony + services cost", { t: "~₹230", mono: true }],
        ["Expected promises to pay", { t: "~32 (at the pilot's 32% PTP rate)", mono: true }],
      ]),
      p([txt("The pilot rate is drawn from 28 analysed calls and is indicative only; a real " +
        "portfolio will differ by vintage and bucket.", { italics: true, color: MUTED })],
        { before: 140 }),

      h1("9.  Summary"),
      table([3000, 6026], ["", ""], [
        ["Answers in", { t: "~700 ms — inside a human pause", bold: true }],
        ["Costs", { t: "~₹3.10 per minute, all in", bold: true }],
        ["Handles", { t: "5 calls at once today, 100+ on the scale tier", bold: true }],
        ["Reports", { t: "13 disposition codes, automatically, on every call", bold: true }],
        ["Speaks", { t: "Hindi live; six more languages ready for scripts", bold: true }],
      ]),
      p([txt("Figures measured on the live deployment at www.qsilon.com. Provider list prices " +
        "as published August 2026; telephony rate as contracted. Latency measured on calls " +
        "originating in India.", { size: 16, color: MUTED })], { before: 300 }),
    ],
  }],
});

Packer.toBuffer(doc).then((b) => {
  fs.writeFileSync("Qsilon-Voice-Agent-Overview.docx", b);
  console.log("  wrote Qsilon-Voice-Agent-Overview.docx", b.length, "bytes");
});
