import { ThemeProvider } from "./theme/ThemeProvider";
import { DocumentProvider } from "./state/DocumentProvider";
import { AppShell } from "./components/AppShell";

export default function App() {
  return (
    <ThemeProvider>
      <DocumentProvider>
        <AppShell />
      </DocumentProvider>
    </ThemeProvider>
  );
}
