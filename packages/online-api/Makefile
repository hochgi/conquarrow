# SAM must run this Makefile in-source (`sam build --build-in-source`).
# CopySource of CodeUri alone cannot resolve `../../web/src/opponent` or pnpm
# `@aws-sdk` / `@smithy` symlinks.
.PHONY: build-OnlineFunction build-MoveFunction build-WsConnectFunction build-McpFunction

build-OnlineFunction build-MoveFunction:
	esbuild src/http.ts \
		--bundle \
		--platform=node \
		--format=cjs \
		--target=es2022 \
		--outfile=$(ARTIFACTS_DIR)/http.js

build-WsConnectFunction:
	esbuild src/ws.ts \
		--bundle \
		--platform=node \
		--format=cjs \
		--target=es2022 \
		--outfile=$(ARTIFACTS_DIR)/ws.js

build-McpFunction:
	esbuild src/mcp-http.ts \
		--bundle \
		--platform=node \
		--format=cjs \
		--target=es2022 \
		--outfile=$(ARTIFACTS_DIR)/mcp-http.js
