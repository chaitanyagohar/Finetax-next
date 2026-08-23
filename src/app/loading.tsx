export default function Loading() {
  return (
    <div className="w-full h-full flex items-center justify-center p-8">
      <div className="animate-pulse flex space-x-4">
        <div className="rounded-full bg-border h-10 w-10"></div>
        <div className="flex-1 space-y-4 py-1">
          <div className="h-4 bg-border rounded w-3/4"></div>
          <div className="space-y-2">
            <div className="h-4 bg-border rounded"></div>
            <div className="h-4 bg-border rounded w-5/6"></div>
          </div>
        </div>
      </div>
    </div>
  );
}