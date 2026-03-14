import { StartClient } from "@tanstack/react-start/client";
import { hydrateRoot } from "react-dom/client";
import "~/styles/tailwind.css";

hydrateRoot(document, <StartClient />);
