"use client";

import { Document, Page, Text, View, StyleSheet, PDFViewer } from "@react-pdf/renderer";
import { useEffect, useState } from "react";

const styles = StyleSheet.create({
  page: { fontFamily: "Helvetica", backgroundColor: "#ffffff" },
  header: { backgroundColor: "#10233f", height: 110, paddingHorizontal: 50, paddingTop: 30, flexDirection: "row", justifyContent: "space-between" },
  brand: { color: "#ffffff", fontSize: 18, fontFamily: "Helvetica-Bold" },
  titleGroup: { alignItems: "flex-end" },
  title: { color: "#ffffff", fontSize: 20, fontFamily: "Helvetica-Bold" },
  subTitle: { color: "#e2e8f0", fontSize: 9.5, marginTop: 4 },
  billToCard: { marginHorizontal: 50, marginTop: 30, backgroundColor: "#f6f7fa", borderRadius: 4, borderWidth: 1, borderColor: "#e2e6ed", padding: 16 },
  billToLabel: { color: "#6b7280", fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  clientName: { color: "#111827", fontSize: 12.5, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  clientOrg: { color: "#374151", fontSize: 9.5 },
  th: { marginHorizontal: 50, marginTop: 30, backgroundColor: "#10233f", flexDirection: "row", paddingVertical: 8, paddingHorizontal: 10 },
  thDesc: { color: "#ffffff", fontSize: 9.5, fontFamily: "Helvetica-Bold", flex: 2 },
  thNum: { color: "#ffffff", fontSize: 9.5, fontFamily: "Helvetica-Bold", flex: 1, textAlign: "right" },
  tr: { marginHorizontal: 50, flexDirection: "row", paddingVertical: 6, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: "#e2e6ed" },
  trAlt: { marginHorizontal: 50, flexDirection: "row", paddingVertical: 6, paddingHorizontal: 10, backgroundColor: "#f9fafb", borderBottomWidth: 1, borderBottomColor: "#e2e6ed" },
  tdDesc: { color: "#1f2937", fontSize: 9.5, flex: 2 },
  tdNum: { color: "#1f2937", fontSize: 9.5, flex: 1, textAlign: "right" },
  totals: { marginHorizontal: 50, marginTop: 14, alignItems: "flex-end" },
  totRow: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 6, width: 220 },
  totLabel: { color: "#374151", fontSize: 9.5, width: 130 },
  totVal: { color: "#374151", fontSize: 9.5, width: 90, textAlign: "right" },
  dueRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: "#e2e6ed", width: 220 },
  dueLabel: { color: "#10233f", fontSize: 11, fontFamily: "Helvetica-Bold", width: 130 },
  dueVal: { color: "#10233f", fontSize: 11, fontFamily: "Helvetica-Bold", width: 90, textAlign: "right" },
  notes: { marginHorizontal: 50, marginTop: 20 },
  notesLabel: { color: "#6b7280", fontSize: 9, fontFamily: "Helvetica-Bold", marginBottom: 4 },
  notesText: { color: "#374151", fontSize: 9.5 }
});

