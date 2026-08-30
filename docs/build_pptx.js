/**
 * Client deck for the Qsilon voice agent.
 *
 * Palette is drawn from the product's own console — deep ink-teal chrome with a signal
 * teal accent — so the deck and the software a client is about to be shown read as one
 * thing. Semantic colours for call outcomes are kept separate from the accent.
 *
 * Structure is a sandwich: dark title and closing, light content between.
 */
const pptx = require("pptxgenjs");

// ── palette ────────────────────────────────────────────────────────────────
const INK = "0E2A38";   // dominant — title, section and closing grounds
const INK_2 = "163B4C";
const TEAL = "17968F";  // accent, on dark
const TEAL_D = "0E6E6C"; // accent, on light
const PAPER = "FFFFFF";
const PAPER_2 = "F2F5F5";
const BODY = "24333D";
const MUTED = "6C7A85";
const MUTED_L = "9FB4BD";
const WON = "14735A";
const WON_BG = "E4F1EB";
const PEND = "9A5B08";
const PEND_BG = "F8EDDD";
const LOST = "A32F3C";
const LOST_BG = "F8E5E7";
const LINE = "DCE3E5";

const H = "Cambria";   // safe-list serif, gives titles weight
const B = "Calibri";   // safe-list sans for everything else

const p = new pptx();
p.layout = "LAYOUT_WIDE";           // 13.3 x 7.5
p.author = "Qsilon";
p.title = "Qsilon Voice Agent";

const W = 13.3, HT = 7.5, M = 0.7;

/** Section title on a light slide. */
function title(s, text, sub) {
  s.addText(text, {
    x: M, y: 0.46, w: W - M * 2, h: 0.62, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 34, bold: true, color: INK,
  });
  if (sub) {
    s.addText(sub, {
      x: M, y: 1.12, w: W - M * 2, h: 0.42, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 14, color: MUTED,
    });
  }
}

/** Small numbered chip that carries the section order. */
function chip(s, n) {
  s.addShape(p.ShapeType.ellipse, {
    x: W - M - 0.44, y: 0.5, w: 0.44, h: 0.44, fill: { color: PAPER_2 },
  });
  s.addText(n, {
    x: W - M - 0.44, y: 0.5, w: 0.44, h: 0.44, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, bold: true, color: TEAL_D,
    align: "center", valign: "middle",
  });
}

function lightSlide(n, t, sub) {
  const s = p.addSlide();
  s.background = { color: PAPER };
  title(s, t, sub);
  if (n) chip(s, n);
  return s;
}

/** Icon-free "card" — tinted block with a heading and body. */
function card(s, o) {
  s.addShape(p.ShapeType.roundRect, {
    x: o.x, y: o.y, w: o.w, h: o.h, rectRadius: 0.06,
    fill: { color: o.bg || PAPER_2 },
    line: { color: o.line || LINE, width: 0.75 },
  });
  s.addText(o.head, {
    x: o.x + 0.26, y: o.y + 0.2, w: o.w - 0.52, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 14, bold: true, color: o.headColor || INK,
  });
  s.addText(o.body, {
    x: o.x + 0.26, y: o.y + 0.54, w: o.w - 0.52, h: o.h - 0.74, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 11.5, color: MUTED, lineSpacing: 15,
  });
}

/** Big number with a caption underneath. */
function stat(s, o) {
  s.addText(o.n, {
    x: o.x, y: o.y, w: o.w, h: 0.72, isTextBox: true, margin: 0,
    fontFace: H, fontSize: o.size || 40, bold: true, color: o.color || INK,
    align: "center",
  });
  s.addText(o.l, {
    x: o.x, y: o.y + 0.74, w: o.w, h: 0.34, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 11.5, color: MUTED, align: "center",
  });
}

const th = (t) => ({
  text: t,
  options: { fill: { color: INK }, color: PAPER, bold: true, fontSize: 11.5, fontFace: B },
});

