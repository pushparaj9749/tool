# Forge3D AI Studio — Desktop PC Edition (.EXE)

**Forge3D AI Studio** is a standalone, zero-backend **PC Desktop 3D Model Generator & Paint Studio** powered by the user's own **Google Gemini API Key** and **Three.js**.

---

## ✨ Features

1. **🔑 Bring Your Own Gemini API Key (100% Local on PC):**
   - Enter your own Google Gemini API key (`AIza...`), stored locally on your PC (`localStorage`).
   - **Zero Backend:** Requests go directly from your PC to Google Gemini Vision/Text APIs.

2. **🖼️ Image + Prompt to 3D Model:**
   - Generate 3D models from a **Text Prompt**, a **Reference Image**, or **Image + Prompt combined**.
   - Supports both **AI 3D Multi-Part Structural Reconstruction** and **Direct Image-to-3D Voxel / Bas-Relief Extrusion**.

3. **🏆 Dual Generation & Side-by-Side Comparison (Option A vs Option B):**
   - Every generation produces **2 distinct 3D variations (Option A & Option B)**.
   - Rotate and inspect both models side-by-side in interactive 3D viewports and select the best one to open in the main studio.

4. **🎨 Interactive 3D Color & Material Paint Studio:**
   - **Click-to-Paint Brush Mode (`P`):** Click any part directly on the 3D model to paint it with custom colors and PBR finishes (*Anodized Metal, Mirror Chrome, Royal Gold, Car Paint Gloss, Matte Clay, Neon Glow, Crystal Glass, Tactical Carbon, Crafted Wood*).
   - **One-Click AI Color Themes:** 8 curated palettes that harmoniously recolor the entire 3D model.
   - **Part Outliner & Inspector:** Transform position, rotation, scale, symmetry (`Mirror X`, `Mirror Z`), and add/duplicate/remove 3D parts.
   - **AI Refine Mode:** Modify the selected 3D model with natural language prompts (English / Hindi / Hinglish).

5. **📦 Easy One-Click Download / Export (`Ctrl + E`):**
   - **`.GLB`** (Binary glTF 2.0 with full colors & PBR materials)
   - **`.OBJ`** (Wavefront 3D Mesh)
   - **`.STL`** (Binary STL for 3D Printing)
   - **`.GLTF`** (JSON 3D Scene)
   - **`.PNG`** (High-Res 3D Studio Render)
   - **`.forge3d.json`** (Save & Reload Editable Project)

---

## 💻 Windows `.EXE` Build (GitHub Actions)

This repository includes an automated GitHub Actions workflow (`.github/workflows/build-exe.yml`) that compiles the app into standalone Windows 64-bit executables:

- **`Forge3D-AI-Studio-Portable-x64.exe`** — Portable single-file `.exe` (no installation required; double-click to run on any Windows PC).
- **`Forge3D-AI-Studio-Setup-x64.exe`** — Standard Windows NSIS Installer (creates Desktop & Start Menu shortcuts).

### How to Download the `.EXE` from GitHub:
1. Open the **Actions** tab of this GitHub repository.
2. Click the latest **"Build Windows Desktop .EXE (Forge3D AI Studio)"** workflow run (or click **Run workflow** to trigger a fresh build).
3. Scroll down to **Artifacts** and download **`Forge3D-AI-Studio-Windows-EXE`**.
