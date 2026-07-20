<script lang="ts">
  // A clean recreation of the in-game gem "Processing" window, auto-filled from a parse. It is both
  // the readout AND the capture confirmation: if the wheel shows your actual gem, the share is lined
  // up right. Fields the parser was unsure about (confidence < 0.8) glow amber to "please verify".
  // Colors/layout mirror shizukaziye's advisor-window.js: willpower red (top), order gold (bottom),
  // the two effects green (left) / blue (right) by SLOT, gem name tinted by rarity.
  import type { ParsedAdvisorState } from '../../lib/advisor/advisorController';

  interface Props {
    parsed: ParsedAdvisorState;
  }
  let { parsed }: Props = $props();

  let c = $derived(parsed.config);
  let s = $derived(parsed.state);
  let pointsSum = $derived(c.willpowerLevel + c.orderLevel + c.effect1Level + c.effect2Level);

  // Per-field confidence map (when the parser supplied one). Below 0.8 = flag for a look.
  type Conf = { config?: Record<string, number>; state?: Record<string, number>; outcomes?: number[] };
  let conf = $derived((parsed.confidence ?? null) as Conf | null);
  function lowConfig(field: string): boolean {
    const v = conf?.config?.[field];
    return v != null && v < 0.8;
  }
  function lowState(field: string): boolean {
    const v = conf?.state?.[field];
    return v != null && v < 0.8;
  }
  function lowOutcome(i: number): boolean {
    const v = conf?.outcomes?.[i];
    return v != null && v < 0.8;
  }
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

  const statName = (target: string | undefined): string => {
    if (target === 'willpower') return 'Willpower';
    if (target === 'order') return c.gemType === 'chaos' ? 'Chaos' : 'Order';
    if (target === 'effect1') return c.effect1;
    if (target === 'effect2') return c.effect2;
    return target ?? '';
  };
  function caption(o: { type: string; target?: string; amount?: number }): string {
    switch (o.type) {
      case 'raise_effect':
        return `${statName(o.target)} +${o.amount ?? 1} ▲`;
      case 'lower_effect':
        return `${statName(o.target)} −${o.amount ?? 1} ▼`;
      case 'change_side_option':
        return `${statName(o.target)}: effect changed`;
      case 'change_gold_cost':
        return 'Processing cost change';
      case 'reroll_increase':
        return `View other items +${o.amount ?? 1}`;
      default:
        return '—';
    }
  }
</script>