// ═══ 1 · title ═════════════════════════════════════════════════════════════
{
  const s = p.addSlide();
  s.background = { color: INK };
  s.addShape(p.ShapeType.ellipse, { x: 10.6, y: -1.5, w: 5.2, h: 5.2, fill: { color: INK_2 } });
  s.addShape(p.ShapeType.ellipse, { x: 11.9, y: 4.6, w: 3.4, h: 3.4, fill: { color: INK_2 } });

  s.addText("QSILON", {
    x: M, y: 1.5, w: 8, h: 0.36, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 15, bold: true, color: TEAL, charSpacing: 4,
  });
  s.addText("Conversational Collections", {
    x: M, y: 1.88, w: 8, h: 0.32, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, color: MUTED_L,
  });
  s.addText("An AI agent that calls,\nnegotiates and reports.", {
    x: M, y: 2.5, w: 9.4, h: 1.9, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 42, bold: true, color: PAPER, lineSpacing: 48,
  });
  s.addText(
    "A production Hindi voice agent for EMI recovery — at roughly three rupees a minute.",
    { x: M, y: 4.6, w: 9, h: 0.5, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 15, color: MUTED_L });

  [["~700 ms", "answers in"], ["₹3.10", "per minute"], ["13", "outcome codes"]]
    .forEach(([n, l], i) => {
      s.addText(n, {
        x: M + i * 2.5, y: 5.6, w: 2.2, h: 0.46, isTextBox: true, margin: 0,
        fontFace: H, fontSize: 24, bold: true, color: TEAL,
      });
      s.addText(l, {
        x: M + i * 2.5, y: 6.06, w: 2.2, h: 0.3, isTextBox: true, margin: 0,
        fontFace: B, fontSize: 11, color: MUTED_L,
      });
    });
  s.addNotes("Live on www.qsilon.com. Every figure in this deck is measured on the running system.");
}

// ═══ 2 · what this is ══════════════════════════════════════════════════════
{
  const s = lightSlide("01", "What this is",
    "Not a recorded IVR. The customer speaks naturally and the agent negotiates within the policy it has been given.");
  const items = [
    ["It negotiates", "A promise beyond three days triggers a three-step negotiation — overdue reminder, credit-score consequence, then a firm close."],
    ["It reports", "Every call is scored into one of thirteen disposition codes, with the promise date and a quote of what the customer said."],
    ["It survives real conditions", "Traffic, shops, a television in the room, a customer talking over the agent — the conversation does not break down."],
  ];
  items.forEach(([hd, bd], i) => {
    const y = 1.95 + i * 1.62;
    s.addShape(p.ShapeType.ellipse, { x: M, y: y, w: 0.62, h: 0.62, fill: { color: TEAL_D } });
    s.addText(String(i + 1), {
      x: M, y: y, w: 0.62, h: 0.62, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 17, bold: true, color: PAPER, align: "center", valign: "middle",
    });
    s.addText(hd, {
      x: M + 0.95, y: y + 0.02, w: 10.8, h: 0.34, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 18, bold: true, color: INK,
    });
    s.addText(bd, {
      x: M + 0.95, y: y + 0.42, w: 10.8, h: 0.72, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 13, color: MUTED, lineSpacing: 18,
    });
  });
}

// ═══ 3 · where it stands ═══════════════════════════════════════════════════
{
  const s = lightSlide("02", "Where it stands today", "Measured on the live deployment, not projected.");
  const row1 = [["~700ms", "Reply latency"], ["129ms", "Greeting starts"], ["45s", "Median call"], ["7", "Turns per call"]];
  const row2 = [["7", "Languages ready"], ["14/14", "Scenarios passing"], ["13", "Disposition codes"], ["5", "Concurrent calls"]];
  [row1, row2].forEach((row, r) => {
    row.forEach(([n, l], i) => {
      const x = M + i * 3.02, y = 2.0 + r * 1.85;
      s.addShape(p.ShapeType.roundRect, {
        x, y, w: 2.78, h: 1.5, rectRadius: 0.06,
        fill: { color: PAPER_2 }, line: { color: LINE, width: 0.75 },
      });
      stat(s, { x, y: y + 0.24, w: 2.78, n, l, size: 32, color: r ? INK : TEAL_D });
    });
  });
  s.addText("A human pause on a phone call is 500–800 ms. At ~700 ms the agent answers inside that window.", {
    x: M, y: 5.95, w: W - M * 2, h: 0.4, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12.5, italic: true, color: MUTED,
  });
}

