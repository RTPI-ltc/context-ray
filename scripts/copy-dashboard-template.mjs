import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "apps", "dashboard", "dist", "index.html");
const destinations = [
  path.join(root, "packages", "cli", "dist", "assets", "dashboard.html"),
  path.join(root, "extensions", "vscode", "media", "dashboard.html"),
];

for (const destination of destinations) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
