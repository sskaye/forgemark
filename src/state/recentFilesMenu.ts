import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useRecentFiles } from "./preferences";

// File > Open Recent.
//
// The list lives with the other preferences (localStorage, written by
// the open paths in DocumentBindings). This hook, mounted once by the
// shell, pushes it to the native menu whenever it changes, drops an
// entry the app failed to open, and answers Clear Menu. A click on an
// entry comes back from Rust as `forgemark:open-path`, the same event a
// Finder open uses, so nothing else needs to know the menu exists.

export function useRecentFilesMenu(): void {
  const { recent, remove, clear } = useRecentFiles();

  useEffect(() => {
    invoke("set_recent_files", { paths: recent.map((r) => r.path) }).catch(() => {
      // No native shell (tests, the Vite dev surface): there is no menu
      // to update, and nothing else depends on it.
    });
  }, [recent]);

  useEffect(() => {
    const onFailed = (e: Event) => {
      const path = (e as CustomEvent<{ path: string }>).detail?.path;
      if (path) remove(path);
    };
    const onMenu = (e: Event) => {
      if ((e as CustomEvent<string>).detail === "recent-clear") clear();
    };
    window.addEventListener("forgemark:open-failed", onFailed);
    window.addEventListener("forgemark:menu", onMenu);
    return () => {
      window.removeEventListener("forgemark:open-failed", onFailed);
      window.removeEventListener("forgemark:menu", onMenu);
    };
  }, [remove, clear]);
}
