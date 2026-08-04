<script lang="ts">
  import type { GridProgress } from '../../lib/scoring/gridProgress';

  type Props = { progress: GridProgress; dimmed?: boolean };
  let { progress, dimmed = false }: Props = $props();
  const pct = (n: number) => `${n.toFixed(2)}%`;
  // The current-CP label rides the head of the fill, so a gain visibly travels along the bar toward
  // the ceiling. It is centred on that point, so the anchor is held a little inside both ends or half
  // the label would hang off the track; between those bounds it tracks the fill exactly, and real
  // grids sit well inside them.
  let curLeft = $derived(Math.min(90, Math.max(10, progress.fillPos)));
</script>

<div class="root" class:dimmed>
  <div class="title">Ark Grid Combat Power</div>
  <div class="track">
    <span class="cur" style="left:{curLeft}%">+{pct(progress.current)}</span>
    <div class="bar" role="img"
         aria-label="Current combat power {pct(progress.current)}, ceiling {pct(progress.ceiling)}, {progress.pctOfCeiling.toFixed(1)} percent of the way there">
      <div class="beyond" style="left:{progress.ceilingPos}%"></div>
      <div class="fill" style="width:{progress.fillPos}%"></div>
      <div class="ceiling" style="left:{progress.ceilingPos}%"></div>
    </div>
  </div>
  <div class="ends">
    <span class="ceil">ceiling +{pct(progress.ceiling)}</span>
  </div>
  <!-- The headline is the answer to the question this panel exists to ask, so it is centred under
       the bar it summarises, with the explanation on its own line beneath. -->
  <div class="foot">
    <div class="headline">{progress.pctOfCeiling.toFixed(1)}% of your current ceiling</div>
    <div class="note">Gems close the gap, cores move the ceiling.</div>
  </div>
</div>

<style>
  .root { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
  .dimmed { opacity: 0.55; }
  .title { font-weight: 600; font-size: 1rem; }
  .foot {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 0.1rem;
    margin-top: 0.15rem;
  }
  .bar {
    position: relative;
    height: 12px;
    border-radius: 6px;
    background: color-mix(in srgb, var(--text) 12%, transparent);
    overflow: hidden;
  }
  /* the unreachable-with-these-cores stretch, deliberately faint: context, not a target */
  .beyond {
    position: absolute; top: 0; bottom: 0; right: 0;
    background: repeating-linear-gradient(
      90deg,
      color-mix(in srgb, var(--text) 8%, transparent) 0 3px,
      transparent 3px 6px
    );
  }
  .fill {
    position: absolute; top: 0; bottom: 0; left: 0;
    background: var(--accent, #6aa9e9);
    border-radius: 6px 0 0 6px;
  }
  .ceiling {
    position: absolute; top: -2px; bottom: -2px;
    width: 2px;
    background: #f0b429;
  }
  /* padding-top reserves the band the floating label lives IN. The label must sit inside that band
     (top: 0), not above it: anchoring it to bottom: 100% put it above the track entirely, which drops
     it onto the title and makes both unreadable whenever the fill is short. */
  .track { position: relative; padding-top: 1.45rem; }
  .cur {
    position: absolute;
    top: 0;
    transform: translateX(-50%);
    white-space: nowrap;
    color: var(--accent, #6aa9e9);
    font-weight: 600;
    font-size: 0.86rem;
  }
  .ends { display: flex; justify-content: flex-end; font-size: 0.86rem; }
  .ceil { color: #f0b429; }
  .headline { font-size: 1.05rem; font-weight: 600; }
  .note { font-size: 0.82rem; color: color-mix(in srgb, var(--text) 65%, transparent); }
</style>
