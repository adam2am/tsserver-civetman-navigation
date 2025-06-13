import ts from 'typescript/lib/tsserverlibrary';
import fs from 'fs';
import path from 'path';
import { walkAndPatchSpans } from './core/mapper';

export = function init(mod: typeof ts) {
  /** Entry point called by ts-server */
  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const ls = info.languageService;
    const proxy = Object.create(null) as ts.LanguageService;

    // Helper to write identifiable entries to the TS server log
    const log = (msg: string) => {
      try {
        info.project.projectService.logger.info(`[CIVET_PLUGIN] ${msg}`);
      } catch {
        /* ignore if logger is unavailable */
      }
    };

    log('plugin wired-up');

    // precompute fileExists helper
    const fileExists = (p: string) => {
      return (
        (info.languageServiceHost as any).fileExists?.(p) ||
        ts.sys.fileExists?.(p) ||
        false
      );
    };

    // generic patch helper
    const patch = <T>(v: T) => walkAndPatchSpans(v as any, log, fileExists) as T;

    // -------------------------------------------------------------------
    // Module-resolution shortcut: bare './foo' should resolve to foo.ts
    // if foo.civet + foo.ts sit side-by-side.
    // -------------------------------------------------------------------
    const civetResolve = (name: string, containing: string): ts.ResolvedModuleFull | undefined => {
      // Only act on specifiers with NO extension
      if (path.extname(name)) return undefined;
      const dir = path.dirname(containing);
      const civetPath = path.resolve(dir, name + '.civet');
      const tsPath    = path.resolve(dir, name + '.ts');
      if (fileExists(civetPath) && fileExists(tsPath)) {
        log(`[RESOLVE] '${name}' -> ${path.basename(tsPath)} (civet sibling)`);
        return { resolvedFileName: tsPath, extension: ts.Extension.Ts, isExternalLibraryImport: false };
      }
      return undefined;
    };

    // legacy resolver API
    const origResolveNames = info.languageServiceHost.resolveModuleNames?.bind(info.languageServiceHost);
    if (origResolveNames) {
      info.languageServiceHost.resolveModuleNames = (moduleNames, containingFile, ...rest) => {
        return moduleNames.map((mn, idx) => {
          const fromCivet = civetResolve(mn, containingFile);
          if (fromCivet) return fromCivet;
          const r = origResolveNames(moduleNames, containingFile, ...rest);
          return r ? r[idx] : undefined;
        });
      };
      }

    // TS 5.8+ resolver API
    const origResolveLits = (info.languageServiceHost as any).resolveModuleNameLiterals?.bind(info.languageServiceHost);
    if (origResolveLits) {
      (info.languageServiceHost as any).resolveModuleNameLiterals = (lits: ts.StringLiteralLike[], containingFile: string, ...rest: any[]) => {
        return lits.map((lit, idx) => {
          const fromCivet = civetResolve(lit.text, containingFile);
          if (fromCivet) return fromCivet;
          const r = (origResolveLits as any)(lits, containingFile, ...rest);
          return r ? r[idx] : undefined;
        });
    };
    }

    for (const k in ls) {
      const key = k as keyof ts.LanguageService;
      if (typeof (ls as any)[key] === 'function') {
        (proxy as any)[key] = (...args: any[]) => {
          const result = (ls as any)[key](...args);
          return patch(result);
        };
      } else {
        (proxy as any)[key] = (ls as any)[key];
      }
    }

    // After proxying everything, restore the original resolver hooks
    info.languageServiceHost.resolveModuleNames = origResolveNames;
    (info.languageServiceHost as any).resolveModuleNameLiterals = origResolveLits;

    return proxy;
  }

  return { create };
};