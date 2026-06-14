# Builds the shared plugin engines and copies them into Owncast's embed dir.
#
#   make            # build both engines into ../owncast/services/plugins/engines/
#   make js         # JS engine only
#   make python     # Python engine only
#
# Override the destination with OWNCAST_ENGINE_DIR (points at the language
# subdir's parent), or pass a dir to the underlying scripts directly.
#
# The engines are committed into the Owncast repo so its Go build stays
# toolchain-free (go:embed). Rebuild + commit whenever engines/javascript/entry.js,
# engines/build_py.py's bootstrap, or the SDK runtime changes. See README.md.

.PHONY: all js python toolchain
all: js python

# Fetch the JS engine-build toolchain (extism-js + binaryen) into .toolchain/.
# Idempotent; the Python engine fetches its own (extism-py) via the Python SDK.
toolchain:
	node install-toolchain.mjs

js: toolchain
	node build.mjs

python:
	python3 build_py.py
