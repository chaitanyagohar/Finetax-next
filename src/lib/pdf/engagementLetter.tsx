/** Engagement letter / service contract PDF (server-side). */
import React from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Document, Font, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";

Font.registerHyphenationCallback((word) => [word]);

type Rec = Record<string, any> | null | undefined;

const C = { navy: "#10233f", blue: "#2563eb", border: "#dbe3ec", muted: "#64748b", text: "#1e293b", light: "#f8fafc", white: "#ffffff" };

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 9, color: C.text, paddingTop: 0, paddingBottom: 44, lineHeight: 1.45 },
  header: { backgroundColor: C.navy, paddingHorizontal: 44, paddingVertical: 20, flexDirection: "row", justifyContent: "space-between" },
  brand: { color: C.white, fontSize: 17, fontFamily: "Helvetica-Bold" },
  hText: { color: "#cbd5e1", fontSize: 7.6, marginTop: 3 },
  docSide: { alignItems: "flex-end" },
  docTitle: { color: C.white, fontSize: 15, fontFamily: "Helvetica-Bold" },
  docMeta: { color: "#cbd5e1", fontSize: 7.8, marginTop: 3 },
  body: { paddingHorizontal: 44, paddingTop: 18 },
  to: { marginBottom: 12 },
  bold: { fontFamily: "Helvetica-Bold" },
  subject: { fontFamily: "Helvetica-Bold", fontSize: 10, color: C.navy, marginVertical: 8 },
  para: { marginBottom: 6, textAlign: "justify" },
  h: { fontFamily: "Helvetica-Bold", fontSize: 10, color: C.navy, marginTop: 10, marginBottom: 4 },
  table: { borderWidth: 1, borderColor: C.border, borderRadius: 3, marginBottom: 6 },
  th: { flexDirection: "row", backgroundColor: C.light, borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 4, paddingHorizontal: 6 },
  tr: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.border, paddingVertical: 4, paddingHorizontal: 6 },
  c1: { width: "8%" },
  c2: { width: "52%" },
  c3: { width: "20%" },
  c4: { width: "20%" },
  feeBox: { backgroundColor: C.light, borderWidth: 1, borderColor: C.border, borderRadius: 4, padding: 9, marginBottom: 6 },
  feeRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2 },
  signWrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 22 },
  signCol: { width: "46%", borderTopWidth: 1, borderTopColor: C.border, paddingTop: 6 },
  small: { fontSize: 7.6, color: C.muted },
  accepted: { marginTop: 10, borderWidth: 1, borderColor: "#bbf7d0", backgroundColor: "#f0fdf4", borderRadius: 4, padding: 8, color: "#166534" },
  pageNo: { position: "absolute", bottom: 18, left: 44, right: 44, fontSize: 7, color: C.muted, flexDirection: "row", justifyContent: "space-between" },
});

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const money = (n: unknown) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function dmy(v?: string | null): string {
  if (!v) return "-";
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : new Date(v).toLocaleDateString("en-IN");
}
function ordinal(n: number): string {
  const sfx = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (sfx[(v - 20) % 10] || sfx[v] || sfx[0]);
}
const paragraphs = (t?: string | null) =>
  str(t)
    .split(/\n\s*\n|\r\n\s*\r\n/)
    .map((p) => p.trim())
    .filter(Boolean);
const cycleWord = (c: string) => ({ Monthly: "month", Quarterly: "quarter", "Half-Yearly": "half-year", Yearly: "year" } as Record<string, string>)[c] || "month";

