import { useCallback, useEffect, useState } from "react";

/** A small, self-dismissing message at the bottom of the window. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const show = useCallback((text: string) => setMessage(text), []);
  return { message, show };
}

export function ToastHost({ message }: { message: string | null }) {
  const [visible, setVisible] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    setVisible(message);
    const timer = setTimeout(() => setVisible(null), 3200);
    return () => clearTimeout(timer);
  }, [message]);

  if (!visible) return null;
  return <div className="toast" role="status">{visible}</div>;
}
