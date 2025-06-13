# tsserver-civetman-navigation

> TypeScript language-service plugin that maps navigation information (go-to-definition, find-references, etc.) from the generated `.ts/.tsx` files back to their original `.civet` sources.  It also adds a small resolver helper so that `import './foo'` correctly resolves to `foo.ts` when a sibling `foo.civet` file is present.

## Motivation

When you compile [Civet](https://github.com/DanielXMoore/Civet) with [Vite-Civetman](https://www.npmjs.com/package/vite-plugin-civetman-fork) or [Civetman](https://www.npmjs.com/package/civetman-fork) to a TypeScript you end up with generated `.ts` (or `.tsx`) files that are fed to the TypeScript server (`tsserver`).  Unfortunately the editor only knows how to navigate inside those generated files when you import ./module, so even though the original source of truth is the `.civet` file and it works smoothly in a runtime because of generated `.ts`, it would ignore original file. This plugin fixes that by reading the source-maps emitted by the Civet compiler from Civetman and translating every position the TypeScript server returns back to the corresponding position in the original file.

## Installation

```
# using pnpm
pnpm add -D tsserver-civetman-navigation
# using yarn
yarn add --dev tsserver-civetman-navigation
# using npm
npm install --save-dev tsserver-civetman-navigation
```

You normally install the plugin **as a dev-dependency** of your project because it is loaded by the editor-embedded `tsserver`, not at runtime.

## Usage

Add the plugin to your `tsconfig.json`:

```jsonc
{
  "compilerOptions": {
    // ... your usual options ...
    "plugins": [
      { "name": "tsserver-civetman-navigation" }
    ]
  }
}
```

Reload the TypeScript server (or restart your editor) and enjoy Civet-aware navigation and references directly inside your `.civet` files.

## How it works

1. The plugin proxies every method of the TypeScript language service.
2. For each return value it walks the structure recursively, looking for objects that look like *locations* (they contain `fileName` and `textSpan`).
3. When the file has a sibling `.civet` file and a valid source-map, the span is converted back to the original position using [`@jridgewell/trace-mapping`](https://github.com/jridgewell/trace-mapping).
4. After patching all spans the proxy also removes duplicate entries so that the resulting arrays contain only Civet locations.

Some extra sugar is added to module resolution so that the bare specifier `import './foo'` prefers `foo.ts` when both `foo.civet` **and** `foo.ts` exist side by side.

## Development / Contributing

```bash
pnpm install
pnpm run build
```

The build is performed with [`tsup`](https://tsup.egoist.dev/) and outputs CommonJS + type declarations to `dist/`.

Feel free to open issues or pull requests on GitHub.

## License

MIT © 2025 adam2am 