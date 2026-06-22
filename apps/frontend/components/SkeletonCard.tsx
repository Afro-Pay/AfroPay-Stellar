export function SkeletonCard() {
  return (
    <div className="bg-gray-800 rounded-xl p-4 text-center animate-pulse">
      <div className="h-4 w-12 bg-gray-700 rounded mx-auto mb-2" />
      <div className="h-6 w-20 bg-gray-700 rounded mx-auto" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div className="bg-gray-900 rounded-xl p-4 flex justify-between items-center animate-pulse">
      <div className="space-y-2">
        <div className="h-4 w-24 bg-gray-700 rounded" />
        <div className="h-3 w-40 bg-gray-700 rounded" />
        <div className="h-3 w-28 bg-gray-700 rounded" />
      </div>
      <div className="h-4 w-14 bg-gray-700 rounded" />
    </div>
  );
}