// ═══ 4 · architecture ══════════════════════════════════════════════════════
{
  const s = lightSlide("03", "Architecture",
    "Audio streams both ways over one WebSocket. No stage waits for the previous one to finish.");

  const boxes = [
    ["Customer", "mobile", 0.7], ["Vobiz", "PSTN · SIP", 3.55],
    ["Qsilon Agent", "FastAPI · Render", 6.4], ["Console", "React · operator", 9.95],
  ];
  boxes.forEach(([t, sub, x], i) => {
    const wid = i === 2 ? 2.95 : 2.35;
    const core = i === 2;
    s.addShape(p.ShapeType.roundRect, {
      x, y: 2.0, w: wid, h: 1.15, rectRadius: 0.06,
      fill: { color: core ? INK : PAPER_2 },
      line: { color: core ? INK : LINE, width: 0.75 },
    });
    s.addText(t, {
      x, y: 2.24, w: wid, h: 0.32, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 14.5, bold: true, color: core ? PAPER : INK, align: "center",
    });
    s.addText(sub, {
      x, y: 2.58, w: wid, h: 0.3, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 10.5, color: core ? MUTED_L : MUTED, align: "center",
    });
  });
  [3.12, 5.97, 9.5].forEach((x) => {
    s.addText("▶", {
      x, y: 2.36, w: 0.4, h: 0.4, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 14, color: TEAL_D, align: "center",
    });
  });

  s.addText("The agent calls three services on every turn", {
    x: M, y: 3.55, w: 8, h: 0.32, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, bold: true, color: MUTED,
  });
  [["Deepgram", "speech → text", "~300 ms"], ["Gemini", "decides the reply", "~560 ms"],
   ["Cartesia", "text → speech", "~120 ms"]].forEach(([t, sub, ms], i) => {
    const x = M + i * 4.0;
    s.addShape(p.ShapeType.roundRect, {
      x, y: 3.98, w: 3.7, h: 1.3, rectRadius: 0.06,
      fill: { color: PAPER_2 }, line: { color: LINE, width: 0.75 },
    });
    s.addText(t, {
      x: x + 0.25, y: 4.16, w: 3.2, h: 0.3, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 14, bold: true, color: INK,
    });
    s.addText(sub, {
      x: x + 0.25, y: 4.48, w: 3.2, h: 0.28, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 11, color: MUTED,
    });
    s.addText(ms, {
      x: x + 0.25, y: 4.78, w: 3.2, h: 0.3, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 12, bold: true, color: TEAL_D,
    });
  });

  s.addText("Everything to the right of the agent is a stateless API call — any provider can be swapped from the console without a code change.", {
    x: M, y: 5.55, w: W - M * 2, h: 0.4, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12.5, italic: true, color: MUTED,
  });
}

// ═══ 5 · one turn ══════════════════════════════════════════════════════════
{
  const s = lightSlide("04", "One turn, end to end",
    "Between the customer finishing a sentence and hearing a reply.");
  s.addTable([
    [th("Step"), th("What happens"), th("Elapsed")],
    ["1", "Customer speaks — audio streams to Deepgram while they are still talking", "0 ms"],
    ["2", "Deepgram marks the sentence complete and returns the transcript", "~300 ms"],
    ["3", "Noise filter drops coughs, traffic and television before the model sees them", "< 1 ms"],
    ["4", "Gemini reads the script and the conversation, and decides the reply", "~560 ms"],
    ["5", "Cartesia begins speaking — audio is sent as generated, not after", "~120 ms"],
    [{ text: "", options: { fill: { color: WON_BG } } },
     { text: "Customer hears the reply", options: { bold: true, fill: { color: WON_BG }, color: WON } },
     { text: "~700 ms", options: { bold: true, fill: { color: WON_BG }, color: WON } }],
  ], {
    x: M, y: 1.85, w: W - M * 2, colW: [0.9, 8.9, 2.1],
    fontFace: B, fontSize: 12, color: BODY, border: { type: "solid", color: LINE, pt: 0.75 },
    rowH: 0.42, valign: "middle",
  });
  s.addText("If the customer talks over the agent, it stops within 160 ms and answers what they actually said. If that interruption produces nothing usable, it re-invites them rather than going silent.", {
    x: M, y: 5.45, w: W - M * 2, h: 0.7, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12.5, italic: true, color: MUTED, lineSpacing: 18,
  });
}

