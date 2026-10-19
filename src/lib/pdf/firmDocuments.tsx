/**
 * Server-side PDF documents (invoices and quotations).
 * One design for the browser preview and for emailed attachments.
 * Uses only built-in PDF fonts and a locally generated UPI QR code (no outside calls).
 */
import React from "react";
import { Document, Font, Image, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";

// Never split words with hyphens (keeps names and addresses intact)
Font.registerHyphenationCallback((word) => [word]);

type Rec = Record<string, any> | null | undefined;

const C = {
  navy: "#10233f",
  navyDark: "#08182d",
  navyMid: "#17345b",
  blue: "#2563eb",
  lightBlue: "#eff6ff",
  pale: "#f7faff",
  border: "#dbe3ec",
  muted: "#64748b",
  text: "#1e293b",
  light: "#f8fafc",
  white: "#ffffff",
  green: "#166534",
  greenBg: "#f0fdf4",
  amber: "#92400e",
  amberBg: "#fffbeb",
  red: "#b91c1c",
};

const GST_STATES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand",
  "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim",
  "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya",
  "18": "Assam", "19": "West Bengal", "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh",
  "24": "Gujarat", "26": "Dadra & Nagar Haveli and Daman & Diu", "27": "Maharashtra", "29": "Karnataka", "30": "Goa",
  "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry", "35": "Andaman & Nicobar Islands",
  "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", backgroundColor: C.white, color: C.text, paddingBottom: 36 },
  watermark: {
    position: "absolute", top: 330, left: 0, right: 0, textAlign: "center",
    fontSize: 90, fontFamily: "Helvetica-Bold", color: "#e2e8f0", transform: "rotate(-30deg)",
  },
  header: { backgroundColor: C.navy, paddingHorizontal: 44, paddingTop: 26, paddingBottom: 22, flexDirection: "row", justifyContent: "space-between" },
  company: { width: "58%" },
  brand: { color: C.white, fontSize: 19, fontFamily: "Helvetica-Bold", letterSpacing: 0.5 },
  accent: { width: 42, height: 2, backgroundColor: "#60a5fa", marginTop: 6, marginBottom: 6 },
  companyText: { color: "#cbd5e1", fontSize: 7.8, lineHeight: 1.4 },
  companyMeta: { color: "#94a3b8", fontSize: 7.3, marginTop: 5, lineHeight: 1.4 },
  docSide: { width: "42%", alignItems: "flex-end" },
  badge: { backgroundColor: C.navyMid, borderWidth: 1, borderColor: "#31567f", paddingVertical: 3, paddingHorizontal: 8, borderRadius: 3 },
  badgeText: { color: "#bfdbfe", fontSize: 7, fontFamily: "Helvetica-Bold", letterSpacing: 1 },
  title: { color: C.white, fontSize: 19, fontFamily: "Helvetica-Bold", marginTop: 7 },
  docNo: { color: "#dbeafe", fontSize: 8.5, marginTop: 4 },
  docDate: { color: "#94a3b8", fontSize: 7.8, marginTop: 3 },

  infoWrap: { marginHorizontal: 44, marginTop: 18, flexDirection: "row", justifyContent: "space-between" },
  party: { width: "60%", backgroundColor: C.light, borderWidth: 1, borderColor: C.border, borderRadius: 5, padding: 12 },
  meta: { width: "37%", backgroundColor: C.lightBlue, borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 5, padding: 12 },
  label: { color: C.blue, fontSize: 7.2, fontFamily: "Helvetica-Bold", letterSpacing: 0.9, marginBottom: 6 },
  partyName: { color: C.navyDark, fontSize: 12, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  partyText: { color: "#475569", fontSize: 7.8, marginTop: 2, lineHeight: 1.35 },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  metaLabel: { color: C.muted, fontSize: 7.4 },
  metaValue: { color: C.navy, fontSize: 7.4, fontFamily: "Helvetica-Bold", textAlign: "right", maxWidth: "60%" },

  table: { marginHorizontal: 44, marginTop: 18 },
  th: { flexDirection: "row", backgroundColor: C.navy, paddingVertical: 7, paddingHorizontal: 9, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  thText: { color: C.white, fontSize: 7.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.3 },
  tr: { flexDirection: "row", paddingVertical: 7, paddingHorizontal: 9, borderBottomWidth: 1, borderBottomColor: C.border, minHeight: 26 },
  trAlt: { flexDirection: "row", paddingVertical: 7, paddingHorizontal: 9, borderBottomWidth: 1, borderBottomColor: C.border, minHeight: 26, backgroundColor: C.light },
  cNo: { width: "7%" },
  cDesc: { width: "48%" },
  cQty: { width: "11%", textAlign: "right" },
  cRate: { width: "17%", textAlign: "right" },
  cAmt: { width: "17%", textAlign: "right" },
  tdMuted: { color: C.muted, fontSize: 7.8 },
  td: { color: C.text, fontSize: 8, lineHeight: 1.3 },
  tdNum: { color: C.text, fontSize: 8, textAlign: "right" },

  lower: { marginHorizontal: 44, marginTop: 16, flexDirection: "row", justifyContent: "space-between" },
  left: { width: "56%" },
  box: { backgroundColor: C.light, borderWidth: 1, borderColor: C.border, borderRadius: 5, padding: 9, marginBottom: 8 },
  boxPale: { backgroundColor: C.pale, borderWidth: 1, borderColor: "#dbeafe", borderRadius: 5, padding: 9, marginBottom: 8 },
  boxTitle: { color: C.navy, fontSize: 7.8, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  boxText: { color: "#475569", fontSize: 7.4, marginTop: 1.5, lineHeight: 1.35 },
  words: { color: C.navy, fontSize: 7.8, fontFamily: "Helvetica-Bold", lineHeight: 1.4 },
  qrBox: { flexDirection: "row", alignItems: "center", backgroundColor: C.lightBlue, borderWidth: 1, borderColor: "#bfdbfe", borderRadius: 5, padding: 8 },
  qr: { width: 62, height: 62, marginRight: 10 },
  qrInfo: { flex: 1 },

  totals: { width: "40%" },
  totRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  totLabel: { color: "#475569", fontSize: 8 },
  totValue: { color: C.text, fontSize: 8, textAlign: "right" },
  grand: { marginTop: 5, backgroundColor: C.navy, borderRadius: 4, paddingVertical: 8, paddingHorizontal: 9, flexDirection: "row", justifyContent: "space-between" },
  grandLabel: { color: C.white, fontSize: 8.8, fontFamily: "Helvetica-Bold" },
  grandValue: { color: C.white, fontSize: 10, fontFamily: "Helvetica-Bold" },
  paid: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4, marginTop: 3, borderTopWidth: 1, borderTopColor: C.border },
  paidText: { color: C.green, fontSize: 8, fontFamily: "Helvetica-Bold" },
  due: { marginTop: 5, backgroundColor: C.amberBg, borderWidth: 1, borderColor: "#fde68a", borderRadius: 4, paddingVertical: 6, paddingHorizontal: 9, flexDirection: "row", justifyContent: "space-between" },
  dueText: { color: C.amber, fontSize: 8.4, fontFamily: "Helvetica-Bold" },
  settled: { marginTop: 5, backgroundColor: C.greenBg, borderWidth: 1, borderColor: "#bbf7d0", borderRadius: 4, paddingVertical: 6, paddingHorizontal: 9, flexDirection: "row", justifyContent: "space-between" },

  footer: { marginHorizontal: 44, marginTop: 18, paddingTop: 9, borderTopWidth: 1, borderTopColor: C.border, flexDirection: "row", justifyContent: "space-between" },
  footLeft: { width: "62%" },
  footRight: { width: "34%", alignItems: "flex-end" },
  thanks: { color: C.navy, fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  footText: { color: C.muted, fontSize: 7, lineHeight: 1.35 },
  signFirm: { color: C.navy, fontSize: 7.8, fontFamily: "Helvetica-Bold", textAlign: "right" },
  signText: { color: C.muted, fontSize: 7, marginTop: 18, textAlign: "right" },
  pageNo: { position: "absolute", bottom: 14, right: 44, fontSize: 7, color: C.muted },
});

/* ---------------- Helpers ---------------- */

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const money = (n: number) => `Rs. ${num(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function date(v?: string | null): string {
  if (!v) return "-";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleDateString("en-IN");
}

function words(amount: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n: number) => (n < 20 ? ones[n] : `${tens[Math.floor(n / 10)]}${n % 10 ? " " + ones[n % 10] : ""}`);
  const three = (n: number) => [n >= 100 ? `${ones[Math.floor(n / 100)]} Hundred` : "", n % 100 ? two(n % 100) : ""].filter(Boolean).join(" ");
  const indian = (n: number): string => {
    if (n === 0) return "Zero";
    const parts: string[] = [];
    const crore = Math.floor(n / 10000000);
    n %= 10000000;
    const lakh = Math.floor(n / 100000);
    n %= 100000;
    const thousand = Math.floor(n / 1000);
    n %= 1000;
    if (crore) parts.push(`${indian(crore)} Crore`);
    if (lakh) parts.push(`${two(lakh)} Lakh`);
    if (thousand) parts.push(`${two(thousand)} Thousand`);
    if (n) parts.push(three(n));
    return parts.join(" ");
  };
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  return `${indian(rupees)} Rupees${paise ? ` and ${two(paise)} Paise` : ""} Only`;
}

function lineItems(raw: unknown) {
  return (Array.isArray(raw) ? raw : []).map((it: any) => ({
    description: str(it?.description ?? it?.desc) || "Professional Services",
    qty: num(it?.qty ?? 1) || 1,
    rate: num(it?.rate ?? it?.price),
  }));
}

/** Prefer the totals the database calculated; fall back to computing them. */
function taxes(doc: Rec) {
  const items = lineItems(doc?.items);
  const inter = Boolean(doc?.is_inter_state ?? doc?.isInterState);
  const rate = num(doc?.gst_rate ?? doc?.gstRate ?? 18);
  const computedSub = Math.round(items.reduce((sum, i) => sum + i.qty * i.rate, 0) * 100) / 100;
  const subtotal = num(doc?.subtotal) || computedSub;
  let cgst = num(doc?.cgst);
  let sgst = num(doc?.sgst);
  let igst = num(doc?.igst);
  if (!cgst && !sgst && !igst && rate > 0) {
    if (inter) igst = Math.round(subtotal * rate) / 100;
    else cgst = sgst = Math.round((subtotal * rate) / 2) / 100;
  }
  const total = num(doc?.total) || Math.round((subtotal + cgst + sgst + igst) * 100) / 100;
  return { items, inter, rate, subtotal, cgst, sgst, igst, total };
}

function placeOfSupply(client: Rec): string {
  const code = str(client?.gstin).slice(0, 2);
  if (GST_STATES[code]) return `${GST_STATES[code]} (${code})`;
  return str(client?.state) || "-";
}

/* ---------------- Shared blocks ---------------- */

function Header({ firm, badge, title, number, issued }: { firm: Rec; badge: string; title: string; number: string; issued: string }) {
  const firmName = str(firm?.firm_name) || "Your Firm";
  return (
    <View style={s.header} fixed>
      <View style={s.company}>
        <Text style={[s.brand, firmName.length > 24 ? { fontSize: 15 } : {}]}>{firmName.toUpperCase()}</Text>
        <View style={s.accent} />
        {firm?.address ? <Text style={s.companyText}>{str(firm.address)}</Text> : null}
        <Text style={s.companyMeta}>
          {[firm?.gstin ? `GSTIN: ${str(firm.gstin)}` : "", firm?.pan ? `PAN: ${str(firm.pan)}` : ""].filter(Boolean).join("   |   ")}
        </Text>
        {firm?.email || firm?.phone ? <Text style={s.companyMeta}>{[str(firm?.email), str(firm?.phone)].filter(Boolean).join("   |   ")}</Text> : null}
      </View>
      <View style={s.docSide}>
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.docNo}>No. {number || "-"}</Text>
        <Text style={s.docDate}>Date: {issued}</Text>
      </View>
    </View>
  );
}

function Party({ heading, client, fallbackName, organisation, email }: { heading: string; client: Rec; fallbackName: string; organisation?: string; email?: string }) {
  const org = str(client?.organization_name) || str(organisation);
  const person = str(client?.name) || fallbackName;
  return (
    <View style={s.party}>
      <Text style={s.label}>{heading}</Text>
      <Text style={s.partyName}>{org || person || "Valued Client"}</Text>
      {org && person && org !== person ? <Text style={s.partyText}>Attn: {person}</Text> : null}
      {client?.address ? <Text style={s.partyText}>{str(client.address)}</Text> : null}
      {client?.gstin ? <Text style={s.partyText}>GSTIN: {str(client.gstin)}</Text> : null}
      {!client?.gstin && client?.pan ? <Text style={s.partyText}>PAN: {str(client.pan)}</Text> : null}
      {email || client?.email ? <Text style={s.partyText}>Email: {str(email || client?.email)}</Text> : null}
    </View>
  );
}

function Items({ items }: { items: { description: string; qty: number; rate: number }[] }) {
  return (
    <View style={s.table}>
      <View style={s.th} fixed>
        <Text style={[s.thText, s.cNo]}>#</Text>
        <Text style={[s.thText, s.cDesc]}>DESCRIPTION OF SERVICES</Text>
        <Text style={[s.thText, s.cQty]}>QTY</Text>
        <Text style={[s.thText, s.cRate]}>RATE</Text>
        <Text style={[s.thText, s.cAmt]}>AMOUNT</Text>
      </View>
      {items.length === 0 ? (
        <View style={s.tr}>
          <Text style={s.tdMuted}>No line items.</Text>
        </View>
      ) : (
        items.map((it, i) => (
          <View key={i} wrap={false} style={i % 2 ? s.trAlt : s.tr}>
            <Text style={[s.tdMuted, s.cNo]}>{i + 1}</Text>
            <Text style={[s.td, s.cDesc]}>{it.description}</Text>
            <Text style={[s.tdNum, s.cQty]}>{it.qty}</Text>
            <Text style={[s.tdNum, s.cRate]}>{money(it.rate)}</Text>
            <Text style={[s.tdNum, s.cAmt]}>{money(it.qty * it.rate)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

function TaxRows({ t }: { t: ReturnType<typeof taxes> }) {
  return (
    <>
      <View style={s.totRow}>
        <Text style={s.totLabel}>Subtotal</Text>
        <Text style={s.totValue}>{money(t.subtotal)}</Text>
      </View>
      {t.inter ? (
        <View style={s.totRow}>
          <Text style={s.totLabel}>IGST ({t.rate}%)</Text>
          <Text style={s.totValue}>{money(t.igst)}</Text>
        </View>
      ) : (
        <>
          <View style={s.totRow}>
            <Text style={s.totLabel}>CGST ({t.rate / 2}%)</Text>
            <Text style={s.totValue}>{money(t.cgst)}</Text>
          </View>
          <View style={s.totRow}>
            <Text style={s.totLabel}>SGST ({t.rate / 2}%)</Text>
            <Text style={s.totValue}>{money(t.sgst)}</Text>
          </View>
        </>
      )}
    </>
  );
}

function Footer({ firm, thanks, note }: { firm: Rec; thanks: string; note: string }) {
  return (
    <>
      <View style={s.footer} wrap={false}>
        <View style={s.footLeft}>
          <Text style={s.thanks}>{thanks}</Text>
          <Text style={s.footText}>{note}</Text>
        </View>
        <View style={s.footRight}>
          <Text style={s.signFirm}>For {str(firm?.firm_name) || "the Firm"}</Text>
          <Text style={s.signText}>Authorised Signatory</Text>
        </View>
      </View>
      <Text style={s.pageNo} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
    </>
  );
}

/* ---------------- Invoice ---------------- */

export function InvoicePdf({ invoice, client, firm, qrDataUrl }: { invoice: Rec; client: Rec; firm: Rec; qrDataUrl?: string | null }) {
  const t = taxes(invoice);
  const status = str(invoice?.status);
  const paid = Math.min(Math.max(0, num(invoice?.amount_paid ?? invoice?.amountPaid)), t.total);
  const balance = status === "Cancelled" ? 0 : Math.max(0, Math.round((t.total - paid) * 100) / 100);
  const issued = date(invoice?.date || invoice?.issue_date || invoice?.created_at);

  return (
    <Document title={`Invoice ${str(invoice?.invoice_number)}`} author={str(firm?.firm_name)} subject="Tax Invoice">
      <Page size="A4" style={s.page}>
        {status === "Cancelled" ? <Text style={s.watermark} fixed>CANCELLED</Text> : status === "Draft" ? <Text style={s.watermark} fixed>DRAFT</Text> : null}
        <Header firm={firm} badge="TAX DOCUMENT" title="TAX INVOICE" number={str(invoice?.invoice_number)} issued={issued} />

        <View style={s.infoWrap}>
          <Party heading="BILL TO" client={client} fallbackName="" organisation={str(invoice?.organisation)} />
          <View style={s.meta}>
            <Text style={s.label}>INVOICE DETAILS</Text>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Invoice Date</Text>
              <Text style={s.metaValue}>{issued}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Due Date</Text>
              <Text style={s.metaValue}>{date(invoice?.due_date || invoice?.dueDate)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Place of Supply</Text>
              <Text style={s.metaValue}>{placeOfSupply(client)}</Text>
            </View>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Tax Type</Text>
              <Text style={s.metaValue}>{t.inter ? "IGST" : "CGST + SGST"}</Text>
            </View>
          </View>
        </View>

        <Items items={t.items} />

        <View style={s.lower} wrap={false}>
          <View style={s.left}>
            <View style={s.box}>
              <Text style={s.boxTitle}>NOTES & PAYMENT TERMS</Text>
              <Text style={s.boxText}>{str(invoice?.notes) || "Thank you for your business. Please pay by the due date."}</Text>
            </View>
            <View style={s.boxPale}>
              <Text style={s.boxTitle}>AMOUNT IN WORDS</Text>
              <Text style={s.words}>{words(t.total)}</Text>
            </View>
            {balance > 0 && (qrDataUrl || firm?.bank_account_no) ? (
              <View style={s.qrBox}>
                {qrDataUrl ? <Image style={s.qr} src={qrDataUrl} /> : null}
                <View style={s.qrInfo}>
                  <Text style={s.boxTitle}>{qrDataUrl ? "SCAN TO PAY VIA UPI" : "PAYMENT DETAILS"}</Text>
                  <Text style={s.boxText}>Amount payable: {money(balance)}</Text>
                  {firm?.upi_id ? <Text style={s.boxText}>UPI: {str(firm.upi_id)}</Text> : null}
                  {firm?.bank_name ? <Text style={s.boxText}>Bank: {str(firm.bank_name)}</Text> : null}
                  {firm?.bank_account_no ? <Text style={s.boxText}>A/C: {str(firm.bank_account_no)}</Text> : null}
                  {firm?.bank_ifsc ? <Text style={s.boxText}>IFSC: {str(firm.bank_ifsc)}</Text> : null}
                </View>
              </View>
            ) : null}
          </View>

          <View style={s.totals}>
            <TaxRows t={t} />
            <View style={s.grand}>
              <Text style={s.grandLabel}>TOTAL INVOICE</Text>
              <Text style={s.grandValue}>{money(t.total)}</Text>
            </View>
            {paid > 0 ? (
              <View style={s.paid}>
                <Text style={s.paidText}>Amount Received</Text>
                <Text style={s.paidText}>{money(paid)}</Text>
              </View>
            ) : null}
            {status === "Cancelled" ? null : balance > 0 ? (
              <View style={s.due}>
                <Text style={s.dueText}>BALANCE DUE</Text>
                <Text style={s.dueText}>{money(balance)}</Text>
              </View>
            ) : (
              <View style={s.settled}>
                <Text style={s.paidText}>PAYMENT STATUS</Text>
                <Text style={s.paidText}>PAID</Text>
              </View>
            )}
          </View>
        </View>

        <Footer firm={firm} thanks="Thank you for your business." note="This is a computer-generated tax invoice and does not require a physical signature." />
      </Page>
    </Document>
  );
}

/* ---------------- Quotation ---------------- */

export function QuotationPdf({ quotation, client, firm }: { quotation: Rec; client: Rec; firm: Rec }) {
  const t = taxes(quotation);
  const issued = date(quotation?.date || quotation?.issue_date || quotation?.created_at);
  const validUntil = quotation?.valid_until || quotation?.validUntil;
  const number = str(quotation?.quote_number || quotation?.quotation_number);

  return (
    <Document title={`Quotation ${number}`} author={str(firm?.firm_name)} subject="Quotation">
      <Page size="A4" style={s.page}>
        {str(quotation?.status) === "Draft" ? <Text style={s.watermark} fixed>DRAFT</Text> : null}
        <Header firm={firm} badge="PROPOSAL" title="QUOTATION" number={number} issued={issued} />

        <View style={s.infoWrap}>
          <Party
            heading="PREPARED FOR"
            client={client}
            fallbackName={str(quotation?.recipient_name)}
            organisation={str(quotation?.organisation)}
            email={str(quotation?.recipient_email)}
          />
          <View style={s.meta}>
            <Text style={s.label}>QUOTATION DETAILS</Text>
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Date</Text>
              <Text style={s.metaValue}>{issued}</Text>
            </View>
            {validUntil ? (
              <View style={s.metaRow}>
                <Text style={s.metaLabel}>Valid Until</Text>
                <Text style={s.metaValue}>{date(validUntil)}</Text>
              </View>
            ) : null}
            <View style={s.metaRow}>
              <Text style={s.metaLabel}>Tax Type</Text>
              <Text style={s.metaValue}>{t.inter ? "IGST" : "CGST + SGST"}</Text>
            </View>
          </View>
        </View>

        <Items items={t.items} />

        <View style={s.lower} wrap={false}>
          <View style={s.left}>
            <View style={s.box}>
              <Text style={s.boxTitle}>NOTES & TERMS</Text>
              <Text style={s.boxText}>{str(quotation?.notes) || "This is a proposed estimate. Pricing may change after final scope review."}</Text>
            </View>
            <View style={s.boxPale}>
              <Text style={s.boxTitle}>AMOUNT IN WORDS</Text>
              <Text style={s.words}>{words(t.total)}</Text>
            </View>
          </View>
          <View style={s.totals}>
            <TaxRows t={t} />
            <View style={s.grand}>
              <Text style={s.grandLabel}>TOTAL ESTIMATE</Text>
              <Text style={s.grandValue}>{money(t.total)}</Text>
            </View>
          </View>
        </View>

        <Footer firm={firm} thanks="We look forward to working with you." note="This is a computer-generated quotation and does not require a physical signature." />
      </Page>
    </Document>
  );
}

/* ---------------- Renderers (used by preview routes and email) ---------------- */

export async function renderInvoicePdf(invoice: Rec, client: Rec, firm: Rec): Promise<Buffer> {
  const t = taxes(invoice);
  const paid = num(invoice?.amount_paid ?? invoice?.amountPaid);
  const balance = Math.max(0, Math.round((t.total - paid) * 100) / 100);
  let qrDataUrl: string | null = null;
  if (firm?.upi_id && balance > 0 && str(invoice?.status) !== "Cancelled") {
    const uri =
      `upi://pay?pa=${encodeURIComponent(str(firm.upi_id))}&pn=${encodeURIComponent(str(firm.firm_name) || "Firm")}` +
      `&am=${balance.toFixed(2)}&cu=INR&tn=${encodeURIComponent(str(invoice?.invoice_number))}`;
    qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 240 });
  }
  return renderToBuffer(<InvoicePdf invoice={invoice} client={client} firm={firm} qrDataUrl={qrDataUrl} />);
}

export async function renderQuotationPdf(quotation: Rec, client: Rec, firm: Rec): Promise<Buffer> {
  return renderToBuffer(<QuotationPdf quotation={quotation} client={client} firm={firm} />);
}

export function pdfFileName(number: unknown, fallback: string): string {
  return (str(number) || fallback).replace(/[^\w.\-]+/g, "-").replace(/-+/g, "-") + ".pdf";
}