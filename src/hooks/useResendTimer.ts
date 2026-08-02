"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_COOLDOWN_SECONDS = 5 * 60;

// Ported from cafocus/app's src/hooks/useResendTimer.ts (same mechanism —
// this app's own /admin/login had zero way to resend a magic link at all
// until now, same gap that prompted the cafocus/app version). See that
// file's header comment for the full rationale; not shared as a package
// since these are two separate Next.js apps/repos, same "duplicated, not
// shared" posture the rest of this codebase already uses for anything that
// can't cross a Worker boundary.
export function useResendTimer(seconds: number = DEFAULT_COOLDOWN_SECONDS) {
  const [secondsLeft, setSecondsLeft] = useState(0);
  const targetRef = useRef<number>(Date.now());

  const start = useCallback(() => {
    targetRef.current = Date.now() + seconds * 1000;
    setSecondsLeft(seconds);
  }, [seconds]);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft(Math.max(0, Math.ceil((targetRef.current - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(id);
  }, []);

  const canResend = secondsLeft <= 0;
  const formatted = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`;

  return { secondsLeft, canResend, formatted, start };
}