// ═══ 6 · capabilities ══════════════════════════════════════════════════════
{
  const s = lightSlide("05", "What the agent handles", "14 of 14 scenarios verified against the live model.");
  const cards = [
    ["Negotiates", "Three-step escalation when the promise falls beyond three days."],
    ["Hard conversations", "Illness, bereavement, job loss, anger — empathy, then a polite close."],
    ["Survives noise", "Calibrates to each line and never answers a sound it did not understand."],
    ["Stays on topic", "Redirects twice, then ends the call."],
    ["Two hard rules", "Never claims to be human. Never offers to reduce the EMI."],
    ["Seven languages", "Hindi live; six more share the same engine and need only a script."],
  ];
  cards.forEach(([hd, bd], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    card(s, { x: M + col * 4.0, y: 1.95 + row * 1.95, w: 3.7, h: 1.72, head: hd, body: bd });
  });
}

// ═══ 7 · reporting ═════════════════════════════════════════════════════════
{
  const s = lightSlide("06", "What comes back from every call",
    "Scored automatically after the call ends. Nobody listens to recordings to find out what happened.");
  s.addChart(p.ChartType.bar, [{
    name: "Calls", labels: ["PTP", "NR", "FPTP", "CP", "ICR", "NC", "RTP"],
    values: [9, 5, 4, 4, 3, 2, 1],
  }], {
    x: M, y: 1.9, w: 6.3, h: 3.9,
    barDir: "col", chartColors: [TEAL_D],
    showTitle: true, title: "Outcomes across 28 pilot calls",
    titleFontFace: B, titleFontSize: 13, titleColor: INK,
    showValue: true, dataLabelPosition: "outEnd",
    dataLabelFontFace: B, dataLabelFontSize: 11, dataLabelColor: BODY,
    catAxisLabelFontFace: B, catAxisLabelFontSize: 11, catAxisLabelColor: MUTED,
    valAxisLabelFontFace: B, valAxisLabelFontSize: 10, valAxisLabelColor: MUTED,
    valGridLine: { color: LINE, size: 0.75 }, catGridLine: { style: "none" },
    showLegend: false, barGapWidthPct: 45,
  });
  const detail = [
    ["Disposition code", "One of thirteen, grouped by commercial meaning"],
    ["Promise date", "Validated against the three-day rule"],
    ["Customer's words", "Quoted directly from the transcript"],
    ["Cooperation", "Plus the real interruption count"],
    ["Full transcript", "Turn by turn, with the recording"],
  ];
  detail.forEach(([hd, bd], i) => {
    const y = 2.15 + i * 0.72;
    s.addText(hd, {
      x: 7.4, y, w: 5.2, h: 0.28, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 13, bold: true, color: INK,
    });
    s.addText(bd, {
      x: 7.4, y: y + 0.28, w: 5.2, h: 0.3, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 11.5, color: MUTED,
    });
  });
  s.addText("Poor audio is scored as inconclusive, never as a refusal — otherwise a bad line appears in your reporting as a customer who said no.", {
    x: M, y: 6.0, w: W - M * 2, h: 0.42, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12.5, italic: true, color: MUTED,
  });
}

