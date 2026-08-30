import { useState, useEffect, useRef, useCallback } from "react";

interface UseAutoLockProps {
  timeoutMinutes: number;
  onLock: () => void;
  isEnabled: boolean;
}

export function useAutoLock({ timeoutMinutes, onLock, isEnabled }: UseAutoLockProps) {
  const [timeRemaining, setTimeRemaining] = useState(timeoutMinutes * 60);
  const [isIdle, setIsIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastActivityRef = useRef(Date.now());

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setTimeRemaining(timeoutMinutes * 60);
    setIsIdle(false);
  }, [timeoutMinutes]);

  const lock = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    onLock();
  }, [onLock]);

  useEffect(() => {
    if (!isEnabled) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    const handleActivity = () => {
      resetTimer();
    };

    // Track user activity
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("click", handleActivity);
    window.addEventListener("scroll", handleActivity);

    // Timer
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastActivityRef.current) / 1000);
      const remaining = Math.max(0, timeoutMinutes * 60 - elapsed);
      
      setTimeRemaining(remaining);
      
      if (remaining === 0) {
        lock();
      } else if (remaining <= 30) {
        setIsIdle(true);
      }
    }, 1000);

    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("click", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isEnabled, timeoutMinutes, resetTimer, lock]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return {
    timeRemaining,
    formattedTime: formatTime(timeRemaining),
    isIdle,
    resetTimer,
  };
}
