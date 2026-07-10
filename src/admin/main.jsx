import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import AdminApp from "./AdminApp.jsx";
import { applyTranslationOverrides } from "../i18n.js";
import { loadTranslationOverrides } from "../lib/translationOverrides.js";

loadTranslationOverrides().then(applyTranslationOverrides).finally(() => {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <AdminApp />
    </StrictMode>,
  );
});
