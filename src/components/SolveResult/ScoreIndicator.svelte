<script lang="ts">
  import { appLocale } from '../../lib/state/locale.state.svelte';

  type ScoreSet = {
    score: number;
    bestScore: number;
    perfectScore: number;
  };

  let { scoreSet } = $props<{ scoreSet: ScoreSet }>();

  let scoreRatio = $derived(Math.min(scoreSet.score / scoreSet.perfectScore, 1));
  let bestRatio = $derived(Math.min(scoreSet.bestScore / scoreSet.perfectScore, 1));
  let totalScore = $derived(scoreRatio / bestRatio);
  let locale = $derived(appLocale.current);
  const LTitle = $derived(
    {
      en_us: 'Ark Grid Combat Power',
    }[locale]
  );
  const LCurrent = $derived(
    {
      en_us: 'Current CP',
    }[locale]
  );
  const LCurrentDesc = $derived(
    {
      en_us: 'This shows the Combat Power increase (%) from your cores and optimized astrogems.',
    }[locale]
  );
  const LMaximum = $derived(
    {
      en_us: 'Maximum CP Potential',
    }[locale]
  );
  const LMaxDesc = $derived(
    {
      en_us:
        'This shows the Combat Power increase could reach with ideal astrogems using your current cores. ' +
        'A smaller gap means you have more high-quality astrogems.',
    }[locale]
  );
  const LTotalScore = $derived(
    {
      en_us: 'Astrogem Score',
    }[locale]
  );
  const LTotalScoreDesc = $derived(
    {
      en_us: 'This shows the value calculated by dividing Current CP by Maximum CP Potential.',
    }[locale]
  );
</script>

<div class="root">
  <div class="title">{LTitle}</div>
  <div class="score-wrapper">
    <div class="score-bar">
      <div class="indicator dot moving" style="--target-left:{scoreRatio * 100}%"></div>
      <div class="indicator bar moving" style="--target-left:{bestRatio * 100}%"></div>
      <div class="label top moving" style="--target-left:{scoreRatio * 100}%">
        +{scoreSet.score.toFixed(2)}%
      </div>
      <div class="label bottom moving" style="--target-left:{bestRatio * 100}%">
        +{scoreSet.bestScore.toFixed(2)}%
      </div>
    </div>
  </div>
  <div class="legend">
    <div class="row">
      <div class="icon">
        <div class="dot"></div>
      </div>
      <div>{LCurrent}</div>
      <span class="tooltip">
        <i class="fa-solid fa-circle-info info-icon"></i>
        <span class="tooltip-text">
          {LCurrentDesc}
        </span>
      </span>
    </div>

    <div class="row">
      <div class="icon">
        <div class="bar"></div>
      </div>
      <div>{LMaximum}</div>
      <span class="tooltip">
        <i class="fa-solid fa-circle-info info-icon"></i>
        <span class="tooltip-text">
          {LMaxDesc}
        </span>
      </span>
    </div>
  </div>

  <div>
    <span class="total-score">{LTotalScore} {(totalScore * 100).toFixed(2)}</span>
    <span class="tooltip">
      <i class="fa-solid fa-circle-info info-icon"></i>
      <span class="tooltip-text">
        {LTotalScoreDesc}
      </span>
    </span>
  </div>
</div>

<style>
  .root {
    display: flex;
    flex-direction: column;
    gap: 2.5rem;
  }
  .root .title {
    font-weight: 500;
    font-size: 1.4rem;
  }

  .score-wrapper {
    width: 20rem;
  }
  .total-score {
    font-size: 1.1rem;
  }
  .total-score::after {
    content: ' / 100';
  }
  /* Bar */
  .score-bar {
    position: relative;
    height: 6px;
    background: var(--border);
    border-radius: 6px;
  }

  .score-bar > .indicator {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translate(-50%, -50%);
  }

  .label {
    position: absolute;
    left: 0;
    top: 50%;
    transform: translate(-50%, -50%);
    white-space: nowrap;
  }
  .label.top {
    top: -1.5rem;
  }
  .label.bottom {
    top: 1.6rem;
  }

  .dot {
    width: 1rem;
    height: 1rem;
    background: var(--primary);
    border-radius: 50%;
  }

  .bar {
    width: 3px;
    height: 1.3rem;
    background-color: var(--anti-bg);
  }

  .score-bar > .moving {
    animation: move-left 0.7s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }

  @keyframes move-left {
    from {
      left: 0%;
    }
    to {
      left: var(--target-left);
    }
  }

  .legend {
    padding-left: 0.2rem;
  }
  .legend > .row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .legend > .row > .icon {
    width: 1rem;
    height: 2rem;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .tooltip {
    position: relative;
    display: inline-block;
  }
</style>
