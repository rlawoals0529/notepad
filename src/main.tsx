import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./ui/App";

import "./theme/palettes.css";
import "./theme/palette.css";
import "./theme/base.css";
import "./theme/layout-flat.css";
import "./theme/type.css";
import "./theme/texture.css";
import "./theme/motion.css";
import "./ui/app.css";

const root = document.getElementById("root");
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
