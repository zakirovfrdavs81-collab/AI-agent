import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

class AppErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error("Navo AI render error:", error, info.componentStack);
  }

  render() {
    if (this.state.failed) {
      return (
        <main role="alert" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "#10131f", color: "#f4f2fa", fontFamily: "system-ui, sans-serif", textAlign: "center" }}>
          <div>
            <h1 style={{ fontSize: 22 }}>Sahifani yuklab bo‘lmadi</h1>
            <p style={{ color: "#aaa8b8" }}>Ilovada xatolik yuz berdi. Sahifani yangilang; muammo davom etsa, backend oynasidagi xabarni tekshiring.</p>
            <button type="button" onClick={() => window.location.reload()} style={{ padding: "10px 18px", color: "#fff", background: "#6954d8", border: 0, borderRadius: 8, cursor: "pointer" }}>
              Sahifani yangilash
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("React root element #root was not found.");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);