// ═══ 8 · stack ═════════════════════════════════════════════════════════════
{
  const s = lightSlide("07", "Technology stack",
    "Four telephony providers and three language models are already wired in and tested.");
  s.addTable([
    [th("Layer"), th("In production"), th("Also supported"), th("Why this one")],
    ["Telephony", "Vobiz", "Exotel, Twilio, Plivo", "Indian caller ID, per-second billing"],
    ["Speech → text", "Deepgram nova-3", "—", "Streaming Hindi, ~0.94 confidence live"],
    ["Conversation", "Gemini 3.5 flash-lite", "Groq, Cerebras", "5/5 where alternatives returned empty"],
    ["Text → speech", "Cartesia sonic-3", "—", "First audio in ~120 ms"],
    ["Application", "FastAPI · Python 3.12", "—", "One isolated handler per call"],
    ["Console", "React · TypeScript", "—", "Admin and client-desk roles"],
    ["Database", "MongoDB Atlas", "—", "Indexed, paginated"],
    ["Hosting", "Render · 0.5 vCPU", "—", "Always-on, custom domain, TLS"],
  ], {
    x: M, y: 1.85, w: W - M * 2, colW: [2.1, 2.9, 2.6, 4.3],
    fontFace: B, fontSize: 11.5, color: BODY,
    border: { type: "solid", color: LINE, pt: 0.75 }, rowH: 0.42, valign: "middle",
  });
}

// ═══ 9 · cost ══════════════════════════════════════════════════════════════
{
  const s = lightSlide("08", "Cost per minute", "Everything it takes to run one minute of conversation. ₹84 to the dollar.");
  s.addTable([
    [th("Component"), th("Basis"), th("Per call-minute")],
    ["Telephony — Vobiz", "₹1.00 / min, billed per second", "₹1.00"],
    ["Speech to text — Deepgram", "$0.0077 / min streaming", "₹0.65"],
    ["Text to speech — Cartesia", "$5 buys 133 min; agent speaks ~45%", "₹1.42"],
    ["Conversation — Gemini", "~2,870 input tokens / min at list price", "₹0.03"],
    [{ text: "Variable cost", options: { bold: true, fill: { color: WON_BG } } },
     { text: "", options: { fill: { color: WON_BG } } },
     { text: "₹3.10", options: { bold: true, fill: { color: WON_BG }, color: WON } }],
  ], {
    x: M, y: 1.85, w: 7.5, colW: [2.9, 3.3, 1.3],
    fontFace: B, fontSize: 11.5, color: BODY,
    border: { type: "solid", color: LINE, pt: 0.75 }, rowH: 0.44, valign: "middle",
  });

  s.addShape(p.ShapeType.roundRect, {
    x: 8.6, y: 1.85, w: 4.0, h: 2.15, rectRadius: 0.06,
    fill: { color: INK }, line: { color: INK, width: 0.75 },
  });
  s.addText("₹2.80", {
    x: 8.6, y: 2.18, w: 4.0, h: 0.8, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 44, bold: true, color: TEAL, align: "center",
  });
  s.addText("a typical 45-second call", {
    x: 8.6, y: 3.02, w: 4.0, h: 0.34, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12.5, color: MUTED_L, align: "center",
  });
  s.addText("The language model is the cheapest part — three paise.", {
    x: 8.6, y: 3.36, w: 4.0, h: 0.4, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 10.5, color: MUTED_L, align: "center",
  });

  s.addText("With hosting spread across volume", {
    x: M, y: 4.55, w: 8, h: 0.3, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 13, bold: true, color: INK,
  });
  s.addTable([
    [th("Monthly minutes"), th("Fixed hosting"), th("All-in / minute"), th("Monthly total")],
    ["500", "₹620", "₹4.34", "₹2,170"],
    ["1,000", "₹620", "₹3.72", "₹3,720"],
    ["3,000", "₹2,200", "₹3.83", "₹11,490"],
  ], {
    x: M, y: 4.95, w: W - M * 2, colW: [2.98, 2.98, 2.97, 2.97],
    fontFace: B, fontSize: 11.5, color: BODY,
    border: { type: "solid", color: LINE, pt: 0.75 }, rowH: 0.4, valign: "middle",
  });
  s.addNotes("Deepgram balance on the account already covers ~26,000 minutes, so speech-to-text is a sunk cost for the first several months.");
}

