"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  PDFViewer,
  Font,
} from "@react-pdf/renderer";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Register fonts used by the PDF to prevent PDFKit crashes
Font.register({
  family: "Helvetica",
  fonts: [
    {
      src: "https://cdn.jsdelivr.net/npm/@canvas-fonts/helvetica@1.0.4/Helvetica.ttf",
    },
    {
      src: "https://cdn.jsdelivr.net/npm/@canvas-fonts/helvetica-bold@1.0.4/Helvetica-Bold.ttf",
      fontWeight: "bold",
    },
  ],
});

// Prevent unwanted word splitting
Font.registerHyphenationCallback((word) => [word]);

const COLORS = {
  navy: "#10233f",
  navyDark: "#08182d",
  navyMedium: "#17345b",
  blue: "#2563eb",
  lightBlue: "#eff6ff",
  paleBlue: "#f7faff",
  border: "#dbe3ec",
  borderDark: "#cbd5e1",
  muted: "#64748b",
  text: "#1e293b",
  light: "#f8fafc",
  white: "#ffffff",
};

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    backgroundColor: COLORS.white,
    color: COLORS.text,
    paddingBottom: 30,
  },

  // =====================================================
  // HEADER
  // =====================================================

  header: {
    backgroundColor: COLORS.navy,
    paddingHorizontal: 48,
    paddingTop: 28,
    paddingBottom: 24,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  companySection: {
    width: "58%",
  },

  brand: {
    color: COLORS.white,
    fontSize: 21,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.6,
  },

  brandAccent: {
    width: 42,
    height: 2,
    backgroundColor: "#60a5fa",
    marginTop: 7,
    marginBottom: 7,
  },

  companyAddress: {
    color: "#cbd5e1",
    fontSize: 8,
    lineHeight: 1.4,
  },

  companyMeta: {
    color: "#94a3b8",
    fontSize: 7.5,
    marginTop: 7,
    lineHeight: 1.4,
  },

  documentSection: {
    width: "42%",
    alignItems: "flex-end",
  },

  documentBadge: {
    backgroundColor: COLORS.navyMedium,
    borderWidth: 1,
    borderColor: "#31567f",
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: 3,
  },

  documentBadgeText: {
    color: "#bfdbfe",
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1,
  },

  title: {
    color: COLORS.white,
    fontSize: 21,
    fontFamily: "Helvetica-Bold",
    marginTop: 8,
    letterSpacing: 0.4,
  },

  documentNumber: {
    color: "#dbeafe",
    fontSize: 8.5,
    marginTop: 5,
  },

  dateText: {
    color: "#94a3b8",
    fontSize: 8,
    marginTop: 4,
  },

  // =====================================================
  // CLIENT / QUOTATION INFORMATION
  // =====================================================

  infoWrapper: {
    marginHorizontal: 48,
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  billCard: {
    width: "62%",
    backgroundColor: COLORS.light,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 5,
    padding: 13,
  },

  documentInfoCard: {
    width: "34%",
    backgroundColor: COLORS.lightBlue,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    borderRadius: 5,
    padding: 13,
  },

  sectionLabel: {
    color: COLORS.blue,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.9,
    marginBottom: 7,
  },

  clientName: {
    color: COLORS.navyDark,
    fontSize: 12.5,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },

  clientText: {
    color: "#475569",
    fontSize: 8,
    marginTop: 2,
    lineHeight: 1.35,
  },

  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },

  infoLabel: {
    color: COLORS.muted,
    fontSize: 7.5,
  },

  infoValue: {
    color: COLORS.navy,
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },

  // =====================================================
  // ITEMS TABLE
  // =====================================================

  tableWrapper: {
    marginHorizontal: 48,
    marginTop: 20,
  },

  tableHeader: {
    flexDirection: "row",
    backgroundColor: COLORS.navy,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
  },

  tableHeaderText: {
    color: COLORS.white,
    fontSize: 7.8,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 0.35,
  },

  row: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    minHeight: 29,
  },

  rowAlternate: {
    flexDirection: "row",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.light,
    minHeight: 29,
  },

  colNo: { width: "7%" },
  colDescription: { width: "48%" },
  colQty: { width: "13%", textAlign: "right" },
  colRate: { width: "16%", textAlign: "right" },
  colAmount: { width: "16%", textAlign: "right" },

  itemNo: { color: COLORS.muted, fontSize: 8 },
  itemDescription: { color: COLORS.text, fontSize: 8.3, lineHeight: 1.3 },
  itemNumber: { color: COLORS.text, fontSize: 8.2, textAlign: "right" },

  emptyRow: {
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },

  emptyText: {
    color: COLORS.muted,
    fontSize: 8.5,
    textAlign: "center",
  },

  // =====================================================
  // LOWER SECTION
  // =====================================================

  lowerSection: {
    marginHorizontal: 48,
    marginTop: 18,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  paymentSection: {
    width: "55%",
  },

  notesBox: {
    backgroundColor: COLORS.light,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 5,
    padding: 10,
    marginBottom: 9,
  },

  amountWordsBox: {
    backgroundColor: COLORS.paleBlue,
    borderWidth: 1,
    borderColor: "#dbeafe",
    borderRadius: 5,
    padding: 10,
    marginBottom: 9,
  },

  paymentTitle: {
    color: COLORS.navy,
    fontSize: 8.2,
    fontFamily: "Helvetica-Bold",
    marginBottom: 4,
  },

  paymentText: {
    color: "#475569",
    fontSize: 7.7,
    marginTop: 2,
    lineHeight: 1.35,
  },

  amountWordsText: {
    color: COLORS.navy,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    lineHeight: 1.4,
  },

  // =====================================================
  // TOTALS
  // =====================================================

  totals: {
    width: "40%",
  },

  totalCard: {
    backgroundColor: COLORS.white,
  },

  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4.5,
  },

  totalLabel: {
    color: "#475569",
    fontSize: 8.2,
  },

  totalValue: {
    color: COLORS.text,
    fontSize: 8.2,
    textAlign: "right",
  },

  grandTotal: {
    marginTop: 6,
    backgroundColor: COLORS.navy,
    borderRadius: 4,
    paddingVertical: 9,
    paddingHorizontal: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  grandTotalLabel: {
    color: COLORS.white,
    fontSize: 9.2,
    fontFamily: "Helvetica-Bold",
  },

  grandTotalValue: {
    color: COLORS.white,
    fontSize: 10.5,
    fontFamily: "Helvetica-Bold",
  },

  // =====================================================
  // FOOTER
  // =====================================================

  footer: {
    marginHorizontal: 48,
    marginTop: 20,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: "row",
    justifyContent: "space-between",
  },

  footerLeft: {
    width: "62%",
  },

  footerRight: {
    width: "34%",
    alignItems: "flex-end",
  },

  thankYou: {
    color: COLORS.navy,
    fontSize: 8.3,
    fontFamily: "Helvetica-Bold",
    marginBottom: 3,
  },

  footerText: {
    color: COLORS.muted,
    fontSize: 7.2,
    lineHeight: 1.35,
  },

  signatureFirm: {
    color: COLORS.navy,
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    textAlign: "right",
  },

  signatureText: {
    color: COLORS.muted,
    fontSize: 7,
    marginTop: 17,
    textAlign: "right",
  },
});

