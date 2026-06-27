# Source package note

This repository was initialized for the final VetBara package prepared as `boot_v62_tablet_layout_fix.zip`.

The ZIP package contains the complete runnable bundle, including:

- VetBara Centre/Admin start scripts for macOS, Windows and Linux
- local Node runtime launcher files
- `app/server.cjs`
- built PWA files under `app/dist/`
- VetCert rules documents and logos
- admin/test data packages
- translation packs and review documentation

The v62 tablet layout fix is focused on returning the tablet interface to a two-column field layout:

- map window on the left
- database/detail editing on the right
- right panel with its own vertical scroll
- PWA manifest adjusted toward fullscreen/landscape display where supported

## Important

The complete package is still in the attached ZIP archive from the ChatGPT session. I initialized the GitHub repository, but the current GitHub connector available here does not provide a direct bulk ZIP/file-upload action and cannot reliably upload the large binary and bundled assets in one operation. The full package should be pushed from a local machine with normal Git access using the commands below.

```bash
git clone https://github.com/JaroslavArbo/VetBara.git
cd VetBara
unzip /path/to/boot_v62_tablet_layout_fix.zip
# If the ZIP extracts into boot_v61/, move contents to repo root:
rsync -a boot_v61/ ./
rm -rf boot_v61
git add .
git commit -m "Add final VetBara v62 source package"
git push origin main
```

Recommended after pushing: verify tablet landscape layout on an actual tablet and as an installed PWA, because browser fullscreen behavior depends on the browser and operating system.