// ═══ 10 · capacity ═════════════════════════════════════════════════════════
{
  const s = lightSlide("09", "Capacity", "What this configuration handles today, and what each step up needs.");
  s.addTable([
    [th("Tier"), th("Concurrent"), th("100 leads in"), th("What it needs"), th("Added cost")],
    [{ text: "Today", options: { bold: true } }, { text: "5", options: { bold: true, color: TEAL_D } },
      "~20 min", "Current setup — no change", "—"],
    ["Growth", "25", "~4 min", "Paid model tier, 1 vCPU instance", "~₹2,600/mo"],
    ["Scale", "100+", "< 1 min", "Shared registry, instances behind a balancer", "on volume"],
  ], {
    x: M, y: 1.85, w: W - M * 2, colW: [1.7, 1.8, 2.0, 4.5, 1.9],
    fontFace: B, fontSize: 11.5, color: BODY,
    border: { type: "solid", color: LINE, pt: 0.75 }, rowH: 0.5, valign: "middle",
  });
  s.addText("A 100-lead file today", {
    x: M, y: 3.85, w: 8, h: 0.32, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 14, bold: true, color: INK,
  });
  [["~20 min", "to complete"], ["~₹230", "total cost"], ["~32", "promises to pay"]]
    .forEach(([n, l], i) => {
      const x = M + i * 4.0;
      s.addShape(p.ShapeType.roundRect, {
        x, y: 4.3, w: 3.7, h: 1.3, rectRadius: 0.06,
        fill: { color: PAPER_2 }, line: { color: LINE, width: 0.75 },
      });
      stat(s, { x, y: 4.5, w: 3.7, n, l, size: 28, color: TEAL_D });
    });
  s.addText("The ceiling today is the free model tier at 15 requests a minute — a billing change, not an engineering one. PTP rate drawn from 28 pilot calls and indicative only.", {
    x: M, y: 5.8, w: W - M * 2, h: 0.6, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 12, italic: true, color: MUTED, lineSpacing: 17,
  });
}

// ═══ 11 · summary ══════════════════════════════════════════════════════════
{
  const s = p.addSlide();
  s.background = { color: INK };
  s.addShape(p.ShapeType.ellipse, { x: -1.8, y: 4.4, w: 4.6, h: 4.6, fill: { color: INK_2 } });

  s.addText("In summary", {
    x: M, y: 0.9, w: 8, h: 0.7, isTextBox: true, margin: 0,
    fontFace: H, fontSize: 34, bold: true, color: PAPER,
  });
  const rows = [
    ["Answers in", "~700 ms — inside a human pause"],
    ["Costs", "~₹3.10 per minute, all in"],
    ["Handles", "5 calls at once today, 100+ on the scale tier"],
    ["Reports", "13 disposition codes, automatically, on every call"],
    ["Speaks", "Hindi live; six more languages ready for scripts"],
  ];
  rows.forEach(([k, v], i) => {
    const y = 2.1 + i * 0.78;
    s.addText(k, {
      x: M, y, w: 2.6, h: 0.36, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 13, color: MUTED_L,
    });
    s.addText(v, {
      x: M + 2.8, y: y - 0.04, w: 9.2, h: 0.42, isTextBox: true, margin: 0,
      fontFace: B, fontSize: 17, bold: true, color: PAPER,
    });
  });
  s.addText("www.qsilon.com   ·   Figures measured on the live deployment, August 2026", {
    x: M, y: 6.5, w: 11, h: 0.34, isTextBox: true, margin: 0,
    fontFace: B, fontSize: 11.5, color: MUTED_L,
  });
}

p.writeFile({ fileName: "Qsilon-Voice-Agent.pptx" })
  .then((f) => console.log("  wrote", f));
