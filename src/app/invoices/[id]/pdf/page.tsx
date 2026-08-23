import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import InvoiceDocument from "./InvoiceDocument";

export default async function PDFPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cookieStore = await cookies();
  
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get: (name: string) => cookieStore.get(name)?.value } }
  );

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("*, clients!client_id(*)")
    .eq("id", id)
    .single();

  if (error || !invoice) {
    return <div className="p-10 text-center font-bold text-danger text-xl">Invoice not found.</div>;
  }

  return (
    <div className="w-screen h-screen overflow-hidden m-0 p-0">
      <InvoiceDocument invoice={invoice} client={invoice.clients} />
    </div>
  );
}