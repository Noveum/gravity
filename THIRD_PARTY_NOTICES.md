# Third-party dependencies

Gravity's original source uses Apache-2.0. Dependencies retain their own licenses and copyright notices; the application license does not replace them.

[The generated inventory](docs/dependency-licenses.json) records declared licenses for installed packages from the committed lockfile. Regenerate it with `bun run licenses` after an install or dependency change. Platform-specific packages omitted from the generating machine are listed explicitly. It is a metadata inventory, not a bundle of upstream license text or a legal clearance.

Most installed dependencies declare MIT, Apache-2.0, BSD, ISC, 0BSD or Unlicense terms. The reviewed macOS install also includes MPL-2.0 `lightningcss` packages, CC-BY-4.0 `caniuse-lite` data and an LGPL-3.0-or-later Sharp/libvips binary package. Gravity does not modify those packages. Before distributing standalone/container/binary builds, preserve upstream notices and review the terms and source requirements of the exact platform artifacts included. Hosted deployment and source checkout packaging are different distribution artifacts.

Upstream package license files remain in the installed dependency directories. This repository contains no copied Orbit application code; its visual palette is used as the requested design reference. Gravity's name and Noveum branding are separate from the source license.
