import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./app.css";
import App from "./App";
import { DriverPage, Kiosk } from "./screens/Driver";
const drv = location.pathname.match(/^\/driver\/([^/]+)/); const kiosk = new URLSearchParams(location.search).get("kiosk");
createRoot(document.getElementById("root")!).render(<StrictMode>{drv ? <DriverPage token={drv[1]} /> : kiosk ? <Kiosk token={kiosk} /> : <App />}</StrictMode>);
