<script lang="ts">
  // A faithful recreation of the in-game gem "Processing" window, auto-filled from a parse. It is
  // both the readout AND the capture confirmation: if the wheel shows your actual gem, the share is
  // lined up right. Fields the parser was unsure about (confidence < 0.8) glow amber to "please
  // verify". Layout / colors mirror the game: Willpower red (top), the two effects green (left) /
  // blue (right) BY SLOT, Order/Chaos Points gold (bottom); the gem name is tinted by RARITY; each
  // gem sits in an ornate bronze frame over a faint zodiac dial.
  import type { ParsedAdvisorState } from '../../lib/advisor/advisorController';

  interface Props {
    parsed: ParsedAdvisorState;
  }
  let { parsed }: Props = $props();

  let c = $derived(parsed.config);
  let s = $derived(parsed.state);
  let pointsSum = $derived(c.willpowerLevel + c.orderLevel + c.effect1Level + c.effect2Level);
  let isChaos = $derived(c.gemType === 'chaos');
  // Rarity from the turn budget (5 uncommon, 7 rare, 9 epic) — it tints the gem name like the game.
  let rarity = $derived(s.maxTurns <= 5 ? 'uncommon' : s.maxTurns <= 7 ? 'rare' : 'epic');

  const GEM_NAMES: Record<number, { order: string; chaos: string }> = {
    8: { order: 'Stability', chaos: 'Corrosion' },
    9: { order: 'Solidity', chaos: 'Distortion' },
    10: { order: 'Immutability', chaos: 'Destruction' },
  };
  let gemName = $derived(GEM_NAMES[c.baseCost]?.[isChaos ? 'chaos' : 'order'] ?? '');

  type Conf = { config?: Record<string, number>; state?: Record<string, number>; outcomes?: number[] };
  let conf = $derived((parsed.confidence ?? null) as Conf | null);
  const lowConfig = (f: string) => {
    const v = conf?.config?.[f];
    return v != null && v < 0.8;
  };
  const lowOutcome = (i: number) => {
    const v = conf?.outcomes?.[i];
    return v != null && v < 0.8;
  };
  let flaggedCount = $derived(
    [
      lowConfig('willpowerLevel'),
      lowConfig('orderLevel'),
      lowConfig('effect1'),
      lowConfig('effect1Level'),
      lowConfig('effect2'),
      lowConfig('effect2Level'),
      lowConfig('baseCost'),
      lowConfig('gemType'),
      ...parsed.outcomes.map((_, i) => lowOutcome(i)),
    ].filter(Boolean).length
  );

  const TICKS = Array.from({ length: 24 }, (_, i) => (i * 360) / 24);

  const statName = (target: string | undefined): string => {
    if (target === 'willpower') return 'Willpower Efficiency';
    if (target === 'order') return isChaos ? 'Chaos Points' : 'Order Points';
    if (target === 'effect1') return c.effect1;
    if (target === 'effect2') return c.effect2;
    return target ?? '';
  };
  const slotOf = (target: string | undefined) =>
    target === 'effect1'
      ? 'e1'
      : target === 'effect2'
        ? 'e2'
        : target === 'willpower'
          ? 'wp'
          : target === 'order'
            ? 'ord'
            : 'none';
  function outcomeParts(o: { type: string; target?: string; amount?: number }) {
    const slot = slotOf(o.target);
    switch (o.type) {
      case 'raise_effect':
        return { name: statName(o.target), sub: `Lv. +${o.amount ?? 1}`, dir: 'up', slot };
      case 'lower_effect':
        return { name: statName(o.target), sub: `Lv. −${o.amount ?? 1}`, dir: 'down', slot };
      case 'change_side_option':
        return { name: statName(o.target), sub: 'Effect Changed', dir: 'none', slot };
      case 'change_gold_cost':
        return { name: 'Processing Cost', sub: `${(o.amount ?? 0) >= 0 ? '+' : ''}${o.amount ?? ''}%`, dir: 'none', slot: 'none' };
      case 'reroll_increase':
        return { name: 'View Other Items', sub: `+${o.amount ?? 1}`, dir: 'none', slot: 'none' };
      default:
        return { name: '—', sub: '', dir: 'none', slot: 'none' };
    }
  }
</script>

