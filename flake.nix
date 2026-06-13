{
  description = "p2p-voicechats — self-hostable voice/chat/screen-share for friends";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      rust-overlay,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs { inherit system overlays; };

        # Single source of truth for the Rust toolchain. Pinned to match the
        # server's Dockerfile (`rust:1.94`) and the cargo shipped in CI, so a
        # build on a laptop, in Docker, in CI, and via Nix all agree. Bump this
        # one line to move every environment together.
        rustToolchain = pkgs.rust-bin.stable."1.94.1".default.override {
          extensions = [
            "rust-src"
            "rust-analyzer"
            "clippy"
            "rustfmt"
          ];
        };

        rustPlatform = pkgs.makeRustPlatform {
          cargo = rustToolchain;
          rustc = rustToolchain;
        };

        # Native libraries the Tauri shell links against on Linux. On Windows
        # the client uses the system WebView2 runtime instead; these are the
        # Linux equivalents needed for `npm run tauri dev`/`build`.
        tauriDeps = with pkgs; [
          webkitgtk_4_1
          gtk3
          libsoup_3
          glib
          cairo
          pango
          gdk-pixbuf
          atk
          librsvg
          openssl
        ];

        # The server: one Rust binary with bundled SQLite. buildRustPackage
        # reads server/Cargo.lock directly, so dependency versions are pinned
        # without a vendored hash to maintain.
        vc-server = rustPlatform.buildRustPackage {
          pname = "vc-server";
          version = "0.1.0";
          src = ./server;
          cargoLock.lockFile = ./server/Cargo.lock;

          # rusqlite's `bundled` feature compiles SQLite from C; the C compiler
          # comes from stdenv, so no extra system deps are required here.

          # The test suite binds sockets and uses reqwest (network); skip it in
          # the sandboxed build and run `cargo test` from the dev shell instead.
          doCheck = false;

          meta = with pkgs.lib; {
            description = "Signaling + ciphertext-storage server for p2p-voicechats";
            license = licenses.mit;
            mainProgram = "vc-server";
            platforms = platforms.unix;
          };
        };
      in
      {
        packages = {
          default = vc-server;
          inherit vc-server;
        };

        apps.default = {
          type = "app";
          program = "${vc-server}/bin/vc-server";
        };

        # `nix flake check` builds the server package.
        checks.vc-server = vc-server;

        formatter = pkgs.nixfmt-rfc-style;

        devShells.default = pkgs.mkShell {
          # Tools on PATH; build-time/native tooling.
          nativeBuildInputs = [
            rustToolchain
            pkgs.nodejs_22
            pkgs.pkg-config
          ];
          # Libraries pkg-config / the linker resolve against (Tauri on Linux).
          buildInputs = tauriDeps;

          # rust-analyzer / IDEs pick up the standard library sources.
          RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";

          shellHook = ''
            echo "p2p-voicechats dev shell"
            echo "  rust : $(rustc --version)"
            echo "  node : $(node --version)"
            echo
            echo "  server : cd server && cargo test && cargo run"
            echo "  client : cd client && npm install && npm run dev"
            echo "           (full desktop app: npm run tauri dev)"
          '';
        };
      }
    );
}
