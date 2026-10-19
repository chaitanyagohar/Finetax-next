import HelpCenter from "@/components/help/HelpCenter";

export const metadata = { title: "Help & Support" };

export default function HelpPage() {
  return (
    <div className="mx-auto h-[calc(100vh-8rem)] max-w-3xl">
      <HelpCenter variant="page" />
    </div>
  );
}