export default function QuotationDocument({
  quotation,
  client,
}: {
  quotation: any;
  client: any;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [firm, setFirm] = useState<any>(null);

  const supabase = createClient();

  useEffect(() => {
    setIsMounted(true);

    async function loadFirmSettings() {
      const { data } = await supabase
        .from("firm_settings")
        .select("*")
        .eq("id", 1)
        .single();

      if (data) {
        setFirm(data);
      }
    }

    loadFirmSettings();
  }, []);

  if (!isMounted) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-100 font-semibold text-slate-700">
        Generating Quotation...
      </div>
    );
  }

  // =====================================================
  // CALCULATIONS
  // =====================================================

  const items = Array.isArray(quotation?.items) ? quotation.items : [];

  const calculatedSubtotal = items.reduce(
    (sum: number, item: any) =>
      sum + Number(item?.qty || 1) * Number(item?.rate || 0),
    0
  );

  const subtotal =
    calculatedSubtotal > 0
      ? calculatedSubtotal
      : Number(quotation?.subtotal || 0);

  const isInterState = Boolean(quotation?.is_inter_state);
  const gstRate = Number(quotation?.gst_rate || 18);

  let cgst = Number(quotation?.cgst || 0);
  let sgst = Number(quotation?.sgst || 0);
  let igst = Number(quotation?.igst || 0);

  if (!isInterState && cgst === 0 && sgst === 0 && gstRate > 0) {
    cgst = Number(((subtotal * gstRate) / 200).toFixed(2));
    sgst = Number(((subtotal * gstRate) / 200).toFixed(2));
  }

  if (isInterState && igst === 0 && gstRate > 0) {
    igst = Number(((subtotal * gstRate) / 100).toFixed(2));
  }

  const total = Number((subtotal + cgst + sgst + igst).toFixed(2));

  // =====================================================
  // HELPERS
  // =====================================================

  const formatCurrency = (amount: number) =>
    `Rs. ${Number(amount || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;

  const formatDate = (date?: string) => {
    if (!date) return "-";

    const parsed = new Date(date);

    if (Number.isNaN(parsed.getTime())) {
      return String(date);
    }

    return parsed.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const quotationDate = quotation?.date || quotation?.issue_date;
  const quoteNumber = quotation?.quote_number || quotation?.quotation_number;

  const numberToWords = (amount: number) => {
    const integerPart = Math.floor(amount);
    const decimalPart = Math.round((amount - integerPart) * 100);

    if (integerPart === 0) {
      return decimalPart > 0
        ? `Zero Rupees and ${decimalPart} Paise Only`
        : "Zero Rupees Only";
    }

    const ones = [
      "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
      "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
      "Seventeen", "Eighteen", "Nineteen",
    ];

    const tens = [
      "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
    ];

    const convertBelowHundred = (num: number) => {
      if (num < 20) return ones[num];
      const ten = Math.floor(num / 10);
      const remainder = num % 10;
      return `${tens[ten]}${remainder ? ` ${ones[remainder]}` : ""}`;
    };

    const convertBelowThousand = (num: number) => {
      const hundred = Math.floor(num / 100);
      const remainder = num % 100;
      let result = "";
      if (hundred > 0) result += `${ones[hundred]} Hundred`;
      if (remainder > 0) result += `${result ? " " : ""}${convertBelowHundred(remainder)}`;
      return result;
    };

    const convertIndianNumber = (num: number) => {
      if (num === 0) return "Zero";

      const crore = Math.floor(num / 10000000);
      num %= 10000000;
      const lakh = Math.floor(num / 100000);
      num %= 100000;
      const thousand = Math.floor(num / 1000);
      num %= 1000;

      const parts: string[] = [];

      if (crore > 0) parts.push(`${convertIndianNumber(crore)} Crore`);
      if (lakh > 0) parts.push(`${convertBelowHundred(lakh)} Lakh`);
      if (thousand > 0) parts.push(`${convertBelowHundred(thousand)} Thousand`);
      if (num > 0) parts.push(convertBelowThousand(num));

      return parts.join(" ");
    };

    const rupeesText = convertIndianNumber(integerPart);

    return `${rupeesText} Rupees${
      decimalPart > 0 ? ` and ${decimalPart} Paise` : ""
    } Only`;
  };

  const firmName = firm?.firm_name ? String(firm.firm_name) : "FINETAX";
  
  // Logic from your provided code to pick the right client name
  const recipientName = client?.name 
    ? String(client.name) 
    : quotation?.recipient_name 
    ? String(quotation.recipient_name) 
    : quotation?.organisation 
    ? String(quotation.organisation) 
    : "Valued Client";

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-900">
      {/* =====================================================
          PREVIEW ACTION BAR
      ====================================================== */}
      <div className="bg-slate-800 text-white px-6 py-3 flex justify-between items-center border-b border-slate-700">
        <div>
          <h1 className="font-bold text-sm">Quotation Preview</h1>
          <p className="text-xs text-slate-400">
            Ref: {quoteNumber || "Draft"}
          </p>
        </div>
        
        
      </div>

      {/* =====================================================
          PDF VIEWER
      ====================================================== */}
      <div className="flex-1">
        <PDFViewer
          style={{
            width: "100%",
            height: "100%",
            border: "none",
          }}
        >
          <Document
            title={`Quotation ${quoteNumber || ""}`}
            author={firmName}
            subject="Quotation"
          >
            <Page size="A4" style={styles.page}>
              {/* =================================================
                  HEADER
              ================================================== */}
              <View style={styles.header}>
                <View style={styles.companySection}>
                  <Text style={styles.brand}>{firmName.toUpperCase()}</Text>
                  <View style={styles.brandAccent} />
                  <Text style={styles.companyAddress}>
                    {firm?.address
                      ? String(firm.address)
                      : "Professional Tax & Financial Services"}
                  </Text>
                  <Text style={styles.companyMeta}>
                    GSTIN: {firm?.gstin ? String(firm.gstin) : "N/A"}
                    {"   |   "}
                    PAN: {firm?.pan ? String(firm.pan) : "N/A"}
                  </Text>
                </View>

                <View style={styles.documentSection}>
                  <View style={styles.documentBadge}>
                    <Text style={styles.documentBadgeText}>PROPOSAL</Text>
                  </View>
                  <Text style={styles.title}>QUOTATION</Text>
                  <Text style={styles.documentNumber}>
                    Quote No. {quoteNumber ? String(quoteNumber) : "-"}
                  </Text>
                  <Text style={styles.dateText}>
                    Issued: {formatDate(quotationDate)}
                  </Text>
                </View>
              </View>

              {/* =================================================
                  CLIENT + QUOTATION DETAILS
              ================================================== */}
              <View style={styles.infoWrapper}>
                <View style={styles.billCard}>
                  <Text style={styles.sectionLabel}>PREPARED FOR</Text>
                  <Text style={styles.clientName}>{recipientName}</Text>

                  {quotation?.organisation && quotation.organisation !== client?.name ? (
                    <Text style={styles.clientText}>
                      Organisation: {String(quotation.organisation)}
                    </Text>
                  ) : null}

                  {quotation?.recipient_email ? (
                    <Text style={styles.clientText}>
                      Email: {String(quotation.recipient_email)}
                    </Text>
                  ) : client?.email ? (
                    <Text style={styles.clientText}>
                      Email: {String(client.email)}
                    </Text>
                  ) : null}

                  {client?.address ? (
                    <Text style={styles.clientText}>
                      {String(client.address)}
                    </Text>
                  ) : null}
                </View>

                <View style={styles.documentInfoCard}>
                  <Text style={styles.sectionLabel}>QUOTATION DETAILS</Text>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Date</Text>
                    <Text style={styles.infoValue}>
                      {formatDate(quotationDate)}
                    </Text>
                  </View>
                  {quotation?.valid_until ? (
                    <View style={styles.infoRow}>
                      <Text style={styles.infoLabel}>Valid Until</Text>
                      <Text style={styles.infoValue}>
                        {formatDate(quotation.valid_until)}
                      </Text>
                    </View>
                  ) : null}
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Tax Type</Text>
                    <Text style={styles.infoValue}>
                      {isInterState ? "IGST" : "CGST + SGST"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* =================================================
                  ITEMS TABLE
              ================================================== */}
              <View style={styles.tableWrapper}>
                <View style={styles.tableHeader}>
                  <Text style={[styles.tableHeaderText, styles.colNo]}>#</Text>
                  <Text style={[styles.tableHeaderText, styles.colDescription]}>
                    DESCRIPTION
                  </Text>
                  <Text style={[styles.tableHeaderText, styles.colQty]}>QTY</Text>
                  <Text style={[styles.tableHeaderText, styles.colRate]}>RATE</Text>
                  <Text style={[styles.tableHeaderText, styles.colAmount]}>AMOUNT</Text>
                </View>

                {items.length > 0 ? (
                  items.map((item: any, index: number) => {
                    const quantity = Number(item?.qty || 1);
                    const rate = Number(item?.rate || 0);
                    const amount = quantity * rate;

                    return (
                      <View
                        key={index}
                        wrap={false}
                        style={index % 2 === 0 ? styles.row : styles.rowAlternate}
                      >
                        <Text style={[styles.itemNo, styles.colNo]}>
                          {index + 1}
                        </Text>
                        <Text style={[styles.itemDescription, styles.colDescription]}>
                          {item?.description
                            ? String(item.description)
                            : "Professional Services"}
                        </Text>
                        <Text style={[styles.itemNumber, styles.colQty]}>
                          {quantity}
                        </Text>
                        <Text style={[styles.itemNumber, styles.colRate]}>
                          {formatCurrency(rate)}
                        </Text>
                        <Text style={[styles.itemNumber, styles.colAmount]}>
                          {formatCurrency(amount)}
                        </Text>
                      </View>
                    );
                  })
                ) : (
                  <View style={styles.emptyRow}>
                    <Text style={styles.emptyText}>
                      No line items available.
                    </Text>
                  </View>
                )}
              </View>

              {/* =================================================
                  NOTES / TOTALS
              ================================================== */}
              <View style={styles.lowerSection}>
                {/* LEFT SECTION */}
                <View style={styles.paymentSection}>
                  <View style={styles.notesBox}>
                    <Text style={styles.paymentTitle}>NOTES & TERMS</Text>
                    <Text style={styles.paymentText}>
                      {quotation?.notes
                        ? String(quotation.notes)
                        : "This is a proposed estimate. Pricing may be subject to change upon final scope review."}
                    </Text>
                  </View>

                  <View style={styles.amountWordsBox}>
                    <Text style={styles.paymentTitle}>AMOUNT IN WORDS</Text>
                    <Text style={styles.amountWordsText}>
                      {numberToWords(total)}
                    </Text>
                  </View>
                </View>

                {/* RIGHT TOTALS SECTION */}
                <View style={styles.totals}>
                  <View style={styles.totalCard}>
                    <View style={styles.totalRow}>
                      <Text style={styles.totalLabel}>Subtotal</Text>
                      <Text style={styles.totalValue}>
                        {formatCurrency(subtotal)}
                      </Text>
                    </View>

                    {isInterState ? (
                      <View style={styles.totalRow}>
                        <Text style={styles.totalLabel}>
                          IGST ({gstRate}%)
                        </Text>
                        <Text style={styles.totalValue}>
                          {formatCurrency(igst)}
                        </Text>
                      </View>
                    ) : (
                      <>
                        <View style={styles.totalRow}>
                          <Text style={styles.totalLabel}>
                            CGST ({gstRate / 2}%)
                          </Text>
                          <Text style={styles.totalValue}>
                            {formatCurrency(cgst)}
                          </Text>
                        </View>
                        <View style={styles.totalRow}>
                          <Text style={styles.totalLabel}>
                            SGST ({gstRate / 2}%)
                          </Text>
                          <Text style={styles.totalValue}>
                            {formatCurrency(sgst)}
                          </Text>
                        </View>
                      </>
                    )}

                    <View style={styles.grandTotal}>
                      <Text style={styles.grandTotalLabel}>TOTAL ESTIMATE</Text>
                      <Text style={styles.grandTotalValue}>
                        {formatCurrency(total)}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* =================================================
                  FOOTER
              ================================================== */}
              <View style={styles.footer}>
                <View style={styles.footerLeft}>
                  <Text style={styles.thankYou}>We look forward to working with you.</Text>
                  <Text style={styles.footerText}>
                    This is a computer-generated quotation and does not require a physical signature.
                  </Text>
                </View>

                <View style={styles.footerRight}>
                  <Text style={styles.signatureFirm}>For {firmName}</Text>
                  <Text style={styles.signatureText}>Authorized Signatory</Text>
                </View>
              </View>
            </Page>
          </Document>
        </PDFViewer>
      </div>
    </div>
  );
}