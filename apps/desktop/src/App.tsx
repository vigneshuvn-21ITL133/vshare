import { useEffect, useMemo, useState } from "react";
import type { Snapshot } from "../electron/shared";
import { api } from "./vshare";
import { Sidebar, type PageId } from "./components/Sidebar";
import { OfferDialog } from "./components/OfferDialog";
import { Home } from "./pages/Home";
import { SendPage } from "./pages/Send";
import { ReceivePage } from "./pages/Receive";
import { TransfersPage } from "./pages/Transfers";
import { HistoryPage } from "./pages/History";
import { SettingsPage } from "./pages/Settings";
import { useToast, ToastHost } from "./components/Toast";

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<PageId>("home");
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    void api.getSnapshot().then((initial) => alive && setSnapshot(initial));
    const unsubscribe = api.onSnapshot((next) => setSnapshot(next));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const apply = () => {
      const theme = snapshot?.settings.theme ?? "system";
      const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    apply();
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [snapshot?.settings.theme]);

  const activeCount = snapshot?.transfers.length ?? 0;
  const pages = useMemo(
    () => ({
      home: () => <Home snapshot={snapshot!} go={setPage} />,
      send: () => <SendPage snapshot={snapshot!} notify={toast.show} go={setPage} />,
      receive: () => <ReceivePage snapshot={snapshot!} notify={toast.show} />,
      transfers: () => <TransfersPage snapshot={snapshot!} />,
      history: () => <HistoryPage snapshot={snapshot!} notify={toast.show} />,
      settings: () => <SettingsPage snapshot={snapshot!} notify={toast.show} />,
    }),
    [snapshot, toast.show],
  );

  if (!snapshot) {
    return <div className="app" />;
  }

  return (
    <div className="app">
      <Sidebar
        active={page}
        onNavigate={setPage}
        deviceName={snapshot.settings.deviceName}
        listening={snapshot.listen.listening}
        activeCount={activeCount}
      />
      <main className="main">{pages[page]()}</main>
      <OfferDialog snapshot={snapshot} />
      <ToastHost message={toast.message} />
    </div>
  );
}
