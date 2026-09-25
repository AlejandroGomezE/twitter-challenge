import { useEffect, useState } from 'react';

// `value`, but only once it has stopped changing for `delayMs`: every change restarts the timer,
// so a burst of keystrokes yields a single update with the last value.
export function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
