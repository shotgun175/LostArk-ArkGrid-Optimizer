<script lang="ts">
  import type { GridProgress } from '../../lib/scoring/gridProgress';

  type Props = { progress: GridProgress; dimmed?: boolean };
  let { progress, dimmed = false }: Props = $props();
  const pct = (n: number) => `${n.toFixed(2)}%`;
</script>

<div class="root" class:dimmed>
  <div class="title">Ark Grid Combat Power</div>
  <div class="bar" role="img"
       aria-label="Current combat power {pct(progress.current)}, ceiling {pct(progress.ceiling)}, {progress.pctOfCeiling.toFixed(1)} percent of the way there">
    <div class="beyond" style="left:{progress.ceilingPos}%"></div>
    <div class="fill" style="width:{progress.fillPos}%"></div>
    <div class="ceiling" style="left:{progress.ceilingPos}%"></div>
  </div>
  <div class="ends">
    <span class="cur">+{pct(progress.current)}</span>
    <span class="ceil">ceiling +{pct(progress.ceiling)}</span>
  </div>
  <div class="headline">{progress.pctOfCeiling.toFixed(1)}% of your current ceiling</div>
  <div class="note">Better gems close the gap. Better cores move the ceiling.</div>
</div>

<style>
  .root { display: flex; flex-direction: column; gap: 0.3rem; }
  .dimmed { opacity: 0.55; }
  .title { font-weight: 600; font-size: 0.92rem; }
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
  .ends { display: flex; justify-content: space-between; font-size: 0.76rem; }
  .cur { color: var(--accent, #6aa9e9); font-weight: 600; }
  .ceil { color: #f0b429; }
  .headline { font-size: 0.95rem; font-weight: 600; }
  .note { font-size: 0.72rem; color: color-mix(in srgb, var(--text) 65%, transparent); }
</style>
