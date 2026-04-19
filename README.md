<!-- Fossix README — GitHub-flavored HTML + Markdown -->

<h2 align="center">Fossix</h2>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-326CE5?labelColor=1f2328" alt="License: MIT"></a>
  &nbsp;
  <a href="https://www.npmjs.com/package/@the-aria-group/fossix"><img src="https://img.shields.io/npm/v/%40the-aria-group%2Ffossix?label=npm&logo=npm&color=cb3837" alt="npm package"></a>
  &nbsp;
  <a href="https://github.com/the-aria-group/fossix"><img src="https://img.shields.io/badge/GitHub-the--aria--group%2Ffossix-181717?logo=github&labelColor=1f2328" alt="GitHub repository"></a>
  &nbsp;
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white&labelColor=1f2328" alt="TypeScript"></a>
  &nbsp;
  <a href="https://roblox-ts.com/"><img src="https://img.shields.io/badge/roblox--ts-3.0-00A2FF?labelColor=1f2328" alt="roblox-ts"></a>
  &nbsp;
  <a href="https://wally.run/"><img src="https://img.shields.io/badge/Wally-windification%2Ffossix-EA7600?labelColor=1f2328" alt="Wally package (windification scope)"></a>
</p>

<p align="center"><em>Reliable player data for Roblox — session safety, autosave, and sane DataStore writes.</em></p>

<p align="center">
  Part of <a href="https://github.com/the-aria-group"><strong>Aria</strong></a>
  &nbsp;·&nbsp;
  <code>roblox-ts</code>
  &nbsp;·&nbsp;
  DataStore wrapper
</p>

<p align="center"><sub>Wally registry: <code>windification/fossix</code> · npm: <code>@the-aria-group/fossix</code></sub></p>

<br>

<p>Stop fighting raw <code>GetAsync</code> / <code>SetAsync</code> for profiles. Fossix wraps <code>DataStoreService</code> with <strong>per-key ordering</strong>, <strong>session locks</strong>, and <strong>predictable save timing</strong>, while staying honest about Roblox limits.</p>

<table>
<thead>
<tr>
<th align="left">Capability</th>
<th align="left">What it means for you</th>
</tr>
</thead>
<tbody>
<tr>
<td><strong>Session locking</strong></td>
<td>Fewer clobbered writes when multiple servers touch the same key.</td>
</tr>
<tr>
<td><strong>Autosave + shutdown flush</strong></td>
<td>Data leaves memory on a schedule and when the server closes.</td>
</tr>
<tr>
<td><strong>Per-key queue</strong></td>
<td><code>UpdateAsync</code> work is serialized so races are easier to reason about.</td>
</tr>
<tr>
<td><strong>Mock store</strong></td>
<td>Exercise flows in tests without touching live DataStores.</td>
</tr>
<tr>
<td><strong>Optional compression</strong></td>
<td>Hook in LZ4-style (or custom) compress/decompress for large JSON-shaped payloads.</td>
</tr>
</tbody>
</table>

---

<h3>Install</h3>

<table>
<tr>
<th align="left" width="48%">npm (TypeScript)</th>
<th align="left" width="48%">Wally (Luau)</th>
</tr>
<tr valign="top">
<td>

```bash
npm install @the-aria-group/fossix
```

</td>
<td>

```toml
[dependencies]
Fossix = "windification/fossix@1.0.0"
```

</td>
</tr>
</table>

---

<h3>Quick start</h3>

<p>Open a session when the player joins, persist changes, and end the session when they leave.</p>

```ts
import { FossixStore } from '@the-aria-group/fossix';

interface PlayerData {
  coins: number;
  inventory: string[];
}

const store = FossixStore.createStore<PlayerData>('PlayerData', {
  coins: 0,
  inventory: [],
});

Players.PlayerAdded.Connect(async (player) => {
  const profile = await store.StartSessionAsync(tostring(player.UserId));
  if (!profile) return;

  profile.AddUserId(player.UserId);
  profile.Data.coins += 10;
});

Players.PlayerRemoving.Connect(async (player) => {
  const profile = await store.GetAsync(tostring(player.UserId));
  if (profile) {
    await profile.EndSession();
  }
});
```

---

<h3>Optional compression</h3>

<p>Enable a <strong>JSON encode → compress → buffer</strong> path (and the reverse on load) via <code>FossixConfig.compression</code> and your adapter. Use <code>compression: "lz4"</code> only when you ship a matching adapter; otherwise stick with <code>"none"</code>.</p>

<p><strong>Reality check:</strong> small payloads may not shrink. Measure before turning compression on everywhere. DataStore keys still have platform size limits — plan for roughly <strong>~4 MB</strong> serialized payload per write as a practical ceiling.</p>

<p>Background reading: <a href="https://devforum.roblox.com/t/lower-database-storage-by-400/2975398">Lowering storage for large blobs</a> (DevForum).</p>

---

<blockquote>
<p><strong>Server only, safe data</strong><br>
Use Fossix in <strong>server</strong> scripts. Store serializable tables — not <code>Instance</code> references, functions, or secrets.</p>
</blockquote>

<br>

<details>
<summary><strong>For contributors — running tests (TestEZ)</strong></summary>

<p>Specs live in <code>src/tests</code> and target <a href="https://roblox.github.io/testez/">TestEZ</a> via <a href="https://www.npmjs.com/package/@rbxts/testez"><code>@rbxts/testez</code></a>; compiled output is under <code>out/tests</code>.</p>

<p>Tests run inside Roblox (or Lemur). TestEZ does not await promises — use <a href="https://eryn.io/roblox-lua-promise/lib/#expect"><code>Promise.expect</code></a> (<code>.expect()</code> in TypeScript) inside specs so async work finishes before the case completes.</p>

<ol>
<li>Add <code>@rbxts/testez</code> to your dev place (Rojo) or vendor it from <code>node_modules</code>.</li>
<li>Sync this package’s <code>out</code> tree (see <code>default.project.json</code>) alongside your TestEZ runner.</li>
<li>Use <code>TestBootstrap</code> / <code>TestEZ.run</code> for <code>*.spec</code> discovery, or require <code>out/tests/*.spec</code> manually.</li>
</ol>

<p>Here, <code>npm test</code> is compile + ESLint only. Published npm packages omit compiled specs (<code>.npmignore</code>). If you republish <code>out/</code> for another registry, drop <code>out/tests</code> unless you want specs shipped.</p>

</details>
