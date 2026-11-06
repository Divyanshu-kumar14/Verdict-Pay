import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton h-3", className)} />;
}

export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, function (_, index) {
        return <Skeleton key={index} className={index === lines - 1 ? "w-2/3" : "w-full"} />;
      })}
    </div>
  );
}
