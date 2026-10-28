import { describe, expect, it } from 'vitest';

import { isNewerBuild, moduleScripts } from './updateCheck';

// The shape Vite writes into dist/index.html, and the one its dev server serves.
const BUILT = `<!doctype html><html><head>
  <link rel="icon" href="/LostArk-ArkGrid-Optimizer/favicon.png" />
  <script type="module" crossorigin src="/LostArk-ArkGrid-Optimizer/assets/index-CDW-82vK.js"></script>
  <link rel="modulepreload" crossorigin href="/LostArk-ArkGrid-Optimizer/assets/index-BEni9kx-.js">
  <link rel="stylesheet" crossorigin href="/LostArk-ArkGrid-Optimizer/assets/index-hSEYLaCh.css">
</head><body><div id="app"></div></body></html>`;
const DEV = `<head><script type="module" src="/LostArk-ArkGrid-Optimizer/@vite/client"></script></head>
<body><div id="app"></div><script type="module" src="/src/main.ts"></script></body>`;

describe('update check: reading the deployed page', () => {
  it('finds the module entry script in a built page, and ignores links and other scripts', () => {
    expect(moduleScripts(BUILT)).toEqual(['/LostArk-ArkGrid-Optimizer/assets/index-CDW-82vK.js']);
    expect(moduleScripts('<script src="/legacy.js"></script><script>inline()</script>')).toEqual([]);
  });

  it('reads every module script in order, in any attribute order and quote style', () => {
    expect(moduleScripts(DEV)).toEqual(['/LostArk-ArkGrid-Optimizer/@vite/client', '/src/main.ts']);
    expect(moduleScripts("<SCRIPT src='/a.js' TYPE='module'></SCRIPT>")).toEqual(['/a.js']);
  });
});

describe('update check: deciding a newer build is live', () => {
  const loaded = moduleScripts(BUILT);

  it('flags a deploy that changed the entry file', () => {
    const next = BUILT.replace('index-CDW-82vK.js', 'index-Zq81kP0a.js');
    expect(isNewerBuild(loaded, moduleScripts(next))).toBe(true);
  });

  it('stays quiet when the page is unchanged, and on the dev server', () => {
    expect(isNewerBuild(loaded, moduleScripts(BUILT))).toBe(false);
    expect(isNewerBuild(moduleScripts(DEV), moduleScripts(DEV))).toBe(false);
  });

  it('never flags a page with no module scripts (an error page or an empty response)', () => {
    expect(isNewerBuild(loaded, moduleScripts('<html><body>404 Not Found</body></html>'))).toBe(false);
    expect(isNewerBuild(loaded, moduleScripts(''))).toBe(false);
  });
});