<div class="pw" data-testid="processing-window">
  <div class="pw-title">Processing</div>
  <div class="pw-name" data-rarity={rarity}>
    {isChaos ? 'Chaos' : 'Order'} Astrogem{gemName ? `: ${gemName}` : ''}
  </div>
  <div class="pw-points" class:flag={lowConfig('willpowerLevel') || lowConfig('orderLevel')}>
    {pointsSum} Astrogem Points
    <span class="q" title="The four levels summed. Check it against the number the game shows.">?</span>
  </div>

  <div class="pw-wheel">
    <svg class="dial" viewBox="0 0 300 300" aria-hidden="true">
      <circle cx="150" cy="150" r="134" class="ring outer" />
      <circle cx="150" cy="150" r="112" class="ring dash" />
      <circle cx="150" cy="150" r="88" class="ring inner" />
      {#each TICKS as a (a)}
        <line x1="150" y1="24" x2="150" y2="36" class="tick" transform={`rotate(${a} 150 150)`} />
      {/each}
    </svg>

    {#each [{ pos: 'n', slot: 'wp', label: 'Willpower Efficiency', lv: `${c.willpowerLevel}`, flag: lowConfig('willpowerLevel') }, { pos: 'w', slot: 'e1', label: c.effect1, lv: `Lv. ${c.effect1Level}`, flag: lowConfig('effect1') || lowConfig('effect1Level') }, { pos: 'e', slot: 'e2', label: c.effect2, lv: `Lv. ${c.effect2Level}`, flag: lowConfig('effect2') || lowConfig('effect2Level') }, { pos: 's', slot: isChaos ? 'chaos' : 'ord', label: isChaos ? 'Chaos Points' : 'Order Points', lv: `${c.orderLevel}`, flag: lowConfig('orderLevel') }] as node (node.pos)}
      <div class="node {node.pos}">
        <div class="frame">
          <div class="gem {node.slot}" class:flag={node.flag}>
            <div class="face">
              <span class="dlabel">{node.label}</span>
              <span class="dlv">{node.lv}</span>
            </div>
          </div>
        </div>
      </div>
    {/each}
  </div>

  <div class="pw-turn">Turn {s.currentTurn} / {s.maxTurns} · rerolls {s.rerollsRemaining}</div>

  <div class="pw-hint">One of the following is randomly applied</div>
  <div class="pw-outcomes">
    {#each parsed.outcomes as o, i (i)}
      {@const p = outcomeParts(o)}
      <div class="ochip" data-slot={p.slot} class:flag={lowOutcome(i)}>
        <span class="oicon {p.slot}"></span>
        <span class="otext">
          <span class="oname">{p.name}</span>
          <span class="osub">
            {p.sub}
            {#if p.dir === 'up'}<span class="up">▲</span>{:else if p.dir === 'down'}<span class="dn">▼</span>{/if}
          </span>
        </span>
      </div>
    {/each}
  </div>

  {#if flaggedCount > 0 || parsed.ocrDegraded}
    <div class="pw-confstrip">
      {#if parsed.ocrDegraded}
        Low-confidence read — double-check the highlighted fields against your screen.
      {:else}
        {flaggedCount} field{flaggedCount > 1 ? 's' : ''} to double-check (highlighted).
      {/if}
    </div>
  {/if}
</div>

<style>
  .pw {
    --gold: #c9a24a;
    --gold-dim: #6a5a2e;
    --bronze1: #cbb072;
    --bronze2: #7a6330;
    position: relative;
    width: 340px;
    max-width: 100%;
    padding: 0.85rem 1rem 1rem;
    border-radius: 0.7rem;
    color: #e7e3d6;
    background: radial-gradient(120% 90% at 50% 0%, #1e2740 0%, #121728 55%, #0b0e18 100%);
    border: 1px solid #3a3a52;
    box-shadow:
      inset 0 0 0 1px rgba(201, 162, 74, 0.22),
      inset 0 0 40px rgba(0, 0, 0, 0.6),
      0 8px 24px rgba(0, 0, 0, 0.45);
  }
  .pw-title {
    text-align: center;
    font-family: Georgia, 'Times New Roman', serif;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    font-size: 1rem;
    color: #eae4d0;
    text-shadow: 0 0 8px rgba(201, 162, 74, 0.5), 0 1px 2px rgba(0, 0, 0, 0.9);
    margin-bottom: 0.3rem;
  }
  .pw-name {
    text-align: center;
    font-family: Georgia, 'Times New Roman', serif;
    font-weight: 700;
    font-size: 1.05rem;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
  }
  .pw-name[data-rarity='epic'] {
    color: #c07be6;
  }
  .pw-name[data-rarity='rare'] {
    color: #5aa9e6;
  }
  .pw-name[data-rarity='uncommon'] {
    color: #6ab84f;
  }
  .pw-points {
    text-align: center;
    font-size: 0.82rem;
    color: #d8c891;
    margin: 0.15rem 0 0.35rem;
  }
  .pw-points .q {
    display: inline-block;
    width: 14px;
    height: 14px;
    line-height: 13px;
    border-radius: 50%;
    border: 1px solid #4f7a3a;
    font-size: 0.7rem;
    color: #6ab84f;
    cursor: help;
  }

  .pw-wheel {
    position: relative;
    width: 300px;
    height: 300px;
    margin: 0 auto;
    max-width: 100%;
  }
  .dial {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }
  .ring {
    fill: none;
    stroke: var(--gold-dim);
  }
  .ring.outer {
    stroke-width: 1;
    opacity: 0.55;
  }
  .ring.dash {
    stroke-width: 1.5;
    opacity: 0.4;
    stroke-dasharray: 2 7;
  }
  .ring.inner {
    stroke-width: 1;
    opacity: 0.4;
  }
  .tick {
    stroke: var(--gold-dim);
    stroke-width: 1.5;
    opacity: 0.5;
  }

  .node {
    position: absolute;
    width: 96px;
    height: 96px;
  }
  /* Tight cross: the four gems nearly touch at the center of the 300px wheel. */
  .node.n {
    left: 102px;
    top: 34px;
  }
  .node.s {
    left: 102px;
    top: 170px;
  }
  .node.w {
    left: 34px;
    top: 102px;
  }
  .node.e {
    left: 170px;
    top: 102px;
  }

  /* Ornate bronze frame that the colored gem sits inside. */
  .frame {
    width: 96px;
    height: 96px;
    transform: rotate(45deg);
    border-radius: 14px;
    padding: 6px;
    background: linear-gradient(150deg, var(--bronze1), var(--bronze2) 55%, #4a3c1c);
    box-shadow:
      inset 0 2px 3px rgba(255, 240, 200, 0.6),
      inset 0 -4px 8px rgba(0, 0, 0, 0.55),
      0 3px 8px rgba(0, 0, 0, 0.5);
  }
  .gem {
    width: 100%;
    height: 100%;
    border-radius: 9px;
    position: relative;
    box-shadow:
      inset 0 3px 6px rgba(255, 255, 255, 0.45),
      inset 0 -8px 14px rgba(0, 0, 0, 0.5);
  }
  /* Specular gloss on the upper half. */
  .gem::before {
    content: '';
    position: absolute;
    inset: 5px 5px 48% 5px;
    border-radius: 7px;
    background: linear-gradient(155deg, rgba(255, 255, 255, 0.55), rgba(255, 255, 255, 0) 72%);
    pointer-events: none;
  }
  .gem .face {
    position: absolute;
    inset: 0;
    transform: rotate(-45deg);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    text-align: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
  }
  .dlabel {
    font-size: 0.6rem;
    line-height: 1.05;
    font-weight: 600;
    color: #fff;
    max-width: 80px;
  }
  .dlv {
    font-size: 0.85rem;
    font-weight: 800;
    color: #ffe08a;
  }
  .gem.wp {
    background: linear-gradient(150deg, #e0533f, #a02418);
  }
  .gem.e1 {
    background: linear-gradient(150deg, #6ab84f, #2f7a2a);
  }
  .gem.e2 {
    background: linear-gradient(150deg, #4f9be0, #245a9e);
  }
  .gem.ord {
    background: linear-gradient(150deg, #e0b84a, #8a6318);
  }
  .gem.chaos {
    background: linear-gradient(150deg, #e0a83f, #8a5a18);
  }
  .gem.flag {
    outline: 2px solid #f0b429;
    outline-offset: 3px;
    animation: pulse 1.4s ease-in-out infinite;
  }
  .pw-points.flag,
  .ochip.flag {
    outline: 2px solid #f0b429;
    outline-offset: 2px;
    border-radius: 4px;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      outline-color: rgba(240, 180, 41, 0.3);
    }
  }

  .pw-turn {
    text-align: center;
    font-size: 0.8rem;
    color: #b9b39c;
    margin: 0.1rem 0 0.55rem;
  }
  .pw-hint {
    text-align: center;
    font-size: 0.75rem;
    color: #9a957f;
    margin-bottom: 0.4rem;
  }
  .pw-outcomes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }
  .ochip {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: linear-gradient(180deg, #222a3c, #171d2c);
    border: 1px solid #333c52;
    border-radius: 0.35rem;
    padding: 0.32rem 0.5rem;
    font-size: 0.76rem;
    line-height: 1.12;
  }
  .oicon {
    flex: none;
    width: 12px;
    height: 12px;
    transform: rotate(45deg);
    border-radius: 2px;
    background: #667;
  }
  .oicon.e1 {
    background: linear-gradient(150deg, #6ab84f, #2f7a2a);
  }
  .oicon.e2 {
    background: linear-gradient(150deg, #4f9be0, #245a9e);
  }
  .oicon.wp {
    background: linear-gradient(150deg, #e0533f, #a02418);
  }
  .oicon.ord,
  .oicon.chaos {
    background: linear-gradient(150deg, #e0b84a, #8a6318);
  }
  .oname {
    display: block;
    font-weight: 600;
    color: #e7e3d6;
  }
  .osub {
    color: #a9a48d;
  }
  .osub .up {
    color: #6ab84f;
  }
  .osub .dn {
    color: #e06a6a;
  }
  .pw-confstrip {
    margin-top: 0.55rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.35rem;
    background: rgba(240, 180, 41, 0.14);
    color: #f0b429;
    font-size: 0.76rem;
    text-align: center;
  }
</style>