export function EngagementLetterPdf({ proposal: p, client, pkg, firm, terms }: { proposal: Rec; client: Rec; pkg: Rec; firm: Rec; terms: Rec }) {
  const firmName = str(firm?.firm_name) || "The Firm";
  const clientOrg = str(client?.organization_name) || str(client?.name) || "the Client";
  const services: any[] = Array.isArray(p?.services) ? p!.services : [];
  const cycle = str(p?.billing_cycle) || "Monthly";
  const notice = Number(terms?.termination_notice_days ?? 30);
  let section = 0;
  const H = ({ children }: { children: string }) => <Text style={s.h}>{`${++section}. ${children}`}</Text>;

  return (
    <Document title={`Engagement Letter ${str(p?.number)}`} author={firmName} subject="Engagement Letter">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <View style={{ width: "60%" }}>
            <Text style={[s.brand, firmName.length > 24 ? { fontSize: 14 } : {}]}>{firmName.toUpperCase()}</Text>
            {firm?.address ? <Text style={s.hText}>{str(firm.address)}</Text> : null}
            <Text style={s.hText}>
              {[firm?.gstin ? `GSTIN: ${str(firm.gstin)}` : "", terms?.firm_registration_no ? `FRN: ${str(terms.firm_registration_no)}` : "", firm?.email ? str(firm.email) : ""]
                .filter(Boolean)
                .join("   |   ")}
            </Text>
          </View>
          <View style={s.docSide}>
            <Text style={s.docTitle}>ENGAGEMENT LETTER</Text>
            <Text style={s.docMeta}>Ref: {str(p?.number)}</Text>
            <Text style={s.docMeta}>Date: {dmy(p?.sent_at || p?.created_at)}</Text>
          </View>
        </View>

        <View style={s.body}>
          <View style={s.to}>
            <Text>To,</Text>
            <Text style={s.bold}>{clientOrg}</Text>
            {client?.organization_name && client?.name ? <Text>Attn: {str(client.name)}</Text> : null}
            {client?.address ? <Text>{str(client.address)}</Text> : null}
            {client?.gstin ? <Text>GSTIN: {str(client.gstin)}</Text> : client?.pan ? <Text>PAN: {str(client.pan)}</Text> : null}
          </View>

          <Text style={s.subject}>Subject: Engagement for {str(pkg?.name) || "professional services"}</Text>

          <Text style={s.para}>
            We are pleased to confirm the terms on which {firmName} ("we", "us") will provide professional services to {clientOrg} ("you") with effect from{" "}
            {dmy(p?.start_date)}. Please read this letter carefully. Your acceptance confirms your agreement to these terms.
          </Text>

          <H>Scope of Services</H>
          {services.length > 0 && (
            <View style={s.table}>
              <View style={s.th}>
                <Text style={[s.c1, s.bold]}>#</Text>
                <Text style={[s.c2, s.bold]}>Service</Text>
                <Text style={[s.c3, s.bold]}>Category</Text>
                <Text style={[s.c4, s.bold]}>Frequency</Text>
              </View>
              {services.map((sv, i) => (
                <View key={i} style={s.tr} wrap={false}>
                  <Text style={s.c1}>{i + 1}</Text>
                  <Text style={s.c2}>{str(sv.title)}</Text>
                  <Text style={s.c3}>{str(sv.category)}</Text>
                  <Text style={s.c4}>{!sv.recurrence || sv.recurrence === "None" ? "One-time" : str(sv.recurrence)}</Text>
                </View>
              ))}
            </View>
          )}
          {paragraphs(p?.scope_of_work).map((t, i) => (
            <Text key={i} style={s.para}>{t}</Text>
          ))}

          {str(p?.exclusions).trim() ? (
            <>
              <H>Exclusions</H>
              <Text style={s.para}>The following are not part of this engagement and, if required, will be agreed and billed separately:</Text>
              {paragraphs(p?.exclusions).map((t, i) => (
                <Text key={i} style={s.para}>{t}</Text>
              ))}
            </>
          ) : null}

          {str(p?.client_responsibilities).trim() ? (
            <>
              <H>Your Responsibilities</H>
              {paragraphs(p?.client_responsibilities).map((t, i) => (
                <Text key={i} style={s.para}>{t}</Text>
              ))}
            </>
          ) : null}

          <H>Fees and Billing</H>
          <View style={s.feeBox} wrap={false}>
            <View style={s.feeRow}>
              <Text>Professional fee</Text>
              <Text style={s.bold}>
                {money(p?.price)} per {cycleWord(cycle)} + GST @ {str(p?.gst_rate)}%
              </Text>
            </View>
            <View style={s.feeRow}>
              <Text>Billing</Text>
              <Text>
                In arrears, on the {ordinal(Number(p?.bill_day || 5))} of the month after each {cycleWord(cycle)}
              </Text>
            </View>
            <View style={s.feeRow}>
              <Text>Payment due</Text>
              <Text>Within {str(p?.due_days)} days of the bill date</Text>
            </View>
            {Number(p?.late_fee_percent) > 0 ? (
              <View style={s.feeRow}>
                <Text>Late payment</Text>
                <Text>
                  {str(p?.late_fee_percent)}% per month (minimum {money(p?.late_fee_min)}) on overdue amounts
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={s.para}>
            For example, services for 01/09 to 30/09 are billed on {ordinal(Number(p?.bill_day || 5))} October and payable within {str(p?.due_days)} days.
            {p?.prorate_first ? " If services start part-way through a period, the first bill is charged proportionately for the days covered." : ""}
            {Number(p?.late_fee_percent) > 0 ? " Late payment charges are added to the next bill and attract GST at the applicable rate." : ""} Fees for work outside
            the scope above will be agreed separately.
          </Text>

          <H>Term and Termination</H>
          <Text style={s.para}>
            This engagement continues until terminated by either party giving {notice} days' written notice. Fees for services rendered up to the date of termination
            remain payable. We may suspend services if fees remain unpaid beyond the due date.
          </Text>

          {paragraphs(terms?.standard_terms).length > 0 ? (
            <>
              <H>General Terms</H>
              {paragraphs(terms?.standard_terms).map((t, i) => (
                <Text key={i} style={s.para}>{t}</Text>
              ))}
            </>
          ) : null}

          {str(p?.special_terms).trim() ? (
            <>
              <H>Special Terms</H>
              {paragraphs(p?.special_terms).map((t, i) => (
                <Text key={i} style={s.para}>{t}</Text>
              ))}
            </>
          ) : null}

          <H>Governing Law and Jurisdiction</H>
          <Text style={s.para}>
            This engagement is governed by the laws of India. Courts at {str(terms?.jurisdiction) || "the city of our registered office"} shall have exclusive jurisdiction.
          </Text>

          <View style={s.signWrap} wrap={false}>
            <View style={s.signCol}>
              <Text style={s.bold}>For {firmName}</Text>
              <Text style={{ marginTop: 26 }}>{str(terms?.signatory_name) || "Authorised Signatory"}</Text>
              <Text style={s.small}>
                {str(terms?.signatory_designation)}
                {terms?.membership_no ? ` · M. No. ${str(terms.membership_no)}` : ""}
              </Text>
            </View>
            <View style={s.signCol}>
              <Text style={s.bold}>Accepted for {clientOrg}</Text>
              <Text style={{ marginTop: 26 }}>Name: {str(p?.accepted_name) || "________________________"}</Text>
              <Text style={s.small}>Designation: {str(p?.accepted_designation) || "______________"} · Date: {p?.accepted_at ? dmy(p.accepted_at) : "__________"}</Text>
            </View>
          </View>

          {p?.status === "Accepted" ? (
            <Text style={s.accepted}>
              Accepted on {dmy(p?.accepted_at)} by {str(p?.accepted_name)}
              {p?.accepted_designation ? ` (${str(p.accepted_designation)})` : ""}
              {p?.accepted_method === "online" ? ` · online${p?.accepted_ip ? `, IP ${str(p.accepted_ip)}` : ""}` : " · acceptance recorded"}.
            </Text>
          ) : null}
        </View>

        <View style={s.pageNo} fixed>
          <Text>{str(p?.number)}</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

/** Load everything an engagement letter needs (works with a user session or the admin client). */
export async function loadProposalBundle(db: SupabaseClient, id: string) {
  const { data: proposal } = await db.from("proposals").select("*").eq("id", id).maybeSingle();
  if (!proposal) return null;
  const [{ data: client }, { data: pkg }, { data: firm }, { data: terms }] = await Promise.all([
    db.from("clients").select("*").eq("id", proposal.client_id).maybeSingle(),
    db.from("service_packages").select("*").eq("id", proposal.package_id).maybeSingle(),
    db.from("firm_settings").select("*").eq("id", 1).maybeSingle(),
    db.from("engagement_settings").select("*").eq("id", 1).maybeSingle(),
  ]);
  return { proposal, client, pkg, firm, terms };
}

export async function renderEngagementLetter(bundle: { proposal: Rec; client: Rec; pkg: Rec; firm: Rec; terms: Rec }): Promise<Buffer> {
  return renderToBuffer(<EngagementLetterPdf {...bundle} />);
}