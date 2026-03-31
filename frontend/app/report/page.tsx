"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import WorldReport from "@/components/WorldReport";
import { useLocale } from "@/lib/locale-context";

function ReportContent() {
  const params = useSearchParams();
  const sessionId = params.get("session");
  const { t } = useLocale();

  if (!sessionId) {
    return (
      <div className="h-screen flex items-center justify-center bg-void">
        <span className="text-micro tracking-widest text-t-dim">
          {"// "}{t("report_error")}
        </span>
      </div>
    );
  }

  return (
    <WorldReport
      sessionId={sessionId}
      open={true}
      onClose={() => window.history.back()}
    />
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-void">
        <span className="text-micro tracking-widest text-t-dim animate-pulse">
          LOADING…
        </span>
      </div>
    }>
      <ReportContent />
    </Suspense>
  );
}