export default function QuotationDocument({ quotation, client }: { quotation: any; client: any }) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return <div className="flex items-center justify-center h-screen bg-surface font-semibold text-navy">Generating Quotation PDF...</div>;
  }

  // 1. Calculate subtotal directly from line items
  const items = quotation.items || [];
  const calculatedSubtotal = items.reduce(
    (sum: number, it: any) => sum + Number(it.qty || 1) * Number(it.rate || 0),
    0
  );
  const subtotal = calculatedSubtotal > 0 ? calculatedSubtotal : Number(quotation.subtotal || 0);

  // 2. Tax logic & fallbacks
  const isInterState = Boolean(quotation.is_inter_state);
  const gstRate = Number(quotation.gst_rate || 18);

  let cgst = Number(quotation.cgst || 0);
  let sgst = Number(quotation.sgst || 0);
  let igst = Number(quotation.igst || 0);

  if (!isInterState && cgst === 0 && sgst === 0 && gstRate > 0) {
    cgst = Number(((subtotal * gstRate) / 200).toFixed(2));
    sgst = Number(((subtotal * gstRate) / 200).toFixed(2));
  } else if (isInterState && igst === 0 && gstRate > 0) {
    igst = Number(((subtotal * gstRate) / 100).toFixed(2));
  }

  const total = Number((subtotal + cgst + sgst + igst).toFixed(2));
  const recipient = client?.name || quotation.recipient_name || quotation.organisation || "";

  return (
    <PDFViewer style={{ width: "100%", height: "100vh", border: "none" }}>
      <Document>
        <Page size="A4" style={styles.page}>
          {/* Header Band */}
          <View style={styles.header}>
            <View><Text style={styles.brand}>Finetax</Text></View>
            <View style={styles.titleGroup}>
              <Text style={styles.title}>QUOTATION</Text>
              <Text style={styles.subTitle}>Quote No: {quotation.quote_number || quotation.quotation_number}</Text>
              <Text style={styles.subTitle}>Date: {quotation.date}</Text>
              {quotation.valid_until && <Text style={styles.subTitle}>Valid Until: {quotation.valid_until}</Text>}
            </View>
          </View>

          {/* Bill To Card */}
          <View style={styles.billToCard}>
            <Text style={styles.billToLabel}>PREPARED FOR</Text>
            <Text style={styles.clientName}>{recipient}</Text>
            {quotation.recipient_email && <Text style={styles.clientOrg}>Email: {quotation.recipient_email}</Text>}
            {quotation.organisation && <Text style={styles.clientOrg}>Org: {quotation.organisation}</Text>}
          </View>

          {/* Table Header */}
          <View style={styles.th}>
            <Text style={styles.thDesc}>DESCRIPTION</Text>
            <Text style={styles.thNum}>QTY</Text>
            <Text style={styles.thNum}>RATE (Rs.)</Text>
            <Text style={styles.thNum}>AMOUNT (Rs.)</Text>
          </View>

          {/* Line Items */}
          {items.map((it: any, idx: number) => {
            const amount = Number(it.qty || 1) * Number(it.rate || 0);
            return (
              <View key={idx} style={idx % 2 === 1 ? styles.trAlt : styles.tr}>
                <Text style={styles.tdDesc}>{it.description || ""}</Text>
                <Text style={styles.tdNum}>{String(it.qty || 1)}</Text>
                <Text style={styles.tdNum}>{Number(it.rate || 0).toFixed(2)}</Text>
                <Text style={styles.tdNum}>{amount.toFixed(2)}</Text>
              </View>
            );
          })}

          {/* Corrected Totals Section */}
          <View style={styles.totals}>
            <View style={styles.totRow}>
              <Text style={styles.totLabel}>Subtotal</Text>
              <Text style={styles.totVal}>{subtotal.toFixed(2)}</Text>
            </View>
            {isInterState ? (
              <View style={styles.totRow}>
                <Text style={styles.totLabel}>IGST ({gstRate}%)</Text>
                <Text style={styles.totVal}>{igst.toFixed(2)}</Text>
              </View>
            ) : (
              <>
                <View style={styles.totRow}>
                  <Text style={styles.totLabel}>CGST ({gstRate / 2}%)</Text>
                  <Text style={styles.totVal}>{cgst.toFixed(2)}</Text>
                </View>
                <View style={styles.totRow}>
                  <Text style={styles.totLabel}>SGST ({gstRate / 2}%)</Text>
                  <Text style={styles.totVal}>{sgst.toFixed(2)}</Text>
                </View>
              </>
            )}
            <View style={styles.dueRow}>
              <Text style={styles.dueLabel}>Total Amount</Text>
              <Text style={styles.dueVal}>Rs. {total.toFixed(2)}</Text>
            </View>
          </View>

          {/* Notes */}
          {quotation.notes && (
            <View style={styles.notes}>
              <Text style={styles.notesLabel}>NOTES / TERMS</Text>
              <Text style={styles.notesText}>{quotation.notes}</Text>
            </View>
          )}
        </Page>
      </Document>
    </PDFViewer>
  );
}