<div class="pw" data-testid="processing-window">
  <div class="pw-head">
    <span class="pw-name" data-role={c.gemType}>{c.gemType === 'chaos' ? 'Chaos' : 'Order'} Astrogem</span>
    <span class="pw-cost">cost {c.baseCost}</span>
    <span class="pw-points" class:flag={lowConfig('willpowerLevel') || lowConfig('orderLevel')}>
      {pointsSum} Astrogem Points
    </span>
  </div>

  <div class="pw-wheel">
    <div class="dial"></div>
    <div class="node n">
      <div class="diamond wp" class:flag={lowConfig('willpowerLevel')}><span>{c.willpowerLevel}</span></div>
      <span class="lbl">Willpower</span>
    </div>
    <div class="node w">
      <div class="diamond e1" class:flag={lowConfig('effect1') || lowConfig('effect1Level')}>
        <span>{c.effect1Level}</span>
      </div>
      <span class="lbl">{c.effect1}</span>
    </div>
    <div class="node e">
      <div class="diamond e2" class:flag={lowConfig('effect2') || lowConfig('effect2Level')}>
        <span>{c.effect2Level}</span>
      </div>
      <span class="lbl">{c.effect2}</span>
    </div>
    <div class="node s">
      <div class="diamond ord" class:flag={lowConfig('orderLevel')}><span>{c.orderLevel}</span></div>
      <span class="lbl">{c.gemType === 'chaos' ? 'Chaos' : 'Order'} Points</span>
    </div>
  </div>

  <div class="pw-turn">
    Turn {s.currentTurn} / {s.maxTurns} · rerolls {s.rerollsRemaining}
  </div>

  <div class="pw-outcomes-hint">One of the following is randomly applied:</div>
  <div class="pw-outcomes">
    {#each parsed.outcomes as o, i (i)}
      <div class="ocell" class:flag={lowOutcome(i)}>{caption(o)}</div>
    {/each}
  </div>

  {#if flaggedCount > 0 || parsed.ocrDegraded}
    <div class="pw-confstrip">
      {#if parsed.ocrDegraded}
        Low-confidence read — double-check the highlighted fields against your screen.
      {:else}
        Parsed — {flaggedCount} field{flaggedCount > 1 ? 's' : ''} to double-check (highlighted).
      {/if}
    </div>
  {/if}
</div>

<style>
  .pw {
    border: 1px solid var(--border);
    border-radius: 0.6rem;
    background: #1b1e24;
    color: #e8e8ea;
    padding: 0.75rem 0.75rem 0.9rem;
    max-width: 360px;
  }
  .pw-head {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.4rem;
  }
  .pw-name {
    font-weight: 700;
  }
  .pw-name[data-role='chaos'] {
    color: #b06fe0;
  }
  .pw-name[data-role='order'] {
    color: #4f9be0;
  }
  .pw-cost {
    font-size: 0.8rem;
    opacity: 0.75;
  }
  .pw-points {
    margin-left: auto;
    font-size: 0.8rem;
    opacity: 0.85;
  }
  .pw-wheel {
    position: relative;
    width: 300px;
    height: 250px;
    margin: 0 auto;
    max-width: 100%;
  }
  .dial {
    position: absolute;
    left: 50%;
    top: 50%;
    width: 200px;
    height: 200px;
    transform: translate(-50%, -50%);
    border: 1.5px dashed #565f6e;
    border-radius: 50%;
  }
  .node {
    position: absolute;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    width: 92px;
    text-align: center;
  }
  .node.n {
    left: 50%;
    top: 2px;
    transform: translateX(-50%);
  }
  .node.s {
    left: 50%;
    bottom: 2px;
    transform: translateX(-50%);
  }
  .node.w {
    left: 0;
    top: 50%;
    transform: translateY(-50%);
  }
  .node.e {
    right: 0;
    top: 50%;
    transform: translateY(-50%);
  }
  .diamond {
    width: 46px;
    height: 46px;
    transform: rotate(45deg);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.15);
  }
  .diamond span {
    transform: rotate(-45deg);
    font-weight: 700;
    font-size: 1.1rem;
    color: #fff;
  }
  .diamond.wp {
    background: linear-gradient(135deg, #c0392b, #e0533f);
  }
  .diamond.ord {
    background: linear-gradient(135deg, #c98a2e, #e0a83f);
  }
  .diamond.e1 {
    background: linear-gradient(135deg, #4a9e3f, #6ab84f);
  }
  .diamond.e2 {
    background: linear-gradient(135deg, #2f7fd0, #3f9be0);
  }
  .diamond.flag,
  .pw-points.flag,
  .ocell.flag {
    outline: 2px solid #f0b429;
    outline-offset: 2px;
    animation: pulse 1.4s ease-in-out infinite;
  }
  @keyframes pulse {
    50% {
      outline-color: rgba(240, 180, 41, 0.35);
    }
  }
  .lbl {
    font-size: 0.72rem;
    line-height: 1.1;
    opacity: 0.9;
  }
  .pw-turn {
    text-align: center;
    font-size: 0.8rem;
    opacity: 0.85;
    margin: 0.25rem 0 0.5rem;
  }
  .pw-outcomes-hint {
    font-size: 0.75rem;
    opacity: 0.7;
    margin-bottom: 0.3rem;
  }
  .pw-outcomes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.35rem;
  }
  .ocell {
    background: #24272e;
    border: 1px solid #333842;
    border-radius: 0.35rem;
    padding: 0.3rem 0.45rem;
    font-size: 0.78rem;
  }
  .pw-confstrip {
    margin-top: 0.5rem;
    padding: 0.35rem 0.5rem;
    border-radius: 0.35rem;
    background: rgba(240, 180, 41, 0.15);
    color: #f0b429;
    font-size: 0.78rem;
  }
</style>
