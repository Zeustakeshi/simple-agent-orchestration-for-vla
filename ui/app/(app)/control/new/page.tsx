"use client";
/* /control/new — P04 "Route phụ"
   Reopens the latest phiên for this robot (Điều khiển). Pass ?new=1 to force
   a blank session. Then replace the URL with /control/{sessionId}. */

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader } from "lucide-react";
import { createSession, fetchLatestSession } from "@/lib/api/sessions";
import { ErrorPanel } from "@/components/common/ErrorMessage";
import { toErrorObject, type ErrorObject } from "@/lib/errors";
import { useAuthStore } from "@/stores";

function NewSession() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedRobotId = useAuthStore((s) => s.selectedRobotId);
  const selectRobot = useAuthStore((s) => s.selectRobot);
  const [error, setError] = useState<ErrorObject | null>(null);
  const [attempt, setAttempt] = useState(0);

  const forceNew = searchParams?.get("new") === "1";
  const robotId = searchParams?.get("robot_id") ?? selectedRobotId ?? "robot-001";

  useEffect(() => {
    let cancelled = false;

    const open = async () => {
      const existing = forceNew ? null : await fetchLatestSession(robotId);
      const session = existing ?? (await createSession(robotId));
      if (cancelled) return;
      selectRobot(session.robot_id);
      router.replace(`/control/${session.id}`);
    };

    open().catch((err) => {
      if (!cancelled) setError(toErrorObject(err));
    });

    return () => {
      cancelled = true;
    };
  }, [robotId, forceNew, attempt]); // eslint-disable-line react-hooks/exhaustive-deps -- router/selectRobot are stable; including them retriggers and cancels the redirect

  if (error) {
    return (
      <div className="p-6 max-w-[520px] mx-auto mt-16">
        <ErrorPanel
          error={error}
          onRetry={() => {
            setError(null);
            setAttempt((a) => a + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 text-haze-500">
      <Loader size={20} className="animate-spin-slow" />
      <p className="text-[13px]">Đang mở trò chuyện gần nhất…</p>
    </div>
  );
}

export default function NewControlSessionPage() {
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-haze-500">
          <Loader size={20} className="animate-spin-slow" />
        </div>
      }
    >
      <NewSession />
    </Suspense>
  );
}
